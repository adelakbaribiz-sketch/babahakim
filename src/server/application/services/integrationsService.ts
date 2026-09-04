// ── BabaHakim Backend · Application Service: Integration Ops ────────────────
// PHASE 13 — admin console backend: integration status (mode/credentials/
// circuit/telemetry), durable call-log stats, recent failures and the
// smoke-test action. Controllers stay thin (ED-93); ADMIN-only at the
// boundary; rate-limited because smoke tests hit real providers.
import { db } from '@/lib/db'
import type { AuthContext } from '@/lib/auth'
import { integrationStatus, recentFailures, payment, sms, email, maps, shipping, crm, analytics, storage, resetCircuit, INTEGRATION_KINDS } from '@/server/integrations'
import { IntegrationKind } from '@/server/integrations'
import { rateLimit } from '@/lib/security/rate-limit'
import { RateLimitError, ValidationError } from '@/server/core/errors'
import { writeAudit } from '@/server/infrastructure/audit'
import type { RequestContext } from '@/server/core/context'
import type { z } from 'zod'
import type { integrationSmokeSchema } from '@/server/application/dto'

// ════════════════════════════ OVERVIEW ═══════════════════════════════════

export async function integrationsOverview() {
  const rows = integrationStatus()

  // durable 24h stats from IntegrationCallLog (survives restarts, unlike the
  // in-memory ring) — one grouped query per the whole table
  const since = new Date(Date.now() - 24 * 3600 * 1000)
  const grouped = await db.integrationCallLog.groupBy({
    by: ['kind', 'provider', 'status'],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
    _avg: { latencyMs: true },
  })
  const durable: Record<string, { total: number; success: number; failed: number; avgLatency: number }> = {}
  for (const g of grouped) {
    const k = `${g.kind}:${g.provider}`
    const d = durable[k] ?? (durable[k] = { total: 0, success: 0, failed: 0, avgLatency: 0 })
    d.total += g._count._all
    if (g.status === 'SUCCESS' || g.status === 'REPLAYED') d.success += g._count._all
    if (g.status === 'FAILED' || g.status === 'SKIPPED_CIRCUIT') d.failed += g._count._all
    d.avgLatency = Math.round(g._avg.latencyMs ?? 0)
  }

  const kinds: Record<string, { name: string; descFa: string }> = {
    PAYMENT: { name: 'Payment', descFa: 'درگاه پرداخت (زرین‌پال)' },
    SMS: { name: 'SMS', descFa: 'پیامک (کاوه‌نگار)' },
    EMAIL: { name: 'Email', descFa: 'ایمیل' },
    MAPS: { name: 'Maps', descFa: 'نقشه/اعتبارسنجی آدرس' },
    AI: { name: 'AI', descFa: 'سرویس استنتاج هوش مصنوعی' },
    STORAGE: { name: 'Storage', descFa: 'ذخیره‌سازی فایل' },
    SHIPPING: { name: 'Shipping', descFa: 'ارسال/مرسوله' },
    CRM: { name: 'CRM', descFa: 'ارتباط با مشتری' },
    ANALYTICS: { name: 'Analytics', descFa: 'تحلیل رفتار' },
  }

  return {
    kinds: rows.map((r) => ({
      kind: r.kind,
      label: kinds[r.kind]?.name ?? r.kind,
      descFa: kinds[r.kind]?.descFa ?? r.kind,
      mode: r.mode,
      requestedMode: r.requestedMode,
      provider: r.providerName,
      credentials: r.credentials, // presence booleans ONLY (ED-137)
      circuit: r.circuit,
      stats: r.stats,
      durable24h: durable[`${r.kind}:${r.providerName}`] ?? { total: 0, success: 0, failed: 0, avgLatency: 0 },
    })),
    recentFailures: recentFailures(10).map((f) => ({
      at: new Date(f.at).toISOString(), kind: f.kind, provider: f.provider, operation: f.operation,
      status: f.status, errorCode: f.errorCode, errorMessage: f.errorMessage, latencyMs: f.latencyMs,
    })),
    recentCalls: await db.integrationCallLog.findMany({
      orderBy: { createdAt: 'desc' }, take: 15,
      select: { kind: true, provider: true, operation: true, status: true, attempts: true, latencyMs: true, errorCode: true, errorMessage: true, createdAt: true, relatedType: true, relatedId: true },
    }),
  }
}

// ════════════════════════════ SMOKE TEST ═════════════════════════════════

const HEALTH_FN: Record<IntegrationKind, () => Promise<{ ok: boolean; latencyMs: number; detail: string }>> = {
  PAYMENT: () => payment().healthCheck(),
  SMS: () => sms().healthCheck(),
  EMAIL: () => email().healthCheck(),
  MAPS: () => maps().healthCheck(),
  // AI health: probe the external service when configured; otherwise the
  // registry legitimately stays on the local TongueModelV1 (PHASE 11)
  AI: async () => {
    const { aiServiceSettings } = await import('@/server/integrations')
    if (!aiServiceSettings().url) {
      return { ok: true, latencyMs: 0, detail: 'AI_SERVICE_URL not configured — registry stays on local TongueModelV1 (ED-121)' }
    }
    const { HttpAIProvider } = await import('@/server/integrations')
    return new HttpAIProvider().healthCheck()
  },
  STORAGE: () => storage().healthCheck(),
  SHIPPING: () => shipping().healthCheck(),
  CRM: () => crm().healthCheck(),
  ANALYTICS: () => analytics().healthCheck(),
}

export async function integrationSmokeTest(
  auth: AuthContext, ctx: RequestContext, input: z.infer<typeof integrationSmokeSchema>,
) {
  // ADMIN-only (guard at route) + rate-limit: a smoke test may hit a LIVE
  // provider — 3/minute is generous and safe.
  const rl = rateLimit(`integr-test:${auth.user.id}`, 3, 60_000)
  if (!rl.allowed) throw new RateLimitError(undefined, { retryAfterSec: rl.retryAfterSec })

  const kind = (input.kind || '').toUpperCase() as IntegrationKind
  if (!INTEGRATION_KINDS.includes(kind)) throw new ValidationError('نوع Integration نامعتبر است')

  // reset the breaker so a smoke test probes a provider even if it is OPEN
  const status = integrationStatus().find((r) => r.kind === kind)
  if (status) resetCircuit(kind, status.providerName)

  const t0 = Date.now()
  let result: { ok: boolean; latencyMs: number; detail: string }
  try {
    result = await HEALTH_FN[kind]()
  } catch (e) {
    result = { ok: false, latencyMs: Date.now() - t0, detail: e instanceof Error ? e.message : 'smoke test failed' }
  }

  await writeAudit(ctx, {
    userId: auth.user.id,
    action: 'INTEGRATION_SMOKE_TEST',
    entity: 'Integration', entityId: kind,
    newValues: { ok: result.ok, detail: result.detail.slice(0, 200), mode: status?.mode ?? 'unknown', provider: status?.providerName ?? 'unknown' },
  })

  return {
    kind,
    provider: status?.providerName ?? 'unknown',
    mode: status?.mode ?? 'unknown',
    ok: result.ok,
    latencyMs: result.latencyMs,
    detail: result.detail,
    hintFa: result.ok
      ? (status?.mode === 'mock' ? 'پاسخ از Adapter آزمایشی (Mock) دریافت شد.' : 'اتصال به سرویس خارجی برقرار است.')
      : 'اتصال برقرار نشد — وضعیت Credentialها و موجود بودن سرویس را بررسی کنید.',
  }
}
