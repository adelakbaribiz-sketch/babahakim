// ── BabaHakim AI/ML ENGINE · AI Security Guards (PHASE 11, ED-129) ─────────
// Defense-in-depth around the inference call:
//   input guard  — the image is in a valid state, belongs to the case, and
//                  passes quality/pixel sanity before model invocation
//   output guard — the AIResult is schema-validated (predictions bounded,
//                  indicators from allowlist, confidence clamped 0..1)
//                  BEFORE persistence — a rogue/buggy provider can never
//                  write unbounded or off-allowlist content into the DB
//   replay guard — duplicate input hashes are flagged on the InferenceLog
//                  (re-analysis is allowed but visible as telemetry)
//   training gate— no training on unfrozen/unapproved datasets (spec §11)
import { z } from 'zod'
import { AppError, BusinessRuleError } from '@/server/core/errors'
import { childLogger } from '@/server/core/logger'
import { AI_INDICATOR_ALLOWLIST, LOW_CONFIDENCE_THRESHOLD } from './constants'
import type { AIResult, IndicatorPrediction } from '@/lib/ai/provider'
import type { QualityReport } from '@/lib/storage'

const log = childLogger({ svc: 'ai-security' })

/* ── Output schema (ED-129) ─────────────────────────────────────────────── */

export const indicatorPredictionSchema = z.object({
  indicator: z.string().min(1).max(64),
  labelFa: z.string().min(1).max(120),
  labelEn: z.string().min(1).max(120),
  value: z.string().min(1).max(120),
  valueEn: z.string().max(120).optional(), // English display value (UI falls back to value)
  confidence: z.number().finite(), // clamped to 0..1 below (soft fix)
  noteFa: z.string().max(600),
  noteEn: z.string().max(600),
})

export const aiResultSchema = z.object({
  provider: z.string().min(1).max(64),
  model: z.string().min(1).max(64),
  version: z.number().int().min(1),
  predictions: z.array(indicatorPredictionSchema).min(1).max(20),
  confidence: z.number().finite(), // clamped to 0..1 below (soft fix)
  quality: z.number().finite(), // clamped to 0..1 below
  explainability: z.object({ fa: z.array(z.string().max(800)).max(20), en: z.array(z.string().max(800)).max(20) }),
  features: z.record(z.string(), z.unknown()), // feature fields bounds-checked below
  processingMs: z.number().int().min(0),
  disclaimerFa: z.string().min(1).max(800),
  disclaimerEn: z.string().min(1).max(800),
})

/** Numeric tongue-feature fields must all be finite and in sane ranges. */
const FEATURE_BOUNDS: Record<string, [number, number]> = {
  redness: [0, 1], pallor: [0, 1], purpleIndex: [0, 1],
  coatingWhite: [0, 1], coatingYellow: [0, 1],
  textureRoughness: [0, 1], brightness: [0, 255],
}

/**
 * Validate + sanitize a provider result. Returns a SAFE copy.
 * Throws AppError(INTERNAL) on structural violations (provider bug),
 * clamps out-of-range confidences (soft fix, logged).
 */
export function validateAiOutput(result: AIResult): AIResult {
  const parsed = aiResultSchema.safeParse(result)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new AppError('INTERNAL', `خروجی مدل نامعتبر است | Invalid AI output — refusing to persist`, 500, { issues })
  }
  const out = {
    ...parsed.data,
    features: parsed.data.features as unknown as AIResult['features'],
  } as AIResult

  // indicator allowlist — off-list codes are dropped (not persisted)
  const before = out.predictions.length
  out.predictions = out.predictions.filter((p) => (AI_INDICATOR_ALLOWLIST as readonly string[]).includes(p.indicator))
  if (before !== out.predictions.length) {
    log.warn('off-allowlist indicators dropped', { dropped: before - out.predictions.length })
  }
  if (out.predictions.length === 0) {
    throw new AppError('INTERNAL', 'خروجی مدل بدون شاخص معتبر است | AI output has no allowlisted indicators', 500)
  }

  // clamp per-prediction confidences (soft fix)
  for (const p of out.predictions) p.confidence = Math.min(1, Math.max(0, p.confidence))
  out.confidence = Math.min(1, Math.max(0, out.confidence))
  out.quality = Math.min(1, Math.max(0, out.quality))

  // feature bounds (finiteness guards adversarial NaN/Infinity)
  const featureRec = out.features as unknown as Record<string, unknown>
  for (const [field, [lo, hi]] of Object.entries(FEATURE_BOUNDS)) {
    const v = featureRec[field]
    if (typeof v === 'number' && !Number.isFinite(v)) {
      throw new AppError('INTERNAL', `ویژگی مدل نامعتبر: ${field} | Non-finite model feature`, 500)
    }
    if (typeof v === 'number') featureRec[field] = Math.min(hi, Math.max(lo, v))
  }

  // disclaimers must stay present — the human-validation contract text
  if (!out.disclaimerFa.includes('پیشنهاد') && !out.disclaimerEn.toLowerCase().includes('suggestion')) {
    out.disclaimerFa = 'این تحلیل صرفاً پیشنهاد کمکی است و نیازمند بازبینی انسانی می‌باشد.'
    out.disclaimerEn = 'This analysis is an assistive suggestion only and requires human review.'
  }

  return out
}

/** Flag low-confidence outputs (monitoring/UI signal, spec §60). */
export function isLowConfidence(result: AIResult): boolean {
  return result.confidence < LOW_CONFIDENCE_THRESHOLD
}

/* ── Input guard ─────────────────────────────────────────────────────────── */

export interface AiInputImage {
  id: string
  caseId: string | null
  status: string
  aiPath: string | null
  quality: string | null
}

/**
 * Validate the image is in an analyzable state before invoking the model.
 * Throwing AppError keeps the job-retry semantics honest (bad input →
 * FAILED log, no infinite retries on permanent states).
 */
export function validateAiInput(image: AiInputImage, caseId: string): void {
  if (!image.caseId || image.caseId !== caseId) {
    throw new AppError('CONFLICT', 'تصویر به این پرونده تعلق ندارد | Image does not belong to this case', 409)
  }
  if (image.status === 'REJECTED') {
    throw new BusinessRuleError('تصویر رد شده قابل تحلیل نیست | Rejected image cannot be analyzed')
  }
  if (!image.aiPath) {
    throw new BusinessRuleError('نسخه AI تصویر آماده نیست | AI rendition not ready')
  }
}

/* ── Replay guard ────────────────────────────────────────────────────────── */

/** True when the same input hash was already analyzed by this model. */
export async function isReplayedInput(inputSha256: string, modelName: string): Promise<boolean> {
  const { db } = await import('@/lib/db')
  const prior = await db.aIInferenceLog.findFirst({
    where: { inputSha256, modelName, status: 'OK' },
    select: { id: true },
  })
  return !!prior
}

/* ── Training gate (spec §11 — no uncontrolled training on live data) ────── */

export function assertCanTrain(datasetStatus: string, modelApproval: string): void {
  if (datasetStatus !== 'FROZEN') {
    throw new BusinessRuleError('آموزش فقط روی دیتاست FROZEN مجاز است | Training requires a FROZEN dataset (no live writes)')
  }
  if (!['EVALUATION', 'APPROVED'].includes(modelApproval)) {
    throw new BusinessRuleError('مدل باید در وضعیت EVALUATION/APPROVED باشد | Model must be in EVALUATION or APPROVED state')
  }
}

/** Salted one-way patient hash — the dataset's only patient reference (no PHI). */
export async function hashPatientRef(patientId: string): Promise<string> {
  const { createHash } = await import('node:crypto')
  const salt = process.env.AI_DATASET_HASH_SALT || 'babahakim-dev-salt' // set a real secret in production
  return createHash('sha256').update(`${salt}:${patientId}`).digest('hex').slice(0, 32)
}

/** Compute the input content hash used by the replay guard. */
export async function sha256File(path: string): Promise<string> {
  const { createHash } = await import('node:crypto')
  const { readFile } = await import('node:fs/promises')
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

// re-export for pipeline typing convenience
export type { QualityReport } from '@/lib/storage'
