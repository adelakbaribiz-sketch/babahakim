// PRESCRIPTION state machine — versioned prescription lifecycle.
// Status strings match the existing data (PENDING_EXPERT_2 with underscore).
// New in Phase 02: SUPERSEDE (old version archived when a newer one is
// created — BR-MED-06 / ED-24) and machine-guarded doctor decisions.
import { TransitionDef, MachineDef, WorkflowError } from '../types'

export const PRESCRIPTION_STATUSES = [
  'PENDING_EXPERT_2', // created by Expert 1, awaiting second review
  'PENDING_DOCTOR',   // Expert 2 reviewed & priced, awaiting doctor
  'REVISION_REQUESTED', // doctor requested changes
  'APPROVED',         // doctor approved (order/proforma may be issued)
  'REJECTED',         // doctor rejected THIS VERSION (terminal; the case returns to revision)
  'SUPERSEDED',       // replaced by a newer version (terminal)
  'FINALIZED',        // archived after fulfillment (terminal)
] as const

const t = (def: TransitionDef): TransitionDef => def

export const PRESCRIPTION_MACHINE: MachineDef = {
  entity: 'PRESCRIPTION',
  prismaKey: 'prescription',
  statuses: PRESCRIPTION_STATUSES,
  initial: 'PENDING_EXPERT_2',
  transitions: [
    t({
      action: 'EXPERT2_REVIEW', from: ['PENDING_EXPERT_2', 'REVISION_REQUESTED'], to: 'PENDING_DOCTOR',
      roles: ['EXPERT_2'], permission: 'expert2_review', descFa: 'بازبینی کارشناس دوم و ارسال برای پزشک',
      dataEffects: (c) => ({ expert2Notes: String(c.payload.notes || '') || null }),
    }),
    t({
      action: 'EXPERT2_RETURN', from: ['PENDING_EXPERT_2', 'REVISION_REQUESTED'], to: 'REVISION_REQUESTED',
      roles: ['EXPERT_2'], permission: 'expert2_review', descFa: 'کارشناس دوم نسخه را برای اصلاح برگرداند',
      validate: (c) => {
        if (!String(c.payload.reason || c.payload.notes || '').trim()) {
          throw new WorkflowError('VALIDATION', 'ذکر علت برگشت نسخه الزامی است | Reason required', 422)
        }
      },
      dataEffects: (c) => ({ expert2Notes: String(c.payload.reason || c.payload.notes || '') || null }),
    }),
    t({
      action: 'DOCTOR_APPROVE', from: ['PENDING_DOCTOR'], to: 'APPROVED',
      roles: ['DOCTOR'], permission: 'approve_prescription', descFa: 'پزشک نسخه را تأیید کرد',
      dataEffects: (c) => ({
        doctorComment: String(c.payload.comment || '') || null,
        approvedById: c.actor.id, approvedAt: c.now,
      }),
    }),
    t({
      action: 'DOCTOR_REJECT', from: ['PENDING_DOCTOR'], to: 'REJECTED',
      roles: ['DOCTOR'], permission: 'approve_prescription', descFa: 'پزشک نسخه را رد کرد',
      validate: (c) => {
        if (!String(c.payload.comment || '').trim()) {
          throw new WorkflowError('VALIDATION', 'کامنت پزشک برای رد نسخه الزامی است | Comment required', 422)
        }
      },
      dataEffects: (c) => ({ doctorComment: String(c.payload.comment || '') || null }),
    }),
    t({
      action: 'DOCTOR_REVISION', from: ['PENDING_DOCTOR'], to: 'REVISION_REQUESTED',
      roles: ['DOCTOR'], permission: 'approve_prescription', descFa: 'پزشک اصلاح درخواست کرد',
      validate: (c) => {
        if (!String(c.payload.comment || '').trim()) {
          throw new WorkflowError('VALIDATION', 'کامنت پزشک برای درخواست اصلاح الزامی است | Comment required', 422)
        }
      },
      dataEffects: (c) => ({ doctorComment: String(c.payload.comment || '') || null }),
    }),
    t({
      action: 'REVISE', from: ['REVISION_REQUESTED'], to: 'PENDING_EXPERT_2',
      roles: ['EXPERT_1', 'EXPERT_2'], permission: 'edit_prescription', descFa: 'نسخه اصلاح شد (چرخه بازبینی مجدد)',
    }),
    t({
      action: 'SUPERSEDE', from: ['PENDING_EXPERT_2', 'PENDING_DOCTOR', 'REVISION_REQUESTED', 'APPROVED'], to: 'SUPERSEDED',
      roles: ['EXPERT_1', 'EXPERT_2', 'OPERATOR', 'ADMIN', 'SYSTEM'], permission: 'edit_prescription',
      system: true, descFa: 'نسخه جدید جایگزین این نسخه شد',
    }),
    t({
      action: 'FINALIZE', from: ['APPROVED'], to: 'FINALIZED',
      roles: ['OPERATOR', 'ADMIN'], permission: 'manage_orders', descFa: 'نسخه نهایی و بایگانی شد',
    }),
  ],
}
