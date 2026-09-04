// ── BabaHakim Backend · Application Service: AI/ML Ops (PHASE 11) ───────────
// Admin/expert operations over the AI engine: overview aggregation, dataset
// lifecycle actions, evaluation triggering, monitoring snapshot, re-runs.
// Controllers stay thin (ED-93); all heavy work runs through jobs/async.
import { db } from '@/lib/db'
import type { AuthContext } from '@/lib/auth'
import type { RequestContext } from '@/server/core/context'
import { BusinessRuleError, NotFoundError, ValidationError } from '@/server/core/errors'
import { writeAudit } from '@/server/infrastructure/audit'
import { enqueue } from '@/server/infrastructure/jobs'
import {
  datasetStats, freezeDataset, excludeDatasetItem, listEvaluationReports,
  inferenceStats, predictionClassBias, costStats, listPromptTemplates,
} from '@/server/infrastructure/ai'
import { rerunAnalysis } from '@/server/infrastructure/ai/pipeline'

/** Dataset snapshot for the admin view (thin wrapper — routes never import infra). */
export async function listDatasets() {
  return datasetStats()
}

/* ── Overview: one call for the AI ops dashboard ─────────────────────────── */

export async function aiOverview() {
  const [models, datasets, monitoring, bias, cost, reports] = await Promise.all([
    db.aIModel.findMany({ orderBy: { createdAt: 'desc' } }),
    datasetStats(),
    inferenceStats(168),
    predictionClassBias(168),
    costStats(),
    listEvaluationReports(5),
  ])
  return {
    models: models.map((m) => ({
      id: m.id, name: m.name, version: m.version, provider: m.provider,
      isActive: m.isActive, approvalStatus: m.approvalStatus,
      metrics: safeJson(m.metrics), trainingDataset: m.trainingDataset,
      trainingDatasetVersion: m.trainingDatasetVersion,
      preprocessingVersion: m.preprocessingVersion,
      promptKey: m.promptKey, promptVersion: m.promptVersion,
      confidenceThreshold: m.confidenceThreshold,
      hasDriftBaseline: !!m.driftBaseline,
      trainingDate: m.trainingDate, createdAt: m.createdAt,
    })),
    dataset: datasets,
    monitoring,
    bias,
    cost,
    reports,
  }
}

/* ── Dataset actions ─────────────────────────────────────────────────────── */

export async function datasetAction(
  auth: AuthContext, ctx: RequestContext,
  input: { action: 'freeze' | 'exclude'; itemId?: string; reason?: string },
) {
  switch (input.action) {
    case 'freeze': {
      const frozen = await freezeDataset(auth.user.id)
      await writeAudit(ctx, {
        userId: auth.user.id, action: 'FREEZE_AI_DATASET', entity: 'AIDataset', entityId: frozen.id,
        newValues: { name: frozen.name, version: frozen.version, itemCount: frozen.itemCount },
      })
      return { dataset: { id: frozen.id, name: frozen.name, version: frozen.version, itemCount: frozen.itemCount } }
    }
    case 'exclude': {
      if (!input.itemId) throw new ValidationError('شناسه آیتم الزامی است | itemId required')
      const item = await excludeDatasetItem(input.itemId, input.reason || '')
      await writeAudit(ctx, {
        userId: auth.user.id, action: 'EXCLUDE_AI_DATASET_ITEM', entity: 'AIDatasetItem', entityId: item.id,
        newValues: { reason: input.reason },
      })
      return { item }
    }
    default:
      throw new ValidationError('اقدام نامعتبر | Invalid action')
  }
}

/* ── Evaluation ──────────────────────────────────────────────────────────── */

/** Enqueue the evaluation job (async — non-blocking per charter rule). */
export async function requestEvaluation(
  auth: AuthContext, ctx: RequestContext,
  input: { modelId?: string; datasetId?: string; includeDraft?: boolean },
) {
  if (input.includeDraft && input.datasetId) {
    throw new BusinessRuleError('ارزیابی پیش‌نویس یا دیتاست مشخص — یکی را انتخاب کنید | Choose includeDraft XOR datasetId')
  }
  const jobId = enqueue('ai-evaluation', { ...input, createdById: auth.user.id }, { maxAttempts: 2, backoffMs: 5000 })
  await writeAudit(ctx, {
    userId: auth.user.id, action: 'RUN_AI_EVALUATION', entity: 'AIEvaluationReport', entityId: jobId,
    newValues: { modelId: input.modelId ?? 'ACTIVE', datasetId: input.datasetId ?? (input.includeDraft ? 'DRAFT' : 'LATEST_FROZEN') },
  })
  return { jobId, queued: true }
}

/* ── Monitoring ──────────────────────────────────────────────────────────── */

export async function monitoringSnapshot() {
  const [stats, bias, cost, driftRun] = await Promise.all([
    inferenceStats(168),
    predictionClassBias(168),
    costStats(),
    import('@/server/infrastructure/ai/monitoring').then((m) => m.runDriftCheck()),
  ])
  return { inference: stats, bias, cost, drift: driftRun }
}

/* ── Prompts ─────────────────────────────────────────────────────────────── */

export async function promptRegistry() {
  const [code, rows] = await Promise.all([
    Promise.resolve(listPromptTemplates()),
    db.aIPromptTemplate.findMany({ orderBy: [{ key: 'asc' }, { version: 'desc' }] }),
  ])
  return {
    prompts: rows.map((r) => ({ ...r, variables: safeJson(r.variables) })),
    codeRegistryCount: code.length,
  }
}

/* ── Re-run ──────────────────────────────────────────────────────────────── */

/** Re-run AI analysis for a case (EXPERT_1/ADMIN ops — new version, history kept). */
export async function rerunCaseAi(auth: AuthContext, ctx: RequestContext, caseId: string) {
  const c = await db.medicalCase.findUnique({ where: { id: caseId } })
  if (!c || c.deletedAt) throw new NotFoundError('پرونده یافت نشد | Case not found')
  const result = await rerunAnalysis(caseId, auth.user.id)
  await writeAudit(ctx, {
    userId: auth.user.id, action: 'RERUN_AI_ANALYSIS', entity: 'MedicalCase', entityId: caseId,
    newValues: { analysisId: result.analysisId, model: `${result.modelName}@v${result.modelVersion}` },
  })
  return result
}

function safeJson(raw: string | null): unknown {
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}
