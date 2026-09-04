// ── BabaHakim AI/ML ENGINE · Policy Constants (PHASE 11) ───────────────────
// Single source of truth for AI engineering thresholds and policies.
// These constants implement the charter mandate: AI output is NEVER a final
// medical result — every prediction must pass the human validation gate
// (Expert1 → Expert2 → Doctor) before it can influence clinical decisions.

/** Charter/spec §2: AI is assistive ONLY — enforced by validation-gate.ts. */
export const AI_SUGGESTION_ONLY = {
  policyFa: 'خروجی هوش مصنوعی صرفاً پیشنهاد کمکی است؛ هیچ نتیجه پزشکی حساس بدون بازبینی انسانی قطعی نیست.',
  policyEn: 'AI output is an assistive suggestion only; no sensitive medical result is final without human review.',
} as const

/** Overall confidence below this → flagged LOW_CONFIDENCE in monitoring + UI. */
export const LOW_CONFIDENCE_THRESHOLD = 0.35

/** PSI (Population Stability Index) drift thresholds — industry standard. */
export const PSI_WARN = 0.1 // mild drift — log warning
export const PSI_ALARM = 0.25 // severe drift — alert + notify admins

/** Default dataset split policy — PATIENT-level to prevent leakage (spec §63). */
export const DEFAULT_SPLIT_POLICY = {
  level: 'PATIENT' as const, // never 'IMAGE' — same patient must not span train/test
  ratios: { train: 0.7, val: 0.15, test: 0.15 },
  seed: 42,
}

/** Cost model (ED-128): CPU-time rate for local deterministic providers. */
export const AI_COST = {
  /** cost units per millisecond of CPU inference (local provider estimate) */
  cpuMsRate: 0.0001,
  /** flat units per failed/retried inference (wasted compute) */
  failedRunUnits: 0.5,
  /** monthly budget cap in cost units — 80% triggers AiBudgetAlert */
  monthlyBudgetUnits: Number(process.env.AI_MONTHLY_BUDGET_UNITS || 50_000),
  budgetAlertRatio: 0.8,
} as const

/** Feature-extraction pipeline version (bump when storage.ts feature logic changes). */
export const PREPROCESSING_VERSION = 1

/** Stable indicator codes the output guard allows (mirrors provider.ts). */
export const AI_INDICATOR_ALLOWLIST = [
  'BODY_COLOR', 'COATING', 'MOISTURE', 'TEXTURE', 'TEMPERAMENT_HINT',
] as const

/** Dataset item review states. */
export const DATASET_ITEM_STATUSES = [
  'PENDING_LABEL', 'LABELED', 'FINALIZED', 'EXCLUDED',
] as const

/** AI review decisions (AI_REVIEW machine) that count as dataset labels. */
export const REVIEW_DECISION_LABELS = {
  ACCEPTED: 'AGREE_WITH_AI',
  MODIFIED: 'PARTIALLY_AGREE',
  REJECTED: 'DISAGREE',
} as const
