// INVOICE state machine — proforma / financial document lifecycle (PHASE 12).
// Status was previously written scattered across paymentPaidCascade,
// cascadePaid (order.ts), paymentService and order CONFIRM txEffects — all
// backend, but none machine-guarded: no graph check, no audit row for the
// invoice state itself. Now cascades run as SYSTEM sub-transitions
// (subtransition.ts) and operator actions are guarded transitions.
//
// Creation writes SENT directly (proforma semantics — like CASE's virtual
// NEW, DRAFT is the schema default for rows that never left creation).
import { TransitionDef, MachineDef, WorkflowError } from '../types'

export const INVOICE_STATUSES = [
  'DRAFT',     // created, not yet issued to the patient
  'SENT',      // proforma issued — awaiting patient confirmation
  'CONFIRMED', // patient/operator confirmed the proforma
  'PAID',      // payment verified (cascade from PAYMENT/ORDER)
  'CANCELLED', // voided (reason mandatory)
] as const

const t = (def: TransitionDef): TransitionDef => def

export const INVOICE_MACHINE: MachineDef = {
  entity: 'INVOICE',
  prismaKey: 'invoice',
  statuses: INVOICE_STATUSES,
  initial: 'DRAFT',
  transitions: [
    t({
      action: 'ISSUE', from: ['DRAFT'], to: 'SENT',
      roles: ['EXPERT_2', 'OPERATOR'], permission: 'create_invoice', descFa: 'پیش‌فاکتور صادر و برای کاربر ارسال شد',
    }),
    t({
      // order CONFIRM cascade (system sub-transition) or operator action
      action: 'CONFIRM', from: ['SENT'], to: 'CONFIRMED',
      roles: ['OPERATOR', 'EXPERT_2', 'SYSTEM'], system: true, permission: 'manage_orders',
      descFa: 'فاکتور تأیید شد',
      dataEffects: (c) => ({ confirmedAt: c.now }),
    }),
    t({
      // payment paid-cascade (system sub-transition) or operator verification
      action: 'MARK_PAID', from: ['SENT', 'CONFIRMED'], to: 'PAID',
      roles: ['OPERATOR', 'EXPERT_2', 'SYSTEM'], system: true, permission: 'verify_payment',
      descFa: 'فاکتور پرداخت شد',
      dataEffects: (c) => ({ paidAt: c.now }),
    }),
    t({
      action: 'CANCEL', from: ['DRAFT', 'SENT', 'CONFIRMED'], to: 'CANCELLED',
      roles: ['OPERATOR', 'EXPERT_2'], permission: 'manage_orders', descFa: 'فاکتور باطل شد',
      validate: (c) => {
        if (!String(c.payload.reason || '').trim()) {
          throw new WorkflowError('VALIDATION', 'دلیل باطل کردن فاکتور الزامی است | Reason required', 422)
        }
      },
      dataEffects: (c) => ({ note: String(c.payload.reason || '') }),
    }),
  ],
}
