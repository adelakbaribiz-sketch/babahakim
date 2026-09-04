// ── BabaHakim AI/ML ENGINE · Public Exports (PHASE 11) ─────────────────────
// Consumers import from '@/server/infrastructure/ai' — module internals stay
// private except the audit-approved surface below.
export * from './constants'
export { resolveActiveModel, getActiveProvider, registerProviderFactory, listProviderFactories } from './registry'
export type { ResolvedModel } from './registry'
export {
  PROMPT_REGISTRY, renderPrompt, renderTemplate, listPromptTemplates,
  getLatestPromptVersion, ensurePromptsSeeded,
} from './prompts'
export type { PromptTemplate, PromptVariableSpec } from './prompts'
export {
  validateAiOutput, validateAiInput, isLowConfidence, isReplayedInput,
  assertCanTrain, hashPatientRef, sha256File, aiResultSchema, indicatorPredictionSchema,
} from './security'
export {
  isFinalClinicalResult, assertPresentableAsSuggestion, assertHumanValidated,
  canGroundClinicalDecision, resolveAiAssistedFlag,
} from './validation-gate'
export type { ReviewStatus, ValidatableAnalysis } from './validation-gate'
export {
  ensureDraftDataset, freezeDataset, datasetStats, recordReviewLabel,
  finalizeFinalLabel, excludeDatasetItem, patientLevelSplit, assertNoPatientLeakage,
  exportDeidentified, parseCorrections,
} from './datasets'
export type { ReviewLabelInput, SplitItem, SplitName } from './datasets'
export { computeMetrics, pairsFromDatasetItems, evaluateModel, listEvaluationReports } from './evaluation'
export type { LabeledPair, EvaluationSuite, ClassMetrics } from './evaluation'
export {
  recordInference, inferenceStats, predictionClassBias, computePSI,
  captureBaseline, runDriftCheck,
} from './monitoring'
export type { InferenceTelemetry, DriftFeatureReport } from './monitoring'
export { estimateCost, costStats, COST_MODELS } from './cost'
export type { CostModel, ProviderCostKind } from './cost'
export {
  getEmbeddingProvider, setEmbeddingProvider, cosineSimilarity, HashEmbeddingProvider,
} from './embeddings'
export type { EmbeddingProvider, EmbeddingVector } from './embeddings'
export { runAIAnalysis, rerunAnalysis } from './pipeline'
export type { RunInferenceResult } from './pipeline'
