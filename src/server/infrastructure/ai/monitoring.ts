// ── BabaHakim AI/ML ENGINE · Inference Monitoring + Drift (ED-126/130) ──────
// Every inference is telemetry (AIInferenceLog). This module aggregates:
//   · volume / latency / confidence / low-confidence rate / failure rate
//   · cost roll-up (via cost.ts at write time)
//   · DRIFT: Population Stability Index per feature + confidence, comparing
//     the recent window against the model's registered baseline. PSI is
//     the industry-standard drift score:
//         PSI < 0.1   stable · 0.1..0.25 mild drift · > 0.25 severe drift
//   Bias detection (distribution balance across prediction classes) is
//   reported alongside — monitoring is the early-warning layer the
//   evaluation layer then confirms.
import { db } from '@/lib/db'
import { childLogger } from '@/server/core/logger'
import { publish, Events } from '@/server/infrastructure/events'
import { LOW_CONFIDENCE_THRESHOLD, PSI_ALARM, PSI_WARN } from './constants'

const log = childLogger({ svc: 'ai-monitoring' })

export interface InferenceTelemetry {
  analysisId: string | null
  caseId: string
  imageId: string
  modelId: string | null
  modelName: string
  modelVersion: number
  datasetVersion: string | null
  promptKey: string | null
  promptVersion: number | null
  preprocessingVersion: string | null
  inputSha256: string | null
  confidence: number | null
  quality: number | null
  processingMs: number | null
  costUnits: number | null
  status: 'OK' | 'FAILED'
  errorCode: string | null
  replay: boolean
}

/** Persist one inference telemetry row (ED-130 — the monitoring source). */
export async function recordInference(t: InferenceTelemetry) {
  await db.aIInferenceLog.create({ data: t })
}

/** Aggregate inference stats over a time window. */
export async function inferenceStats(windowHours = 168) {
  const since = new Date(Date.now() - windowHours * 3_600_000)
  const rows = await db.aIInferenceLog.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' }, take: 2000,
  })
  const ok = rows.filter((r) => r.status === 'OK')
  const confidences = ok.map((r) => r.confidence ?? 0).sort((a, b) => a - b)
  const latencies = ok.map((r) => r.processingMs ?? 0).sort((a, b) => a - b)
  return {
    windowHours,
    total: rows.length,
    ok: ok.length,
    failed: rows.length - ok.length,
    replayed: rows.filter((r) => r.replay).length,
    avgConfidence: ok.length ? +(ok.reduce((s, r) => s + (r.confidence ?? 0), 0) / ok.length).toFixed(3) : null,
    p50Confidence: median(confidences),
    avgProcessingMs: ok.length ? Math.round(ok.reduce((s, r) => s + (r.processingMs ?? 0), 0) / ok.length) : null,
    p95ProcessingMs: quantile(latencies, 0.95),
    lowConfidenceRate: ok.length ? +(ok.filter((r) => (r.confidence ?? 1) < LOW_CONFIDENCE_THRESHOLD).length / ok.length).toFixed(3) : null,
    failureRate: rows.length ? +((rows.length - ok.length) / rows.length).toFixed(3) : 0,
    totalCostUnits: +rows.reduce((s, r) => s + (r.costUnits ?? 0), 0).toFixed(2),
  }
}

/** Prediction-class distribution — the bias-detection signal (spec: Bias). */
export async function predictionClassBias(windowHours = 168) {
  const since = new Date(Date.now() - windowHours * 3_600_000)
  const rows = await db.aIAnalysis.findMany({ where: { createdAt: { gte: since } }, take: 1000 })
  const counts: Record<string, number> = {}
  for (const a of rows) {
    try {
      const preds = JSON.parse(a.predictions) as { indicator: string; value: string }[]
      for (const p of preds) {
        const k = `${p.indicator}:${p.value}`
        counts[k] = (counts[k] || 0) + 1
      }
    } catch { /* malformed legacy row — skip */ }
  }
  const total = Object.values(counts).reduce((s, c) => s + c, 0)
  if (!total) return { total: 0, classes: [], maxClassRatio: null, flagged: [] as string[] }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1])
  const flagged = entries.filter(([, c]) => c / total > 0.8).map(([k, c]) => `${k} ${(c / total * 100).toFixed(0)}%`)
  return {
    total,
    classes: entries.map(([k, c]) => ({ class: k, count: c, ratio: +(c / total).toFixed(3) })),
    maxClassRatio: +(entries[0][1] / total).toFixed(3),
    flagged, // any single class > 80% of predictions → skew warning
  }
}

/* ── PSI drift ───────────────────────────────────────────────────────────── */

/**
 * Population Stability Index between a baseline and recent sample.
 * Pure function — unit-testable. Buckets: quantile-based on baseline.
 *   PSI = Σ (b_i - r_i) · ln(b_i / r_i)
 */
export function computePSI(baseline: number[], recent: number[], bucketCount = 5): number {
  if (baseline.length < 10 || recent.length < 5) return 0 // insufficient data → no signal
  const sorted = [...baseline].sort((a, b) => a - b)
  const edges: number[] = []
  for (let i = 1; i < bucketCount; i++) {
    const q = sorted[Math.floor((i / bucketCount) * sorted.length) - 1] ?? sorted[sorted.length - 1]
    edges.push(q)
  }
  // dedupe edges (degenerate constants), keep order
  const uniqEdges = [...new Set(edges)]

  const bucketOf = (v: number, es: number[]): number => {
    let b = 0
    while (b < es.length && v > es[b]) b++
    return b
  }
  const dist = (sample: number[], es: number[]): number[] => {
    const counts = new Array(es.length + 1).fill(0)
    for (const v of sample) counts[bucketOf(v, es)]++
    return counts.map((c) => Math.max(c, 1) / Math.max(sample.length, 1)) // smoothed, no zero bins
  }
  const bDist = dist(baseline, uniqEdges)
  const rDist = dist(recent, uniqEdges)

  let psi = 0
  for (let i = 0; i < bDist.length; i++) {
    psi += (bDist[i] - rDist[i]) * Math.log(bDist[i] / rDist[i])
  }
  return Math.abs(+psi.toFixed(4))
}

export interface DriftFeatureReport {
  feature: string
  psi: number
  level: 'STABLE' | 'WARN' | 'ALARM'
}

/** Feature fields monitored for input drift (distribution shift). */
const MONITORED_FEATURES = ['redness', 'pallor', 'purpleIndex', 'coatingWhite', 'coatingYellow', 'textureRoughness'] as const

/**
 * Capture the drift baseline for a model from its recent OK inferences
 * (called on deploy / periodically refreshed — stored on AIModel.driftBaseline).
 */
export async function captureBaseline(modelId: string, windowHours = 336): Promise<boolean> {
  const since = new Date(Date.now() - windowHours * 3_600_000)
  const rows = await db.aIAnalysis.findMany({
    where: { modelId, createdAt: { gte: since } }, take: 500,
  })
  if (rows.length < 10) return false
  const features = rows.map((r) => (safeJson(r.features) || {}) as Record<string, number>)
  const confidences = rows.map((r) => r.confidence)
  const baseline: Record<string, number[]> = { confidence: confidences }
  for (const f of MONITORED_FEATURES) baseline[f] = features.map((x) => x[f]).filter((v) => typeof v === 'number')
  await db.aIModel.update({
    where: { id: modelId },
    data: { driftBaseline: JSON.stringify(baseline) },
  })
  return true
}

/**
 * Drift check job: recent window vs baseline → per-feature PSI.
 * ALARM publishes AiDriftDetected (→ admin notification via bootstrap).
 */
export async function runDriftCheck(recentWindowHours = 24) {
  const model = await db.aIModel.findFirst({ where: { isActive: true } })
  if (!model) return { checked: false, reason: 'NO_ACTIVE_MODEL' }
  const baseline = safeJson(model.driftBaseline) as Record<string, number[]> | null
  if (!baseline || Object.keys(baseline).length === 0) {
    return { checked: false, reason: 'NO_BASELINE' }
  }

  const since = new Date(Date.now() - recentWindowHours * 3_600_000)
  const recentRows = await db.aIAnalysis.findMany({
    where: { modelId: model.id, createdAt: { gte: since } }, take: 500,
  })
  if (recentRows.length < 5) return { checked: true, model: model.name, features: [], reason: 'INSUFFICIENT_RECENT' }

  const recentFeatures = recentRows.map((r) => (safeJson(r.features) || {}) as Record<string, number>)
  const reports: DriftFeatureReport[] = []

  for (const f of MONITORED_FEATURES) {
    const base = baseline[f]
    const rec = recentFeatures.map((x) => x[f]).filter((v) => typeof v === 'number')
    if (!base?.length || !rec.length) continue
    const psi = computePSI(base, rec)
    reports.push({ feature: f, psi, level: psi > PSI_ALARM ? 'ALARM' : psi > PSI_WARN ? 'WARN' : 'STABLE' })
  }
  const confPsi = computePSI(baseline.confidence ?? [], recentRows.map((r) => r.confidence))
  reports.push({ feature: 'confidence', psi: confPsi, level: confPsi > PSI_ALARM ? 'ALARM' : confPsi > PSI_WARN ? 'WARN' : 'STABLE' })

  const alarms = reports.filter((r) => r.level === 'ALARM')
  if (alarms.length) {
    await publish(Events.AiDriftDetected, {
      modelId: model.id, modelName: model.name,
      features: alarms.map((a) => ({ feature: a.feature, psi: a.psi })),
      severity: 'ALARM',
    })
    log.warn('AI drift ALARM', { model: model.name, alarms: alarms.map((a) => `${a.feature}:${a.psi}`) })
  } else {
    log.debug('drift check stable', { model: model.name, max: Math.max(...reports.map((r) => r.psi), 0) })
  }
  return { checked: true, model: model.name, features: reports, alarms: alarms.length }
}

function safeJson(raw: string | null): unknown {
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}
function median(sorted: number[]): number | null {
  return sorted.length ? +(sorted[Math.floor(sorted.length / 2)]).toFixed(3) : null
}
function quantile(sorted: number[], q: number): number | null {
  return sorted.length ? +(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]).toFixed(1) : null
}
