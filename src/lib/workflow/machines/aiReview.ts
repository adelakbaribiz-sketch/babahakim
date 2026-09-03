// AI-REVIEW state machine — human oversight of AI analyses (FR-AI-06).
// Phase 02 adds durable review states (previously only a boolean flag),
// written via migration 20260903221412_ai_review_workflow_fields.
// Every review is audited and feeds the learning dataset (BR-MED-08).
import { TransitionDef, MachineDef, WorkflowError } from '../types'

export const AI_REVIEW_STATUSES = [
  'PENDING_REVIEW', 'ACCEPTED', 'MODIFIED', 'REJECTED',
] as const

const REVIEWERS = ['EXPERT_1', 'EXPERT_2', 'DOCTOR'] as const

const t = (def: TransitionDef): TransitionDef => def

function reviewDataEffects(c: { payload: Record<string, unknown>; actor: { id: string }; now: Date }) {
  return {
    humanReviewed: true,
    reviewComment: String(c.payload.comment || '') || null,
    reviewedById: c.actor.id,
    reviewedAt: c.now,
  }
}

export const AI_REVIEW_MACHINE: MachineDef = {
  entity: 'AI_REVIEW',
  prismaKey: 'aIAnalysis',
  statuses: AI_REVIEW_STATUSES,
  initial: 'PENDING_REVIEW',
  transitions: [
    t({
      action: 'ACCEPT', from: ['PENDING_REVIEW'], to: 'ACCEPTED',
      roles: [...REVIEWERS], permission: 'view_ai_analyses', descFa: 'تحلیل AI تأیید شد',
      dataEffects: reviewDataEffects,
    }),
    t({
      action: 'MODIFY', from: ['PENDING_REVIEW'], to: 'MODIFIED',
      roles: [...REVIEWERS], permission: 'view_ai_analyses', descFa: 'تحلیل AI اصلاح و استفاده شد',
      dataEffects: reviewDataEffects,
    }),
    t({
      action: 'REJECT', from: ['PENDING_REVIEW'], to: 'REJECTED',
      roles: [...REVIEWERS], permission: 'view_ai_analyses', descFa: 'تحلیل AI رد شد',
      validate: (c) => {
        if (!String(c.payload.comment || '').trim()) {
          throw new WorkflowError('VALIDATION', 'ذکر دلیل رد تحلیل AI الزامی است | Comment required', 422)
        }
      },
      dataEffects: reviewDataEffects,
    }),
    t({
      action: 'RESET', from: ['ACCEPTED', 'MODIFIED', 'REJECTED'], to: 'PENDING_REVIEW',
      roles: ['ADMIN'], permission: 'manage_ai_models', descFa: 'بازبینی AI به حالت اولیه بازگشت (اصلاح خطا)',
      dataEffects: (c) => ({
        humanReviewed: false, reviewComment: null, reviewedById: null, reviewedAt: null,
      }),
    }),
  ],
}
