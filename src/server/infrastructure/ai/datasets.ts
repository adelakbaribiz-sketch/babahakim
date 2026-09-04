// ── BabaHakim AI/ML ENGINE · Dataset Management (PHASE 11, ED-123/124) ─────
// Closes the feedback loop (spec §11/§12): every human review of an AI
// analysis becomes a labeled dataset item —
//     AI prediction ── vs ── Expert1 label ── Expert2 label ── Final label
// with a DISAGREEMENT flag when experts diverge, de-identified patient
// reference (salted hash), versioned immutable datasets (DRAFT → FROZEN),
// and PATIENT-LEVEL splits so one patient can never span train/test
// (spec §63 — data-leakage prevention).
//
// The loop is event-driven: reviews arrive via Events.AiReviewDecided →
// bootstrap subscriber → recordReviewLabel. No clinical code imports this.
import { db } from '@/lib/db'
import { BusinessRuleError, NotFoundError, ValidationError } from '@/server/core/errors'
import { childLogger } from '@/server/core/logger'
import { hashPatientRef } from './security'
import { DEFAULT_SPLIT_POLICY, DATASET_ITEM_STATUSES } from './constants'

const log = childLogger({ svc: 'ai-datasets' })

export const DEFAULT_DATASET_NAME = 'tongue-learning'

/* ── Dataset lifecycle ───────────────────────────────────────────────────── */

/** The active DRAFT dataset (creating v1 on first use — idempotent). */
export async function ensureDraftDataset(createdById?: string): Promise<{ id: string; name: string; version: number }> {
  const draft = await db.aIDataset.findFirst({
    where: { name: DEFAULT_DATASET_NAME, status: 'DRAFT' },
    orderBy: { version: 'desc' },
  })
  if (draft) return draft
  const last = await db.aIDataset.findFirst({
    where: { name: DEFAULT_DATASET_NAME }, orderBy: { version: 'desc' },
  })
  const next = (last?.version || 0) + 1
  return db.aIDataset.create({
    data: {
      name: DEFAULT_DATASET_NAME, version: next, status: 'DRAFT',
      splitPolicy: JSON.stringify(DEFAULT_SPLIT_POLICY),
      createdById: createdById ?? null,
      description: 'Learning dataset from human-reviewed AI analyses (feedback loop)',
    },
  })
}

/**
 * Freeze the current draft → immutable. A new empty draft is opened.
 * Frozen datasets are the ONLY datasets training/evaluation may consume
 * (assertCanTrain in security.ts).
 */
export async function freezeDataset(createdById?: string) {
  const draft = await ensureDraftDataset()
  const count = await db.aIDatasetItem.count({ where: { datasetId: draft.id } })
  const frozen = await db.aIDataset.update({
    where: { id: draft.id },
    data: { status: 'FROZEN', frozenAt: new Date(), itemCount: count },
  })
  await ensureDraftDataset(createdById) // open the next draft
  log.info('dataset frozen', { dataset: `${frozen.name}@v${frozen.version}`, items: count })
  return frozen
}

export async function datasetStats() {
  const datasets = await db.aIDataset.findMany({ orderBy: { createdAt: 'desc' } })
  const active = datasets.find((d) => d.status === 'DRAFT')
  const items = active
    ? await db.aIDatasetItem.findMany({
        where: { datasetId: active.id },
        orderBy: { updatedAt: 'desc' }, take: 500,
      })
    : []
  const labeled = items.filter((i) => i.reviewStatus === 'LABELED' || i.reviewStatus === 'FINALIZED')
  return {
    datasets: datasets.map((d) => ({ ...d, splitPolicy: safeJson(d.splitPolicy) })),
    activeDraft: active ? { id: active.id, name: active.name, version: active.version } : null,
    items: items.map(serializeItem),
    stats: {
      total: items.length,
      labeled: labeled.length,
      finalized: items.filter((i) => i.reviewStatus === 'FINALIZED').length,
      disagreement: items.filter((i) => i.disagreement).length,
      excluded: items.filter((i) => i.reviewStatus === 'EXCLUDED').length,
      withFinalLabel: items.filter((i) => !!i.finalLabel).length,
    },
  }
}

/* ── Feedback loop: labels in ────────────────────────────────────────────── */

export interface ReviewLabelInput {
  analysisId: string
  reviewerRole: 'EXPERT_1' | 'EXPERT_2' | 'DOCTOR'
  reviewerId: string
  decision: 'ACCEPTED' | 'MODIFIED' | 'REJECTED'
  comment?: string
  /** per-indicator corrected values — true ground truth when provided */
  corrections?: { indicator: string; value: string }[]
}

/**
 * Record a human review decision as a dataset label. Idempotent upsert:
 * the item is created on first review of an analysis, then updated.
 * Disagreement is flagged when Expert1 and Expert2 labels differ.
 * When per-indicator corrections are provided they become the label
 * (true ground truth); otherwise the agreement code is used.
 */
export async function recordReviewLabel(input: ReviewLabelInput) {
  const analysis = await db.aIAnalysis.findUnique({
    where: { id: input.analysisId },
    include: { case: { select: { code: true, patientId: true } }, image: { select: { id: true } } },
  })
  if (!analysis) throw new NotFoundError('تحلیل AI یافت نشد | AI analysis not found')

  const dataset = await ensureDraftDataset()
  const agreementCode = input.decision === 'ACCEPTED' ? 'AGREE_WITH_AI'
    : input.decision === 'MODIFIED' ? 'PARTIALLY_AGREE' : 'DISAGREE'
  // corrections (indicator→value) are the richest label; fall back to the code
  const label = input.corrections && input.corrections.length > 0
    ? JSON.stringify(input.corrections)
    : agreementCode
  const patientHash = analysis.case.patientId
    ? await hashPatientRef(analysis.case.patientId)
    : null

  const existing = await db.aIDatasetItem.findUnique({ where: { analysisId: input.analysisId } })

  const expert1 = input.reviewerRole === 'EXPERT_1'
    ? { expert1Label: label, expert1ById: input.reviewerId }
    : existing ? { expert1Label: existing.expert1Label, expert1ById: existing.expert1ById } : {}
  const expert2 = input.reviewerRole === 'EXPERT_2'
    ? { expert2Label: label, expert2ById: input.reviewerId }
    : existing ? { expert2Label: existing.expert2Label, expert2ById: existing.expert2ById } : {}

  // disagreement: different agreement codes OR divergent corrected values
  let disagreement = !!(expert1.expert1Label && expert2.expert2Label && expert1.expert1Label !== expert2.expert2Label)
  if (input.reviewerRole === 'EXPERT_2' && expert1.expert1Label && input.corrections?.length) {
    const e1 = parseCorrections(expert1.expert1Label)
    if (e1) {
      disagreement = JSON.stringify(e1) !== JSON.stringify(input.corrections)
    }
  }
  const reviewStatus = expert1.expert1Label || expert2.expert2Label ? 'LABELED' : 'PENDING_LABEL'

  const data = {
    datasetId: dataset.id,
    analysisId: analysis.id,
    imageId: analysis.imageId,
    caseCode: analysis.case.code,
    patientHash,
    aiPrediction: analysis.predictions,
    aiConfidence: analysis.confidence,
    disagreement,
    reviewStatus,
    ...expert1, ...expert2,
  }

  const item = existing
    ? await db.aIDatasetItem.update({ where: { id: existing.id }, data })
    : await db.aIDatasetItem.create({ data })
  log.debug('dataset label recorded', { analysisId: input.analysisId, role: input.reviewerRole, decision: input.decision, disagreement })
  return serializeItem(item)
}

/**
 * Final label from the downstream chain (doctor decision / case outcome).
 * Sets FINALIZED — the item now has ground truth for evaluation.
 */
export async function finalizeFinalLabel(analysisId: string, finalLabel: string, byRole = 'DOCTOR') {
  void byRole
  const existing = await db.aIDatasetItem.findUnique({ where: { analysisId } })
  if (!existing) {
    // doctor decision without a prior expert review → still capture the item
    const analysis = await db.aIAnalysis.findUnique({
      where: { id: analysisId },
      include: { case: { select: { code: true, patientId: true } }, image: { select: { id: true } } },
    })
    if (!analysis) throw new NotFoundError('تحلیل AI یافت نشد | AI analysis not found')
    const dataset = await ensureDraftDataset()
    const patientHash = analysis.case.patientId ? await hashPatientRef(analysis.case.patientId) : null
    const created = await db.aIDatasetItem.create({
      data: {
        datasetId: dataset.id, analysisId, imageId: analysis.imageId,
        caseCode: analysis.case.code, patientHash,
        aiPrediction: analysis.predictions, aiConfidence: analysis.confidence,
        finalLabel, reviewStatus: 'FINALIZED',
      },
    })
    return serializeItem(created)
  }
  const updated = await db.aIDatasetItem.update({
    where: { id: existing.id },
    data: { finalLabel, reviewStatus: 'FINALIZED' },
  })
  return serializeItem(updated)
}

/** Exclude an item from the dataset (admin QC) — reason is mandatory. */
export async function excludeDatasetItem(itemId: string, reason: string) {
  if (!reason.trim()) throw new ValidationError('دلیل حذف آیتم الزامی است | Exclusion reason required')
  const item = await db.aIDatasetItem.update({
    where: { id: itemId },
    data: { reviewStatus: 'EXCLUDED', excludedReason: reason },
  })
  return serializeItem(item)
}

/* ── Patient-level split (spec §63 anti-leakage) ────────────────────────── */

export interface SplitItem { patientHash: string | null }
export type SplitName = 'train' | 'val' | 'test'

/** Deterministic 0..1 hash for a patient key (stable across runs). */
function stableUnit(key: string, seed: number): number {
  let h = 2166136261 ^ seed
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 10_000) / 10_000
}

/**
 * PATIENT-LEVEL split: images of one patient NEVER span train/val/test.
 * Items without a patientHash (orphan) go to train by policy (flagged).
 * Deterministic given seed → reproducible experiments.
 */
export function patientLevelSplit<T extends SplitItem>(
  items: T[], ratios = DEFAULT_SPLIT_POLICY.ratios, seed = DEFAULT_SPLIT_POLICY.seed,
): { train: T[]; val: T[]; test: T[]; patientAssignments: Record<string, SplitName>; unassigned: number } {
  const sum = ratios.train + ratios.val + ratios.test
  if (Math.abs(sum - 1) > 0.001) throw new ValidationError('نسبت‌های تقسیم باید جمعاً ۱ باشند | Split ratios must sum to 1')
  if (ratios.train <= 0 || ratios.val < 0 || ratios.test < 0) {
    throw new ValidationError('نسبت‌های تقسیم نامعتبر است | Invalid split ratios')
  }

  const patientAssignments: Record<string, SplitName> = {}
  const train: T[] = [], val: T[] = [], test: T[] = []
  let unassigned = 0

  for (const item of items) {
    const key = item.patientHash
    if (!key) { train.push(item); unassigned++; continue } // orphan → train, flagged
    let bucket = patientAssignments[key]
    if (!bucket) {
      const u = stableUnit(key, seed)
      bucket = u < ratios.train ? 'train' : u < ratios.train + ratios.val ? 'val' : 'test'
      patientAssignments[key] = bucket
    }
    ;(bucket === 'train' ? train : bucket === 'val' ? val : test).push(item)
  }
  return { train, val, test, patientAssignments, unassigned }
}

/** Hard guarantee used by evaluation + future training: no patient overlap. */
export function assertNoPatientLeakage(splits: { train: SplitItem[]; val: SplitItem[]; test: SplitItem[] }): void {
  const keys = (arr: SplitItem[]) => new Set(arr.map((i) => i.patientHash).filter(Boolean) as string[])
  const trainK = keys(splits.train), valK = keys(splits.val), testK = keys(splits.test)
  for (const v of valK) if (trainK.has(v)) throw new BusinessRuleError('نقض تفکیک بیمار: patient در train و val همزمان | Leakage: patient in train∩val')
  for (const v of testK) if (trainK.has(v) || valK.has(v)) throw new BusinessRuleError('نقض تفکیک بیمار در test | Leakage: patient spans test')
}

/** De-identified export rows (no patient linkage — patientHash only). */
export async function exportDeidentified(datasetId: string) {
  const items = await db.aIDatasetItem.findMany({
    where: { datasetId, reviewStatus: { not: 'EXCLUDED' } },
    orderBy: { createdAt: 'asc' },
  })
  return items.map((i) => ({
    caseCode: i.caseCode, patientHash: i.patientHash,
    aiPrediction: safeJson(i.aiPrediction), aiConfidence: i.aiConfidence,
    expert1Label: i.expert1Label, expert2Label: i.expert2Label,
    finalLabel: i.finalLabel, disagreement: i.disagreement,
  }))
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

/** Parse a label into per-indicator corrections, if it is corrections JSON. */
export function parseCorrections(label: string | null | undefined): { indicator: string; value: string }[] | null {
  if (!label) return null
  try {
    const v = JSON.parse(label)
    if (Array.isArray(v) && v.every((x) => x && typeof x === 'object' && typeof x.indicator === 'string' && typeof x.value === 'string')) {
      return v as { indicator: string; value: string }[]
    }
    return null
  } catch { return null }
}

function safeJson(raw: string | null): unknown {
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

function serializeItem(i: {
  id: string; datasetId: string; analysisId: string | null; imageId: string | null; caseCode: string | null;
  patientHash: string | null; aiConfidence: number | null; expert1Label: string | null; expert2Label: string | null;
  finalLabel: string | null; disagreement: boolean; reviewStatus: string; excludedReason: string | null;
  createdAt: Date; updatedAt: Date;
}) {
  return {
    id: i.id, analysisId: i.analysisId, caseCode: i.caseCode, patientHash: i.patientHash,
    aiConfidence: i.aiConfidence, expert1Label: i.expert1Label, expert2Label: i.expert2Label,
    finalLabel: i.finalLabel, disagreement: i.disagreement, reviewStatus: i.reviewStatus,
    excludedReason: i.excludedReason, createdAt: i.createdAt, updatedAt: i.updatedAt,
  }
}

export { DATASET_ITEM_STATUSES }
