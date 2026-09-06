// ── BabaHakim Observability · Metrics Registry (PHASE 15, ED-167/168) ─────
// In-process metrics engine feeding the admin console, health checks and
// the alert evaluator. Zero dependencies, HMR-safe singletons.
//
//   counter  inc(name, labels, n?)   — monotonic totals (api_requests_total…)
//   gauge    set(name, labels, v)    — point-in-time value (queue_depth…)
//   histogram observe(name, labels, ms) — latency dist. → p50/p95/p99
//
// Bounded by design (ED-168 — the anti-unbounded mandate extends to
// observability state itself):
//   • labelsets capped (MAX_LABELSETS): new labelsets beyond the cap are
//     folded into {label:'_overflow'} — a route explosion can never grow
//     memory linearly with traffic
//   • histogram keeps the newest MAX_SAMPLES observations per labelset
//   • time-series ring keeps the newest 720 samples (6h @ 30s)
//   • counters never store history — only current totals
import { logger } from './logger'

export interface LabelSet { [k: string]: string | number }

export interface HistogramStat {
  count: number
  p50: number
  p95: number
  p99: number
  max: number
  avg: number
}

export interface MetricSnapshot {
  at: string
  uptimeSec: number
  counters: Record<string, number>
  gauges: Record<string, number>
  histograms: Record<string, HistogramStat>
}

const MAX_LABELSETS = 256
const MAX_SAMPLES = 300
const SERIES_RING = 720 // 6h at 30s cadence

interface HistState { samples: number[]; count: number; sum: number; max: number }

interface MetricsGlobal {
  __bhMetrics?: {
    counters: Map<string, number>
    gauges: Map<string, number>
    hists: Map<string, HistState>
    series: MetricSnapshot[]
    labelKeys: Map<string, string> // canonical label key for overflow folding
  }
}
const g = globalThis as unknown as MetricsGlobal
const state = g.__bhMetrics ?? {
  counters: new Map<string, number>(),
  gauges: new Map<string, number>(),
  hists: new Map<string, HistState>(),
  series: [] as MetricSnapshot[],
  labelKeys: new Map<string, string>(),
}
g.__bhMetrics = state

function key(name: string, labels?: LabelSet): string {
  if (!labels || Object.keys(labels).length === 0) return name
  const raw = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(',')
  // cardinality guard (ED-168): beyond MAX_LABELSETS distinct keys for one
  // metric name, everything folds into a single _overflow bucket
  const mapKey = `${name}|${raw}`
  if (!state.labelKeys.has(mapKey)) {
    const used = [...state.labelKeys.keys()].filter((k) => k.startsWith(name + '|')).length
    if (used >= MAX_LABELSETS) {
      state.labelKeys.set(mapKey, `${name}|_overflow`)
      logger.warn('metrics labelset cap reached — folding', { metric: name, cap: MAX_LABELSETS })
      return `${name}|_overflow`
    }
    state.labelKeys.set(mapKey, mapKey)
  }
  return state.labelKeys.get(mapKey)!
}

// ── public API ─────────────────────────────────────────────────────────────

export function inc(name: string, labels?: LabelSet, n = 1): void {
  const k = key(name, labels)
  state.counters.set(k, (state.counters.get(k) ?? 0) + n)
}

export function gauge(name: string, labels: LabelSet | undefined, value: number): void {
  const k = key(name, labels)
  state.gauges.set(k, value)
}

export function observe(name: string, labels: LabelSet | undefined, ms: number): void {
  const k = key(name, labels)
  let h = state.hists.get(k)
  if (!h) { h = { samples: [], count: 0, sum: 0, max: 0 }; state.hists.set(k, h) }
  h.count += 1
  h.sum += ms
  h.max = Math.max(h.max, ms)
  h.samples.push(ms)
  if (h.samples.length > MAX_SAMPLES) h.samples.splice(0, h.samples.length - MAX_SAMPLES)
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, idx)]
}

function histStat(h: HistState): HistogramStat {
  const sorted = [...h.samples].sort((a, b) => a - b)
  return {
    count: h.count,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: h.max,
    avg: h.count ? h.sum / h.count : 0,
  }
}

/** Current values (counters + gauges + histogram stats) — cheap, no allocs
 *  beyond the result object. Snapshot cadence: sampler job + on demand. */
export function metricsValues(): {
  counters: Record<string, number>
  gauges: Record<string, number>
  histograms: Record<string, HistogramStat>
} {
  const counters: Record<string, number> = {}
  for (const [k, v] of state.counters) counters[k] = v
  const gauges: Record<string, number> = {}
  for (const [k, v] of state.gauges) gauges[k] = v
  const histograms: Record<string, HistogramStat> = {}
  for (const [k, h] of state.hists) histograms[k] = histStat(h)
  return { counters, gauges, histograms }
}

/** Freeze the current state into the time-series ring (sampler job calls
 *  this every 30s). Returns the snapshot for convenience. */
export function snapshotSeries(): MetricSnapshot {
  const snap: MetricSnapshot = {
    at: new Date().toISOString(),
    uptimeSec: Math.round(process.uptime()),
    ...metricsValues(),
  }
  state.series.push(snap)
  if (state.series.length > SERIES_RING) state.series.splice(0, state.series.length - SERIES_RING)
  return snap
}

/** Newest-first view of the series ring (bounded, default 2h). */
export function metricsSeries(lastN = 240): MetricSnapshot[] {
  const take = Math.min(Math.max(1, Math.trunc(lastN)), SERIES_RING)
  return state.series.slice(-take).reverse()
}

// test hooks
export const __internals = {
  reset: () => {
    state.counters.clear()
    state.gauges.clear()
    state.hists.clear()
    state.series.length = 0
    state.labelKeys.clear()
  },
}

// ── canonical metric names (single source — gates/ED reference these) ─────
export const METRIC_NAMES = {
  apiRequests: 'api_requests_total',
  apiErrors: 'api_errors_total', // 5xx only (server faults — alert-grade)
  apiRejected: 'api_rejected_total', // 4xx (client faults — visible, not alerting
  apiLatency: 'api_latency_ms',
  dbQueries: 'db_queries_total',
  dbErrors: 'db_errors_total',
  dbLatency: 'db_query_ms',
  queueJobs: 'queue_jobs_total',
  queueLatency: 'job_duration_ms',
  business: 'business_total', // + suffix per event, e.g. business_total|event=user.registered
  reportTimeouts: 'report_timeouts_total',
  eventLoopLag: 'system_event_loop_lag_ms',
} as const
