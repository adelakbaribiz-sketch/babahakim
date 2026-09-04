// ── BabaHakim AI/ML ENGINE · Human Validation Gate (PHASE 11, ED-125) ──────
// THE charter invariant, now enforced in one place:
//
//   «AI نتیجه‌ای تولید نکند که بدون Human/Business Validation
//     نیاز به اعتماد قطعی داشته باشد»
//
//   "AI must never produce a result that demands absolute trust without
//    human/business validation."
//
// Three levels:
//   LEVEL 1  presentable-as-suggestion  → patient MAY see it, clearly framed
//            as a suggestion with confidence + disclaimer (spec §2 wants
//            confidence/uncertainty/human-review visible)
//   LEVEL 2  basis-for-decision         → Expert 1/2 may build an assessment
//            on it ONLY after review (ACCEPTED or MODIFIED — REJECTED and
//            PENDING_REVIEW block this level)
//   LEVEL 3  final-clinical-result      → NEVER attainable by AI output
//            alone; only the human chain (diagnosis by expert, approval by
//            doctor) creates final results.
import { BusinessRuleError } from '@/server/core/errors'
import { AI_SUGGESTION_ONLY } from './constants'

export type ReviewStatus = 'PENDING_REVIEW' | 'ACCEPTED' | 'MODIFIED' | 'REJECTED'

export interface ValidatableAnalysis {
  reviewStatus: string
  humanReviewed: boolean
  reviewedById: string | null
}

/** LEVEL 3 — always false. AI output can never be a final clinical result. */
export function isFinalClinicalResult(analysis: ValidatableAnalysis): false {
  void analysis
  return false
}

/**
 * LEVEL 1 — may this analysis be SHOWN (as suggestion) to a patient?
 * Yes while pending/reviewed — but only with disclaimer framing. Callers
 * must render the disclaimer + confidence (AIAnalysisCard already does).
 */
export function assertPresentableAsSuggestion(analysis: ValidatableAnalysis): void {
  // every state is presentable as a SUGGESTION; the framing is mandatory.
  // kept as an explicit function so future policies (e.g. hide REJECTED
  // from patients) have a single enforcement point.
  if (!analysis) throw new BusinessRuleError('تحلیل AI موجود نیست | AI analysis missing')
}

/**
 * LEVEL 2 — may this analysis be the BASIS of a human clinical decision?
 * Requires terminal human review: ACCEPTED or MODIFIED (a human read and
 * actively endorsed it). REJECTED / PENDING_REVIEW throw.
 */
export function assertHumanValidated(analysis: ValidatableAnalysis): void {
  if (analysis.reviewStatus === 'ACCEPTED' || analysis.reviewStatus === 'MODIFIED') {
    if (!analysis.humanReviewed || !analysis.reviewedById) {
      // data integrity: terminal status without reviewer → refuse
      throw new BusinessRuleError('وضعیت بازبینی ناسازگار است — بازبینی‌کننده ثبت نشده | Review status without reviewer')
    }
    return
  }
  if (analysis.reviewStatus === 'PENDING_REVIEW') {
    throw new BusinessRuleError(
      `تحلیل AI هنوز بازبینی انسانی نشده است. ${AI_SUGGESTION_ONLY.policyFa} | AI analysis pending human review — cannot ground a clinical decision`,
    )
  }
  // REJECTED (or unknown)
  throw new BusinessRuleError(
    `تحلیل AI توسط کارشناس رد شده و مبنای تصمیم نمی‌تواند باشد | AI analysis was rejected by a human reviewer`,
  )
}

/** Soft check (no throw) — for UI action availability. */
export function canGroundClinicalDecision(analysis: ValidatableAnalysis): boolean {
  return analysis.reviewStatus === 'ACCEPTED' || analysis.reviewStatus === 'MODIFIED'
}

/**
 * Business validation for the AI-ASSISTED flag on diagnoses: when an expert
 * marks an assessment "based on AI", the underlying review must exist and
 * must not be REJECTED. An aiAgreement=REJECTED assessment is still allowed
 * (expert disagrees — valuable feedback) but aiAssisted must be false.
 */
export function resolveAiAssistedFlag(
  aiAgreement: 'ACCEPTED' | 'MODIFIED' | 'REJECTED' | undefined,
): boolean {
  return aiAgreement === 'ACCEPTED' || aiAgreement === 'MODIFIED'
}
