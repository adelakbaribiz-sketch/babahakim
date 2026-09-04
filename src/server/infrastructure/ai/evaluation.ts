// ── BabaHakim AI/ML ENGINE · Evaluation Framework (PHASE 11, ED-127) ───────
// Spec §60 mandate: "صرفاً Accuracy گزارش نکن" — report the FULL suite:
//   accuracy · precision · recall · F1 (macro + per-class) · confusion matrix
//   · sensitivity/specificity · calibration buckets · dataset imbalance
// Evaluation compares the AI prediction (per indicator) against the FINAL
// human label on FINALIZED dataset items — the closed feedback loop makes
// every review double as ground-truth capture.
//
// Reports persist to AIEvaluationReport and refresh AIModel.metrics —
// so the registry's metrics are COMPUTED, never hand-entered (audit
// finding: seeded fake metrics).
import { db } from '@/lib/db'
import { BusinessRuleError, NotFoundError } from '@/server/core/errors'
import { childLogger } from '@/server/core/logger'
import { publish, Events } from '@/server/infrastructure/events'
import { assertNoPatientLeakage, patientLevelSplit } from './datasets'
import { parseCorrections } from './datasets'
import type { SplitItem } from './datasets'

const log = childLogger({ svc: 'ai-evaluation' })

export interface LabeledPair {
  /** AI-predicted class per indicator, e.g. "BODY_COLOR:RED" */
  predicted: string
  /** human ground-truth class, e.g. "BODY_COLOR:RED" (from final label) */
  actual: string
  confidence: number
  patientHash?: string | null
}

export interface ClassMetrics {
  precision: number
  recall: number
  f1: number
  support: number
}

export interface EvaluationSuite {
  sampleCount: number
  classCount: number
  accuracy: number
  macro: ClassMetrics
  perClass: Record<string, ClassMetrics>
  confusion: Record<string, Record<string, number>> // actual → predicted → count
  sensitivity: Record<string, number> // per class (recall alias, medical naming)
  specificity: Record<string, number>
  calibration: { bucket: string; avgConfidence: number; observedAccuracy: number; count: number }[]
  imbalance: { majorityClass: string; majorityRatio: number; minorityClass: string | null; minorityRatio: number }
  splitAudit: { train: number; val: number; test: number; leakage: false; unassigned: number }
  notes: string[]
}

/**
 * Compute the full metric suite from predicted/actual pairs.
 * Pure function — unit-testable with hand-computed matrices.
 */
export function computeMetrics(pairs: LabeledPair[], splitItems: SplitItem[] = []): EvaluationSuite {
  const n = pairs.length
  if (n === 0) throw new BusinessRuleError('داده ارزیابی کافی نیست | No labeled pairs to evaluate')

  const classes = [...new Set([...pairs.map((p) => p.predicted), ...pairs.map((p) => p.actual)])].sort()
  const confusion: Record<string, Record<string, number>> = {}
  for (const a of classes) {
    confusion[a] = {}
    for (const p of classes) confusion[a][p] = 0
  }

  let correct = 0
  const confidenceSum = pairs.reduce((s, p) => s + Math.min(1, Math.max(0, p.confidence)), 0)
  for (const pair of pairs) {
    confusion[pair.actual][pair.predicted] += 1
    if (pair.actual === pair.predicted) correct++
  }

  const perClass: Record<string, ClassMetrics> = {}
  const sensitivity: Record<string, number> = {}
  const specificity: Record<string, number> = {}
  const tpCount: Record<string, number> = {}, fnCount: Record<string, number> = {}
  const fpCount: Record<string, number> = {}, tnCount: Record<string, number> = {}

  for (const c of classes) {
    let tp = 0, fp = 0, fn = 0, tn = 0
    for (const a of classes) for (const p of classes) {
      const count = confusion[a][p]
      if (a === c && p === c) tp += count
      else if (a !== c && p === c) fp += count
      else if (a === c && p !== c) fn += count
      else tn += count
    }
    tpCount[c] = tp; fnCount[c] = fn; fpCount[c] = fp; tnCount[c] = tn
    const precision = tp + fp ? tp / (tp + fp) : 0
    const recall = tp + fn ? tp / (tp + fn) : 0
    perClass[c] = {
      precision, recall, f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
      support: tp + fn,
    }
    sensitivity[c] = recall // medical naming
    specificity[c] = tn + fp ? tn / (tn + fp) : 0
  }

  const macro: ClassMetrics = {
    precision: avg(classes.map((c) => perClass[c].precision)),
    recall: avg(classes.map((c) => perClass[c].recall)),
    f1: avg(classes.map((c) => perClass[c].f1)),
    support: n,
  }

  // calibration buckets (spec §60): predicted confidence vs observed accuracy
  const buckets = [
    { bucket: '0-0.3', lo: 0, hi: 0.3 },
    { bucket: '0.3-0.5', lo: 0.3, hi: 0.5 },
    { bucket: '0.5-0.7', lo: 0.5, hi: 0.7 },
    { bucket: '0.7-1.0', lo: 0.7, hi: 1.0001 },
  ]
  const calibration = buckets.map(({ bucket, lo, hi }) => {
    const inB = pairs.filter((p) => p.confidence >= lo && p.confidence < hi)
    return {
      bucket,
      count: inB.length,
      avgConfidence: inB.length ? +(inB.reduce((s, p) => s + p.confidence, 0) / inB.length).toFixed(3) : 0,
      observedAccuracy: inB.length ? +(inB.filter((p) => p.actual === p.predicted).length / inB.length).toFixed(3) : 0,
    }
  }).filter((b) => b.count > 0)

  // dataset imbalance
  const actualCounts: Record<string, number> = {}
  for (const p of pairs) actualCounts[p.actual] = (actualCounts[p.actual] || 0) + 1
  const sorted = Object.entries(actualCounts).sort((a, b) => b[1] - a[1])
  const majority = sorted[0]
  const minority = sorted[sorted.length - 1]

  // split audit — leakage guarantee (spec §63)
  const split = patientLevelSplit(splitItems)
  assertNoPatientLeakage(split)

  const notes: string[] = []
  if (majority[1] / n > 0.7) notes.push(`Imbalanced: majority class ${majority[0]} = ${(majority[1] / n * 100).toFixed(0)}% — per-class metrics and calibration are the decision basis, not accuracy alone`)
  const avgConf = confidenceSum / n
  if (Math.abs(avgConf - correct / n) > 0.2) {
    notes.push(avgConf > correct / n
      ? `Over-confident: mean confidence ${(avgConf * 100).toFixed(0)}% vs accuracy ${(correct / n * 100).toFixed(0)}%`
      : `Under-confident: mean confidence ${(avgConf * 100).toFixed(0)}% vs accuracy ${(correct / n * 100).toFixed(0)}%`)
  }

  return {
    sampleCount: n, classCount: classes.length,
    accuracy: +(correct / n).toFixed(4),
    macro: { precision: +macro.precision.toFixed(4), recall: +macro.recall.toFixed(4), f1: +macro.f1.toFixed(4), support: n },
    perClass: Object.fromEntries(Object.entries(perClass).map(([c, m]) => [c, {
      precision: +m.precision.toFixed(4), recall: +m.recall.toFixed(4), f1: +m.f1.toFixed(4), support: m.support,
    }])),
    confusion,
    sensitivity: Object.fromEntries(Object.entries(sensitivity).map(([c, v]) => [c, +v.toFixed(4)])),
    specificity: Object.fromEntries(Object.entries(specificity).map(([c, v]) => [c, +v.toFixed(4)])),
    calibration,
    imbalance: {
      majorityClass: majority[0], majorityRatio: +(majority[1] / n).toFixed(3),
      minorityClass: minority[0] !== majority[0] ? minority[0] : null,
      minorityRatio: +(minority[1] / n).toFixed(3),
    },
    splitAudit: {
      train: split.train.length, val: split.val.length, test: split.test.length,
      leakage: false, unassigned: split.unassigned,
    },
    notes,
  }
}

/**
 * Build labeled pairs from FINALIZED dataset items.
 * Ground-truth resolution order per item:
 *   1. expert corrections JSON (per-indicator values — TRUE ground truth)
 *   2. finalLabel (doctor outcome / agreement code) — pairs each prediction
 *      against the code (agreement-level metrics)
 */
export function pairsFromDatasetItems(items: {
  aiPrediction: string | null; finalLabel: string | null; aiConfidence: number | null; patientHash: string | null
}[]): LabeledPair[] {
  const pairs: LabeledPair[] = []
  for (const it of items) {
    if (!it.finalLabel) continue
    const preds = safeJsonArr(it.aiPrediction)
    // per-indicator corrections stored on the item? (parsed via datasets helper)
    const corrections = parseCorrections(it.finalLabel)
    if (corrections) {
      // corrections present → ONLY corrected indicators have ground truth;
      // uncorrected ones are noise and are skipped (never paired vs the JSON blob)
      const byIndicator = new Map(corrections.map((c) => [c.indicator, c.value]))
      for (const p of preds) {
        const corrected = byIndicator.get(p.indicator)
        if (corrected == null) continue
        pairs.push({
          predicted: `${p.indicator}:${String(p.value)}`,
          actual: `${p.indicator}:${corrected}`,
          confidence: typeof p.confidence === 'number' ? p.confidence : (it.aiConfidence ?? 0),
          patientHash: it.patientHash,
        })
      }
      continue
    }
    // agreement/outcome-level label (code): pair every prediction against the code
    for (const p of preds) {
      if (!p?.indicator || p.value == null) continue
      pairs.push({
        predicted: `${p.indicator}:${String(p.value)}`,
        actual: `${p.indicator}:${it.finalLabel}`,
        confidence: typeof p.confidence === 'number' ? p.confidence : (it.aiConfidence ?? 0),
        patientHash: it.patientHash,
      })
    }
  }
  return pairs
}

/**
 * Run a full evaluation for a model on the latest FROZEN dataset (or the
 * draft when includeDraft=true — labeled for ops smoke checks). Persists
 * AIEvaluationReport, refreshes AIModel.metrics, publishes the event.
 */
export async function evaluateModel(opts: {
  modelId?: string; datasetId?: string; includeDraft?: boolean; createdById?: string
}) {
  const model = opts.modelId
    ? await db.aIModel.findUnique({ where: { id: opts.modelId } })
    : await db.aIModel.findFirst({ where: { isActive: true } })
  if (!model) throw new NotFoundError('مدل یافت نشد | Model not found')

  let dataset = opts.datasetId
    ? await db.aIDataset.findUnique({ where: { id: opts.datasetId } })
    : await db.aIDataset.findFirst({ where: { status: 'FROZEN' }, orderBy: { frozenAt: 'desc' } })
  if (!dataset && opts.includeDraft) {
    dataset = await db.aIDataset.findFirst({ where: { status: 'DRAFT' }, orderBy: { version: 'desc' } })
  }
  if (!dataset) throw new BusinessRuleError('دیتاست FROZEN برای ارزیابی وجود ندارد | No FROZEN dataset to evaluate against')

  const items = await db.aIDatasetItem.findMany({
    where: { datasetId: dataset.id, reviewStatus: 'FINALIZED' },
  })
  const pairs = pairsFromDatasetItems(items)
  const suite = computeMetrics(pairs, items)

  const report = await db.aIEvaluationReport.create({
    data: {
      modelId: model.id, datasetId: dataset.id,
      metrics: JSON.stringify(suite),
      summary: `n=${suite.sampleCount} · acc=${suite.accuracy} · macro-F1=${suite.macro.f1} · dataset=${dataset.name}@v${dataset.version}`,
      createdById: opts.createdById ?? null,
    },
  })

  // refresh the registry row — computed metrics replace hand-entered values
  await db.aIModel.update({
    where: { id: model.id },
    data: {
      metrics: JSON.stringify(suite),
      trainingDataset: `${dataset.name}@v${dataset.version}`,
      trainingDatasetVersion: `v${dataset.version}`,
      approvalStatus: model.approvalStatus === 'DEPLOYED' ? 'DEPLOYED' : 'EVALUATION',
    },
  })

  await publish(Events.AiEvaluationCompleted, {
    reportId: report.id, modelId: model.id, modelName: model.name,
    dataset: `${dataset.name}@v${dataset.version}`,
    accuracy: suite.accuracy, macroF1: suite.macro.f1,
  })
  log.info('model evaluated', { model: model.name, dataset: dataset.name, n: suite.sampleCount, acc: suite.accuracy })
  return { report: { id: report.id, createdAt: report.createdAt }, suite }
}

/** List recent evaluation reports (admin overview). */
export async function listEvaluationReports(take = 10) {
  const reports = await db.aIEvaluationReport.findMany({
    orderBy: { createdAt: 'desc' }, take,
    include: { model: { select: { name: true, version: true } }, dataset: { select: { name: true, version: true } } },
  })
  return reports.map((r) => ({ ...r, metrics: safeJson(r.metrics) }))
}

function avg(xs: number[]): number { return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0 }

function safeJson(raw: string | null): unknown {
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

function safeJsonArr(raw: string | null): { indicator?: string; value?: string; confidence?: number }[] {
  const v = safeJson(raw)
  return Array.isArray(v) ? v : []
}
