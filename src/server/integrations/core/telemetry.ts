// ── BabaHakim External Integration Core · Telemetry (PHASE 13, ED-139) ────
// In-memory observability ring + aggregates per (kind, provider):
//   totals, success rate, p50/p95 latency, last error, breaker state
// Backed by IntegrationCallLog for durable history (written by resilience.ts).
// The admin console and the integrations-monitor job consume snapshots of
// this module — Monitoring concern #6 of the PHASE 13 mandate.
import { IntegrationKind } from './types'

export interface CallRecord {
  at: number
  kind: IntegrationKind
  provider: string
  operation: string
  status: 'SUCCESS' | 'FAILED' | 'REPLAYED' | 'FALLBACK' | 'SKIPPED_CIRCUIT'
  attempts: number
  latencyMs: number
  httpStatus?: number
  errorCode?: string
  errorMessage?: string
}

export interface ProviderAggregate {
  kind: IntegrationKind
  provider: string
  total: number
  success: number
  failed: number
  replayed: number
  successRate: number
  p50: number
  p95: number
  lastError: { code: string; message: string; at: number } | null
  lastCallAt: number | null
}

const RING_SIZE = 400

const g = globalThis as unknown as { __bhIntegrationRing?: CallRecord[] }
const ring: CallRecord[] = g.__bhIntegrationRing ?? []
g.__bhIntegrationRing = ring

export function pushRecord(r: CallRecord): void {
  ring.push(r)
  if (ring.length > RING_SIZE) ring.splice(0, ring.length - RING_SIZE)
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, idx)]
}

/** Aggregates over the in-memory ring (recent window). */
export function aggregate(windowMs = 24 * 3600 * 1000): ProviderAggregate[] {
  const now = Date.now()
  const groups = new Map<string, CallRecord[]>()
  for (const r of ring) {
    if (now - r.at > windowMs) continue
    const k = `${r.kind}:${r.provider}`
    let arr = groups.get(k)
    if (!arr) { arr = []; groups.set(k, arr) }
    arr.push(r)
  }
  const out: ProviderAggregate[] = []
  for (const [k, calls] of groups) {
    const [kind, provider] = k.split(':')
    const latencies = calls.filter((c) => c.status === 'SUCCESS' || c.status === 'REPLAYED').map((c) => c.latencyMs).sort((a, b) => a - b)
    const success = calls.filter((c) => c.status === 'SUCCESS' || c.status === 'REPLAYED').length
    const failed = calls.filter((c) => c.status === 'FAILED' || c.status === 'SKIPPED_CIRCUIT').length
    const replayed = calls.filter((c) => c.status === 'REPLAYED').length
    const lastFailed = [...calls].reverse().find((c) => c.status === 'FAILED' || c.status === 'SKIPPED_CIRCUIT')
    out.push({
      kind: kind as IntegrationKind,
      provider,
      total: calls.length,
      success,
      failed,
      replayed,
      successRate: calls.length === 0 ? 1 : success / calls.length,
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      lastError: lastFailed ? { code: lastFailed.errorCode || 'UNKNOWN', message: lastFailed.errorMessage || '', at: lastFailed.at } : null,
      lastCallAt: Math.max(...calls.map((c) => c.at)),
    })
  }
  return out.sort((a, b) => a.kind.localeCompare(b.kind) || a.provider.localeCompare(b.provider))
}

/** Recent failures for the admin console. */
export function recentFailures(limit = 10): CallRecord[] {
  return ring.filter((r) => r.status === 'FAILED' || r.status === 'SKIPPED_CIRCUIT').slice(-limit).reverse()
}

/** Test helper: clear the ring. */
export function __clearTelemetryForTests(): void {
  ring.length = 0
}

/** Durable retention purge — the ONLY IntegrationCallLog delete path
 *  (single-writer discipline, I10). Called by the retention job. */
export async function purgeIntegrationLogs(days: number): Promise<number> {
  const { db } = await import('@/lib/db')
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000)
  const r = await db.integrationCallLog.deleteMany({ where: { createdAt: { lt: cutoff } } })
  return r.count
}
