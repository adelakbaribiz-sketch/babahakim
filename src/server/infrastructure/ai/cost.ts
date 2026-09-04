// ── BabaHakim AI/ML ENGINE · AI Cost Tracking (PHASE 11, ED-128) ────────────
// Cost model per provider type, persisted per inference (AIInferenceLog.
// costUnits) and aggregated per window. v1 providers are local CPU jobs →
// cost = CPU-ms × rate. LLM providers (future) plug token-based rates into
// the same interface — the accounting pipeline is provider-agnostic.
import { db } from '@/lib/db'
import { childLogger } from '@/server/core/logger'
import { publish, Events } from '@/server/infrastructure/events'
import { AI_COST } from './constants'

const log = childLogger({ svc: 'ai-cost' })

export type ProviderCostKind = 'LOCAL_CPU' | 'HOSTED_LLM'

export interface CostModel {
  kind: ProviderCostKind
  /** cost units per inference-millisecond (LOCAL_CPU) */
  cpuMsRate: number
  /** cost units per 1K input tokens / 1K output tokens (HOSTED_LLM) */
  tokenRates?: { input1k: number; output1k: number }
}

export const COST_MODELS: Record<string, CostModel> = {
  TongueModelV1: { kind: 'LOCAL_CPU', cpuMsRate: AI_COST.cpuMsRate },
}

/** Estimate the cost of one inference in normalized cost units. */
export function estimateCost(providerName: string, processingMs: number, opts: { tokens?: { input: number; output: number }; failed?: boolean } = {}): number {
  const model = COST_MODELS[providerName]
  if (opts.failed) return AI_COST.failedRunUnits
  if (!model) return +(processingMs * AI_COST.cpuMsRate).toFixed(4) // conservative default
  if (model.kind === 'HOSTED_LLM' && opts.tokens && model.tokenRates) {
    return +((opts.tokens.input / 1000) * model.tokenRates.input1k
      + (opts.tokens.output / 1000) * model.tokenRates.output1k).toFixed(4)
  }
  return +(processingMs * model.cpuMsRate).toFixed(4)
}

/** Monthly cost roll-up + budget guard (alert at 80% of cap). */
export async function costStats() {
  const monthStart = new Date()
  monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0)
  const rows = await db.aIInferenceLog.findMany({
    where: { createdAt: { gte: monthStart } },
    select: { costUnits: true, status: true, modelName: true },
  })
  const byModel: Record<string, number> = {}
  for (const r of rows) byModel[r.modelName] = +((byModel[r.modelName] || 0) + (r.costUnits ?? 0)).toFixed(2)
  const total = +rows.reduce((s, r) => s + (r.costUnits ?? 0), 0).toFixed(2)
  const cap = AI_COST.monthlyBudgetUnits
  const ratio = cap > 0 ? +(total / cap).toFixed(3) : 0

  if (cap > 0 && ratio >= AI_COST.budgetAlertRatio) {
    await publish(Events.AiBudgetAlert, {
      total, cap, ratio,
      severity: ratio >= 1 ? 'EXCEEDED' : 'WARNING',
    })
    log.warn('AI budget threshold', { total, cap, ratio })
  }
  return { month: monthStart.toISOString().slice(0, 7), total, cap, ratio, byModel, alert: ratio >= AI_COST.budgetAlertRatio }
}
