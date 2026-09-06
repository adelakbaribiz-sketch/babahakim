// ── BabaHakim Application Service · Observability (PHASE 15, ED-180) ──────
// ADMIN-gated read model over the observability infrastructure:
//   • snapshot — health + system + queue + db + metrics + series + alerts
//   • log search — ServiceLog with bounded pagination (SEARCH_BOUNDS,
//     reuse of the PHASE 14 anti-unbounded discipline) + Persian-normalized
//     free-text over msg/svc/route
//   • alerts — list + manual resolve (audited)
import { db, dbPing } from '@/lib/db'
import { writeAudit } from '@/server/infrastructure/audit'
import type { RequestContext } from '@/server/core/context'
import { metricsValues, metricsSeries } from '@/server/core/metrics'
import { logTail, logRingSize } from '@/server/core/logger'
import { health, observabilityDetail } from '@/server/infrastructure/observability/health'
import { systemSnapshot } from '@/server/infrastructure/observability/system'
import { queueHealth } from '@/server/infrastructure/jobs'
import { searchKey } from '@/server/infrastructure/search/normalize'
import { SEARCH_BOUNDS, assertOffsetBounded } from '@/server/infrastructure/search/bounds'
import { resolveAlert as infraResolveAlert } from '@/server/infrastructure/observability/alerts'
import { AppError } from '@/server/core/errors'

const LOG_CATALOG_LIMIT = 200

export async function observabilitySnapshot() {
  const [detail, sys, ping] = await Promise.all([observabilityDetail(), systemSnapshot(), dbPing()])
  const values = metricsValues()
  const [alerts, logCount] = await Promise.all([
    db.alertEvent.findMany({ orderBy: [{ status: 'desc' as const }, { lastSeenAt: 'desc' as const }], take: 50 }),
    db.serviceLog.count(),
  ])
  // integration summary (PHASE 13 telemetry — presence-only, no credentials)
  let integrations: Array<{ kind: string; mode: string; circuit: string; successRate: number; p95: number }> = []
  try {
    const { integrationStatus } = await import('@/server/integrations')
    integrations = integrationStatus().map((r) => ({
      kind: r.kind, mode: r.mode, circuit: r.circuit.state,
      successRate: r.stats.successRate, p95: r.stats.p95,
    }))
  } catch { /* optional section */ }
  const openAlerts = alerts.filter((a) => a.status === 'OPEN')
  return {
    health: detail.health,
    system: sys,
    queue: queueHealth(),
    db: { pingOk: ping.ok, pingMs: ping.ms },
    metrics: values,
    series: metricsSeries(240), // newest-first, 2h at 30s cadence
    integrations,
    alerts: alerts.map(toAlertDto),
    openAlertCount: openAlerts.length,
    logs: {
      ringSize: logRingSize(),
      durableCount: logCount,
      tail: logTail(20),
    },
    metricPointCount: db.metricPoint.count(),
  }
}

function toAlertDto(a: {
  id: string; key: string; severity: string; status: string; msgFa: string; msgEn: string
  firstSeenAt: Date; lastSeenAt: Date; resolvedAt: Date | null; fireCount: number
}) {
  return {
    id: a.id, key: a.key, severity: a.severity, status: a.status,
    fa: a.msgFa, en: a.msgEn,
    firstSeenAt: a.firstSeenAt, lastSeenAt: a.lastSeenAt, resolvedAt: a.resolvedAt,
    fireCount: a.fireCount,
  }
}

// ── ServiceLog search (bounded — same discipline as every other list) ─────

export interface LogSearchParams {
  q?: string
  lvl?: string
  svc?: string
  route?: string
  reqId?: string
  corrId?: string
  page?: number
  limit?: number
}

const LEVELS = new Set(['debug', 'info', 'warn', 'error'])

export async function searchServiceLogs(params: LogSearchParams) {
  const page = Math.max(1, Math.trunc(params.page ?? 1))
  const limitRaw = Math.trunc(params.limit ?? SEARCH_BOUNDS.defaultLimit)
  const limit = Math.min(Math.max(1, limitRaw), SEARCH_BOUNDS.maxLimit)
  const offset = (page - 1) * limit
  assertOffsetBounded(offset, limit) // 422 on deep offsets — ED-168

  const where: Record<string, unknown> = {}
  if (params.lvl && LEVELS.has(params.lvl)) where.lvl = params.lvl
  if (params.svc) where.svc = { contains: params.svc }
  if (params.route) where.route = { contains: params.route }
  if (params.reqId) where.reqId = params.reqId.slice(0, 64)
  if (params.corrId) where.corrId = params.corrId.slice(0, 64)
  if (params.q) {
    const needle = searchKey(params.q).slice(0, 120)
    if (needle) {
      where.OR = [
        { msg: { contains: params.q.slice(0, 120) } },
        ...(needle && needle !== params.q ? [{ msg: { contains: needle } }, { svc: { contains: needle } }] : []),
      ]
    }
  }

  const [rows, total] = await Promise.all([
    db.serviceLog.findMany({
      where,
      orderBy: { t: 'desc' },
      skip: offset,
      take: limit,
    }),
    db.serviceLog.count({ where }),
  ])
  return {
    logs: rows.map((r) => ({
      id: r.id, t: r.t, lvl: r.lvl, svc: r.svc, msg: r.msg,
      route: r.route, method: r.method, status: r.status,
      reqId: r.reqId, corrId: r.corrId, traceId: r.traceId, fields: r.fields,
    })),
    meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
  }
}

/** The live tail (in-memory ring) — no DB hit, bounded by construction. */
export function liveLogTail(n?: number) {
  const take = Math.min(Math.max(1, Math.trunc(n ?? 50)), LOG_CATALOG_LIMIT)
  return { logs: logTail(take), source: 'ring' as const }
}

// ── Alerts ─────────────────────────────────────────────────────────────────

export async function listAlerts(params: { status?: string; page?: number; limit?: number }) {
  const page = Math.max(1, Math.trunc(params.page ?? 1))
  const limit = Math.min(Math.max(1, Math.trunc(params.limit ?? 20)), SEARCH_BOUNDS.maxLimit)
  const offset = (page - 1) * limit
  assertOffsetBounded(offset, limit)
  const where: Record<string, unknown> = {}
  if (params.status === 'OPEN' || params.status === 'RESOLVED') where.status = params.status
  const [rows, total] = await Promise.all([
    db.alertEvent.findMany({ where, orderBy: { lastSeenAt: 'desc' }, skip: offset, take: limit }),
    db.alertEvent.count({ where }),
  ])
  return {
    alerts: rows.map(toAlertDto),
    meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
  }
}

export async function resolveAlertAction(id: string, ctx: RequestContext, userId: string) {
  if (!/^[0-9a-f-]{10,40}$/i.test(id)) throw new AppError('VALIDATION', 'شناسه هشدار نامعتبر است', 422)
  const ok = await infraResolveAlert(id)
  if (!ok) throw new AppError('NOT_FOUND', 'هشدار باز با این شناسه یافت نشد', 404)
  await writeAudit(ctx, {
    userId,
    action: 'ALERT_RESOLVE',
    entity: 'AlertEvent',
    entityId: id,
    newValues: { resolvedBy: userId },
  })
  return { ok: true }
}

// used by routes
export { health, metricsSeries, queueHealth }
