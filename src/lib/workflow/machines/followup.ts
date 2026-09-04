// FOLLOW-UP state machine — treatment follow-up lifecycle.
// Buckets (DUE_TODAY / OVERDUE / UPCOMING) remain computed at read time;
// this machine governs the durable status transitions only.
import { TransitionDef, MachineDef, WorkflowError } from '../types'

export const FOLLOWUP_STATUSES = [
  'PENDING', 'DUE', 'OVERDUE', 'COMPLETED', 'CANCELLED',
] as const

const t = (def: TransitionDef): TransitionDef => def

export const FOLLOWUP_MACHINE: MachineDef = {
  entity: 'FOLLOWUP',
  prismaKey: 'followUp',
  ownerField: 'patientId',
  statuses: FOLLOWUP_STATUSES,
  initial: 'PENDING',
  transitions: [
    t({
      action: 'MARK_DUE', from: ['PENDING'], to: 'DUE',
      roles: ['SYSTEM', 'OPERATOR', 'ADMIN'], system: true, permission: 'manage_followups', descFa: 'زمان پیگیری رسید',
    }),
    t({
      action: 'MARK_OVERDUE', from: ['PENDING', 'DUE'], to: 'OVERDUE',
      roles: ['SYSTEM', 'OPERATOR', 'ADMIN'], system: true, permission: 'manage_followups', descFa: 'پیگیری معوق شد',
    }),
    t({
      action: 'COMPLETE', from: ['PENDING', 'DUE', 'OVERDUE'], to: 'COMPLETED',
      roles: ['OPERATOR', 'EXPERT_1', 'DOCTOR'], permission: 'manage_followups', descFa: 'پیگیری تکمیل شد',
      dataEffects: (c) => ({
        completedAt: c.now,
        completedById: c.actor.id,
        resultNote: String(c.payload.note || '') || ((c.entity as { resultNote?: string }).resultNote ?? null),
      }),
      postCommit: async (c) => {
        const { notify } = await import('@/lib/notify')
        await notify(String(c.entity.patientId), 'FOLLOWUP_DUE', { extraFa: 'پیگیری ثبت شد' })
      },
    }),
    t({
      action: 'CANCEL', from: ['PENDING', 'DUE', 'OVERDUE'], to: 'CANCELLED',
      roles: ['ADMIN', 'OPERATOR'], permission: 'manage_followups', descFa: 'پیگیری لغو شد',
      validate: (c) => {
        if (!String(c.payload.reason || '').trim()) {
          throw new WorkflowError('VALIDATION', 'دلیل لغو پیگیری الزامی است | Reason required', 422)
        }
      },
      dataEffects: (c) => ({ resultNote: String(c.payload.reason || '') }),
    }),
  ],
}
