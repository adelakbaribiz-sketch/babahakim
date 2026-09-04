// ── BabaHakim AI/ML ENGINE · Inference Pipeline (PHASE 11) ─────────────────
// The single path every AI inference takes:
//   resolve model (DB registry) → input guard → provider.analyze
//   → output guard (schema + allowlist + clamp) → persist AIAnalysis
//   → telemetry (AIInferenceLog: versions + hash + cost) → event
//
// Hard rules baked in:
//   · AI output ALWAYS lands as reviewStatus=PENDING_REVIEW — the human
//     validation gate (validation-gate.ts) decides when it may ground a
//     clinical decision, never the pipeline.
//   · runs OUTSIDE the request path (JobQueue 'ai-analysis', ED-102/114).
//   · failures are logged as FAILED telemetry (with cost) and rethrown —
//     the job queue owns retry/DLQ semantics.
import { db } from '@/lib/db'
import { childLogger } from '@/server/core/logger'
import { publish, Events } from '@/server/infrastructure/events'
import { resolveActiveModel } from './registry'
import { validateAiInput, validateAiOutput, isReplayedInput, sha256File } from './security'
import { recordInference } from './monitoring'
import { estimateCost } from './cost'
import type { AIResult } from '@/lib/ai/provider'
import type { QualityReport } from '@/lib/storage'

const log = childLogger({ svc: 'ai-pipeline' })

export interface RunInferenceResult {
  analysisId: string
  modelName: string
  modelVersion: number
  confidence: number
  replay: boolean
  processingMs: number
}

/**
 * Run an AI analysis for one case/image with the full guard+telemetry
 * pipeline. Keeps the historical `runAIAnalysis` contract.
 */
export async function runAIAnalysis(caseId: string, imageId: string): Promise<RunInferenceResult> {
  const image = await db.medicalImage.findUnique({ where: { id: imageId } })
  if (!image) throw new Error('image not found')
  validateAiInput({
    id: image.id, caseId: image.caseId, status: image.status,
    aiPath: image.aiPath, quality: image.quality,
  }, caseId)

  const resolved = await resolveActiveModel()
  const inputSha = await sha256File(image.aiPath!).catch(() => null)
  const replay = inputSha ? await isReplayedInput(inputSha, resolved.modelName) : false

  let result: AIResult
  try {
    result = validateAiOutput(await resolved.providerInstance.analyze(image.aiPath!, readQuality(image.quality)))
  } catch (e) {
    // failed run telemetry (cost + provenance) — then rethrow for job retry/DLQ
    await recordInference({
      analysisId: null, caseId, imageId, modelId: resolved.modelId,
      modelName: resolved.modelName, modelVersion: resolved.modelVersion,
      datasetVersion: resolved.datasetVersion, promptKey: resolved.promptKey,
      promptVersion: resolved.promptVersion, preprocessingVersion: String(resolved.preprocessingVersion),
      inputSha256: inputSha, confidence: null, quality: null, processingMs: null,
      costUnits: estimateCost(resolved.provider, 0, { failed: true }),
      status: 'FAILED', errorCode: e instanceof Error ? e.name : 'UNKNOWN', replay,
    }).catch(() => { /* telemetry must never mask the real error */ })
    throw e
  }

  const analysis = await db.aIAnalysis.create({
    data: {
      caseId, imageId, modelId: resolved.modelId,
      modelName: resolved.modelName, modelVersion: resolved.modelVersion,
      predictions: JSON.stringify(result.predictions),
      confidence: result.confidence, quality: result.quality,
      features: JSON.stringify(result.features),
      explainability: JSON.stringify(result.explainability),
      processingMs: result.processingMs,
      // invariant: ALWAYS pending human review (validation-gate owns escalation)
      reviewStatus: 'PENDING_REVIEW', humanReviewed: false,
    },
  })

  await db.medicalImage.update({ where: { id: imageId }, data: { status: 'PROCESSED' } })
  await db.medicalCase.update({ where: { id: caseId }, data: { aiAnalysisId: analysis.id } })

  await recordInference({
    analysisId: analysis.id, caseId, imageId, modelId: resolved.modelId,
    modelName: resolved.modelName, modelVersion: resolved.modelVersion,
    datasetVersion: resolved.datasetVersion, promptKey: resolved.promptKey,
    promptVersion: resolved.promptVersion, preprocessingVersion: String(resolved.preprocessingVersion),
    inputSha256: inputSha, confidence: result.confidence, quality: result.quality,
    processingMs: result.processingMs,
    costUnits: estimateCost(resolved.provider, result.processingMs),
    status: 'OK', errorCode: null, replay,
  }).catch((e) => log.warn('inference telemetry failed', { error: e instanceof Error ? e.message : String(e) }))

  await publish(Events.AiAnalysisCompleted, { caseId, imageId, analysisId: analysis.id })
  log.info('inference completed', {
    model: `${resolved.modelName}@v${resolved.modelVersion}`,
    confidence: result.confidence, ms: result.processingMs, replay, fallback: resolved.fallback,
  })

  return {
    analysisId: analysis.id,
    modelName: resolved.modelName,
    modelVersion: resolved.modelVersion,
    confidence: result.confidence,
    replay,
    processingMs: result.processingMs,
  }
}

/**
 * Re-run analysis for a case (admin/expert ops — e.g. after model swap).
 * History is preserved: a NEW AIAnalysis row is appended, previous rows
 * stay untouched for audit. New row starts PENDING_REVIEW like any other.
 */
export async function rerunAnalysis(caseId: string, _actorId?: string): Promise<RunInferenceResult> {
  const c = await db.medicalCase.findUnique({ where: { id: caseId } })
  if (!c || c.deletedAt) throw new Error('case not found')
  const image = await db.medicalImage.findFirst({
    where: { caseId }, orderBy: { createdAt: 'desc' },
  })
  if (!image || !image.aiPath) throw new Error('no analyzable image for case')
  return runAIAnalysis(caseId, image.id)
}

function readQuality(quality: string | null): QualityReport {
  try {
    const q = JSON.parse(quality || '{}') as Partial<QualityReport>
    return {
      score: Number(q.score ?? 70),
      blur: Number(q.blur ?? 0),
      brightness: Number(q.brightness ?? 128),
      exposure: (q.exposure as QualityReport['exposure']) ?? 'NORMAL',
      resolution: String(q.resolution ?? 'unknown'),
      resolutionOk: q.resolutionOk ?? true,
      orientation: String(q.orientation ?? 'unknown'),
      issues: Array.isArray(q.issues) ? q.issues : [],
    }
  } catch {
    return {
      score: 70, blur: 0, brightness: 128, exposure: 'NORMAL',
      resolution: 'unknown', resolutionOk: true, orientation: 'unknown', issues: [],
    }
  }
}
