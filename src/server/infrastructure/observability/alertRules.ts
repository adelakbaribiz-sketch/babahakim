// ── BabaHakim Observability · Alert Rules (PHASE 15, ED-177) ──────────────
// PURE rule evaluation — no DB, no IO, no clock reads (inputs carry the
// data). The alert engine (alerts.ts) calls `evaluateRules` on each tick,
// then owns persistence, dedup/cooldown and delivery. Thresholds live here
// as ONE table so ops can tune them in a single place (ED-178).
import type { MetricSnapshot } from '@/server/core/metrics'

export type Severity = 'WARN' | 'CRITICAL'

export interface RuleViolation {
  key: string
  severity: Severity
  fa: string
  en: string
  payload?: Record<string, number | string | boolean | null>
}

export interface HealthSignals {
  dbOk: boolean
  dbPingMs: number
  queueDead: number
  queuePending: number
  workerAlive: boolean
  heapUsedBytes: number
  heapTotalBytes: number
  eventLoopLagMs: number
  reportTimeouts: number // total counter
  diskUsedPercent: number | null
  /** PHASE 13 providers currently unhealthy ("kind:provider" list) — folded
   *  into the unified alert engine (ED-179, replaces integrations-monitor). */
  integrationsDown: string[]
}

/** Single tuning table (ED-178) — values are intentionally conservative for
 *  a single-instance SQLite deployment. */
export const ALERT_THRESHOLDS = {
  apiErrorRatePct: 5, // % of failed requests over the window
  apiErrorMinRequests: 50, // don't alarm on tiny denominators
  apiP95Ms: 3000,
  dbLatencyP95Ms: 1500,
  queueDeadLetters: 0, // ANY dead letter is alert-worthy
  queueBacklog: 100,
  heapUsedPct: 90, // of heapTotal
  eventLoopLagMs: 500,
  diskUsedPct: 90,
  cooldownMin: 15, // re-fire suppression window
} as const

function sumMatching(counters: Record<string, number>, prefix: string, filter?: (labelKey: string) => boolean): number {
  let n = 0
  for (const [k, v] of Object.entries(counters)) {
    if (!k.startsWith(prefix)) continue
    if (filter && !filter(k)) continue
    n += v
  }
  return n
}

function apiTotals(counters: Record<string, number>): { total: number; errors: number } {
  const total = sumMatching(counters, 'api_requests_total')
  const errors = sumMatching(counters, 'api_errors_total')
  return { total, errors }
}

/**
 * Evaluate every alert rule against a snapshot + health signals.
 * Returns ONLY the violations (rules that currently FIRE) — resolution is
 * inferred by the engine (a rule absent from the result = healthy again).
 */
export function evaluateRules(snap: { counters: Record<string, number>; histograms: Record<string, { p95: number }> }, health: HealthSignals): RuleViolation[] {
  const out: RuleViolation[] = []
  const t = ALERT_THRESHOLDS

  // ── DB availability (CRITICAL — readiness-killer) ────────────────────────
  if (!health.dbOk) {
    out.push({
      key: 'db_unavailable',
      severity: 'CRITICAL',
      fa: 'پایگاه داده پاسخ نمی‌دهد — پینگ ناموفق',
      en: 'Database unavailable — ping failed',
      payload: { dbPingMs: health.dbPingMs },
    })
  }

  // ── API error rate (CRITICAL when spiking) ──────────────────────────────
  const { total, errors } = apiTotals(snap.counters)
  if (total >= t.apiErrorMinRequests) {
    const rate = (errors / total) * 100
    if (rate > t.apiErrorRatePct) {
      out.push({
        key: 'api_error_rate',
        severity: rate > 2 * t.apiErrorRatePct ? 'CRITICAL' : 'WARN',
        fa: `نرخ خطای API بالاست: ${rate.toFixed(1)}٪ (${errors} از ${total})`,
        en: `API error rate high: ${rate.toFixed(1)}% (${errors} of ${total})`,
        payload: { rate: +rate.toFixed(1), errors, total },
      })
    }
  }

  // ── API latency p95 ─────────────────────────────────────────────────────
  const apiLat = Object.entries(snap.histograms).filter(([k]) => k.startsWith('api_latency_ms'))
  if (apiLat.length) {
    const p95 = Math.max(...apiLat.map(([, h]) => h.p95))
    if (p95 > t.apiP95Ms) {
      out.push({
        key: 'api_p95_latency',
        severity: 'WARN',
        fa: `زمان پاسخ API کند است (p95=${Math.round(p95)}ms)`,
        en: `API latency degraded (p95=${Math.round(p95)}ms)`,
        payload: { p95ms: Math.round(p95) },
      })
    }
  }

  // ── DB latency p95 ──────────────────────────────────────────────────────
  const dbLat = Object.entries(snap.histograms).filter(([k]) => k.startsWith('db_query_ms'))
  if (dbLat.length) {
    const p95 = Math.max(...dbLat.map(([, h]) => h.p95))
    if (p95 > t.dbLatencyP95Ms) {
      out.push({
        key: 'db_p95_latency',
        severity: 'WARN',
        fa: `کوئریهای پایگاه داده کندند (p95=${Math.round(p95)}ms)`,
        en: `DB queries degraded (p95=${Math.round(p95)}ms)`,
        payload: { p95ms: Math.round(p95) },
      })
    }
  }

  // ── Queue: dead letters (CRITICAL — work lost) ──────────────────────────
  if (health.queueDead > t.queueDeadLetters) {
    out.push({
      key: 'queue_dead_letters',
      severity: 'CRITICAL',
      fa: `${health.queueDead} کار پس‌مرده در صف — نیاز به بررسی فوری`,
      en: `${health.queueDead} dead-lettered jobs — investigate now`,
      payload: { dead: health.queueDead },
    })
  }

  // ── Queue: backlog ──────────────────────────────────────────────────────
  if (health.queuePending > t.queueBacklog) {
    out.push({
      key: 'queue_backlog',
      severity: 'WARN',
      fa: `عقب‌افتادگی صف: ${health.queuePending} کار در انتظار`,
      en: `Queue backlog: ${health.queuePending} pending jobs`,
      payload: { pending: health.queuePending },
    })
  }

  // ── Worker not alive (CRITICAL — queue frozen) ──────────────────────────
  if (!health.workerAlive && process.env.NEXT_PHASE !== 'build') {
    out.push({
      key: 'queue_worker_stalled',
      severity: 'CRITICAL',
      fa: 'کارگر صف مشغول به کار نیست — صف متوقف است',
      en: 'Queue worker is not running — jobs are frozen',
      payload: { pending: health.queuePending },
    })
  }

  // ── Memory pressure (heap) ──────────────────────────────────────────────
  if (health.heapTotalBytes > 0) {
    const pct = (health.heapUsedBytes / health.heapTotalBytes) * 100
    if (pct > t.heapUsedPct) {
      out.push({
        key: 'memory_pressure',
        severity: pct > 97 ? 'CRITICAL' : 'WARN',
        fa: `فشار حافظه: ${pct.toFixed(0)}٪ هیپ در استفاده`,
        en: `Memory pressure: heap ${pct.toFixed(0)}% in use`,
        payload: { pct: Math.round(pct), heapUsedBytes: health.heapUsedBytes },
      })
    }
  }

  // ── Event-loop blocked ──────────────────────────────────────────────────
  if (health.eventLoopLagMs > t.eventLoopLagMs) {
    out.push({
      key: 'event_loop_lag',
      severity: 'WARN',
      fa: `تأخیر حلقه رویداد بالا: ${Math.round(health.eventLoopLagMs)}ms`,
      en: `Event-loop lag high: ${Math.round(health.eventLoopLagMs)}ms`,
      payload: { lagMs: Math.round(health.eventLoopLagMs) },
    })
  }

  // ── Disk ────────────────────────────────────────────────────────────────
  if (health.diskUsedPercent != null && health.diskUsedPercent > t.diskUsedPct) {
    out.push({
      key: 'disk_usage',
      severity: health.diskUsedPercent > 95 ? 'CRITICAL' : 'WARN',
      fa: `فضای دیسک ${health.diskUsedPercent}٪ پر است`,
      en: `Disk usage at ${health.diskUsedPercent}%`,
      payload: { pct: health.diskUsedPercent },
    })
  }

  // ── Integrations (PHASE 13 telemetry folded in, ED-179) ──────────────────
  if (health.integrationsDown.length > 0) {
    const list = health.integrationsDown.slice(0, 5).join('، ')
    out.push({
      key: 'integrations_unhealthy',
      severity: health.integrationsDown.length >= 2 ? 'CRITICAL' : 'WARN',
      fa: `سرویسهای خارجی ناسالم: ${list}`,
      en: `Unhealthy integrations: ${list}`,
      payload: { count: health.integrationsDown.length, list: health.integrationsDown.slice(0, 8).join(',') },
    })
  }

  return out
}

/** Convenience: build HealthSignals from live probes (engine injects at eval). */
export function signalsFrom(metricsNow: { counters?: Record<string, number>; gauges?: Record<string, number> }, health: {
  dbOk: boolean
  dbPingMs: number
  queue: { pending: number; dead: number; workerAlive: boolean }
  mem: { heapUsed: number; heapTotal: number }
  loopLagMs: number
  diskUsedPercent: number | null
  integrationsDown?: string[]
}): HealthSignals {
  return {
    dbOk: health.dbOk,
    dbPingMs: health.dbPingMs,
    queueDead: health.queue.dead,
    queuePending: health.queue.pending,
    workerAlive: health.queue.workerAlive,
    heapUsedBytes: health.mem.heapUsed,
    heapTotalBytes: health.mem.heapTotal,
    eventLoopLagMs: health.loopLagMs,
    reportTimeouts: (metricsNow.counters?.report_timeouts_total as number) ?? 0,
    diskUsedPercent: health.diskUsedPercent,
    integrationsDown: health.integrationsDown ?? [],
  }
}
