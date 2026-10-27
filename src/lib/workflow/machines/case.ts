// CASE state machine — canonical patient-case workflow (21 statuses / 19 transitions).
// Migrated from constants.ts TRANSITIONS + caseService data effects (Phase 00)
// into the declarative machine format. Behavior-compatible, now with:
// admin role bypass (BR-RBAC-02), per-transition validation hooks, and
// automatic CaseEvent + AuditLog written by the engine.
import { TransitionDef, MachineDef, WorkflowError } from '../types'

export const CASE_STATUSES = [
  'NEW', 'WAITING_FOR_EXPERT_1', 'EXPERT_1_REVIEW', 'WAITING_FOR_USER_APPROVAL',
  'WAITING_FOR_EXPERT_1_PRESCRIPTION', 'WAITING_FOR_EXPERT_2', 'REVISION_REQUESTED',
  'WAITING_FOR_DOCTOR', 'PRESCRIPTION_APPROVED', 'PREPARING_ORDER', 'PROFORMA_CREATED',
  'WAITING_FOR_USER_CONFIRMATION', 'WAITING_FOR_PAYMENT', 'PAYMENT_CONFIRMED',
  'PREPARING_SHIPMENT', 'SHIPPED', 'DELIVERED', 'FOLLOW_UP', 'REFERRED_AGAIN', 'CLOSED', 'CANCELLED',
] as const

/** status → patient notification event code (post-commit) */
const PATIENT_EVENT: Record<string, string> = {
  WAITING_FOR_USER_APPROVAL: 'ASSESSMENT_READY',
  WAITING_FOR_EXPERT_1_PRESCRIPTION: 'TREATMENT_APPROVED',
  WAITING_FOR_EXPERT_2: 'PRESCRIPTION_CREATED',
  WAITING_FOR_DOCTOR: 'SENT_TO_DOCTOR',
  REVISION_REQUESTED: 'PRESCRIPTION_REVISED',
  PRESCRIPTION_APPROVED: 'DOCTOR_APPROVED',
  PROFORMA_CREATED: 'PROFORMA_CREATED',
  WAITING_FOR_PAYMENT: 'PAYMENT_PENDING',
  PAYMENT_CONFIRMED: 'PAYMENT_CONFIRMED',
  SHIPPED: 'ORDER_SHIPPED',
  DELIVERED: 'ORDER_DELIVERED',
  FOLLOW_UP: 'FOLLOWUP_DUE',
  REFERRED_AGAIN: 'REFERRED_AGAIN',
  CLOSED: 'CASE_CLOSED',
}

/** target-status → role to notify (queue awareness) */
const ROLE_EVENT: Record<string, string> = {
  WAITING_FOR_EXPERT_1: 'EXPERT_1',
  REVISION_REQUESTED: 'EXPERT_1', // returned by Expert 2 / rejected by doctor
  WAITING_FOR_EXPERT_1_PRESCRIPTION: 'EXPERT_1',
  WAITING_FOR_EXPERT_2: 'EXPERT_2',
  WAITING_FOR_DOCTOR: 'DOCTOR',
}

async function notifyPatientAndRoles(ctx: {
  entity: Record<string, unknown>
  transition: TransitionDef
  db?: unknown
}) {
  const { notify } = await import('@/lib/notify')
  const db = ctx.db as { user: { findUnique: (a: { where: { id: string } }) => Promise<{ phone: string } | null>; findMany: (a: unknown) => Promise<{ id: string }[]> } }
  const caseId = String(ctx.entity.id)
  const patientId = String((ctx.entity as { patientId?: unknown }).patientId || '')
  const patient = patientId ? await db.user.findUnique({ where: { id: patientId } }) : null
  if (patientId) {
    const code = PATIENT_EVENT[ctx.transition.to]
    if (code) {
      await notify(patientId, code as Parameters<typeof notify>[1], {
        link: `/cases/${caseId}`, sms: true, phone: patient?.phone ?? null,
      })
    }
  }
  const role = ROLE_EVENT[ctx.transition.to]
  if (role) {
    const users = await db.user.findMany({
      where: { role, isActive: true, deletedAt: null }, select: { id: true },
    })
    for (const u of users) await notify(u.id, 'ASSIGNED_EXPERT' as Parameters<typeof notify>[1], {})
  }
}

const t = (def: TransitionDef): TransitionDef => def

export const CASE_MACHINE: MachineDef = {
  entity: 'CASE',
  prismaKey: 'medicalCase',
  ownerField: 'patientId',
  statuses: CASE_STATUSES,
  initial: 'NEW',
  transitions: [
    t({
      action: 'CLAIM', from: ['WAITING_FOR_EXPERT_1'], to: 'EXPERT_1_REVIEW',
      roles: ['EXPERT_1'], permission: 'claim_cases', descFa: 'کارشناس اول پرونده را دریافت کرد',
      dataEffects: (c) => ({ assignedExpert1Id: c.actor.id }),
    }),
    t({
      action: 'SUBMIT_ASSESSMENT', from: ['EXPERT_1_REVIEW'], to: 'WAITING_FOR_USER_APPROVAL',
      roles: ['EXPERT_1'], permission: 'expert1_assessment', descFa: 'ارزیابی اولیه ارسال شد',
      validate: (c) => {
        if (!String(c.payload.summary || '').trim()) {
          throw new WorkflowError('VALIDATION', 'متن ارزیابی اولیه الزامی است', 422)
        }
      },
      dataEffects: (c) => ({
        expert1Summary: String(c.payload.summary || ''),
        assignedExpert1Id: (c.entity as { assignedExpert1Id?: string }).assignedExpert1Id || c.actor.id,
      }),
      postCommit: notifyPatientAndRoles,
    }),
    t({
      action: 'USER_APPROVE', from: ['WAITING_FOR_USER_APPROVAL'], to: 'WAITING_FOR_EXPERT_1_PRESCRIPTION',
      roles: ['PATIENT'], descFa: 'کاربر ادامه درمان را تأیید کرد',
      dataEffects: () => ({ userApprovedTreatment: true }),
      postCommit: notifyPatientAndRoles,
    }),
    t({
      action: 'USER_DECLINE', from: ['WAITING_FOR_USER_APPROVAL'], to: 'CLOSED',
      roles: ['PATIENT'], descFa: 'کاربر ادامه درمان را رد کرد',
      validate: (c) => {
        if (!String(c.payload.reason || '').trim()) {
          throw new WorkflowError('VALIDATION', 'ذکر دلیل رد درمان الزامی است | Reason required', 422)
        }
      },
      dataEffects: (c) => ({
        closingNote: String(c.payload.reason || 'کاربر ادامه درمان را نپذیرفت'),
        closedAt: c.now,
      }),
      postCommit: notifyPatientAndRoles,
    }),
    t({
      action: 'SUBMIT_PRESCRIPTION', from: ['WAITING_FOR_EXPERT_1_PRESCRIPTION', 'REVISION_REQUESTED'], to: 'WAITING_FOR_EXPERT_2',
      roles: ['EXPERT_1'], permission: 'create_prescription', descFa: 'نسخه کارشناس اول ثبت شد',
      postCommit: notifyPatientAndRoles,
    }),
    t({
      action: 'EXPERT2_REVIEW', from: ['WAITING_FOR_EXPERT_2'], to: 'WAITING_FOR_DOCTOR',
      roles: ['EXPERT_2'], permission: 'expert2_review', descFa: 'بازبینی کارشناس دوم و ارسال برای پزشک',
      postCommit: notifyPatientAndRoles,
    }),
    t({
      action: 'EXPERT2_RETURN', from: ['WAITING_FOR_EXPERT_2'], to: 'REVISION_REQUESTED',
      roles: ['EXPERT_2'], permission: 'expert2_review', descFa: 'کارشناس دوم نسخه را برای اصلاح به کارشناس اول برگرداند',
      validate: (c) => {
        if (!String(c.payload.reason || c.payload.comment || '').trim()) {
          throw new WorkflowError('VALIDATION', 'ذکر علت برگشت نسخه الزامی است | Reason required', 422)
        }
      },
      postCommit: notifyPatientAndRoles,
    }),
    t({
      action: 'DOCTOR_APPROVE', from: ['WAITING_FOR_DOCTOR'], to: 'PRESCRIPTION_APPROVED',
      roles: ['DOCTOR'], permission: 'approve_prescription', descFa: 'پزشک نسخه را تأیید کرد',
      dataEffects: (c) => ({
        assignedDoctorId: (c.entity as { assignedDoctorId?: string }).assignedDoctorId || c.actor.id,
        followUpDays: c.payload.followUpDays != null ? Number(c.payload.followUpDays) : (c.entity as { followUpDays?: number }).followUpDays ?? 40,
      }),
      postCommit: notifyPatientAndRoles,
    }),
    // Doctor rejection rejects the PRESCRIPTION VERSION, never the case: the
    // case returns to Expert 1's revision queue (it used to land in CLOSED and
    // vanish from every queue with no way back). The reason is kept on the
    // CaseEvent (reason/comment) and on the rejected prescription version.
    t({
      action: 'DOCTOR_REJECT', from: ['WAITING_FOR_DOCTOR'], to: 'REVISION_REQUESTED',
      roles: ['DOCTOR'], permission: 'approve_prescription', descFa: 'پزشک نسخه را رد کرد — بازگشت برای اصلاح',
      validate: (c) => {
        if (!String(c.payload.comment || c.payload.reason || '').trim()) {
          throw new WorkflowError('VALIDATION', 'کامنت پزشک برای رد نسخه الزامی است | Comment required', 422)
        }
      },
      postCommit: notifyPatientAndRoles,
    }),
    t({
      action: 'DOCTOR_REVISION', from: ['WAITING_FOR_DOCTOR'], to: 'WAITING_FOR_EXPERT_2',
      roles: ['DOCTOR'], permission: 'approve_prescription', descFa: 'پزشک اصلاح درخواست کرد',
      validate: (c) => {
        if (!String(c.payload.comment || '').trim()) {
          throw new WorkflowError('VALIDATION', 'کامنت پزشک برای درخواست اصلاح الزامی است | Comment required', 422)
        }
      },
      postCommit: notifyPatientAndRoles,
    }),
    t({
      action: 'CREATE_PROFORMA', from: ['PRESCRIPTION_APPROVED'], to: 'PROFORMA_CREATED',
      roles: ['EXPERT_2', 'OPERATOR'], permission: 'create_invoice', descFa: 'پیش‌فاکتور ایجاد شد',
      postCommit: notifyPatientAndRoles,
    }),
    t({
      action: 'CONFIRM_PROFORMA', from: ['PROFORMA_CREATED', 'WAITING_FOR_USER_CONFIRMATION'], to: 'WAITING_FOR_PAYMENT',
      roles: ['PATIENT'], descFa: 'پیش‌فاکتور توسط کاربر تأیید شد',
      postCommit: notifyPatientAndRoles,
    }),
    t({
      action: 'REJECT_PROFORMA', from: ['PROFORMA_CREATED', 'WAITING_FOR_USER_CONFIRMATION'], to: 'CANCELLED',
      roles: ['PATIENT'], descFa: 'پیش‌فاکتور رد شد',
      validate: (c) => {
        if (!String(c.payload.reason || '').trim()) {
          throw new WorkflowError('VALIDATION', 'ذکر دلیل رد پیش‌فاکتور الزامی است | Reason required', 422)
        }
      },
      dataEffects: (c) => ({
        closingNote: String(c.payload.reason || 'رد پیش‌فاکتور توسط کاربر'),
        closedAt: c.now,
      }),
      postCommit: notifyPatientAndRoles,
    }),
    t({
      action: 'MARK_PAID', from: ['WAITING_FOR_PAYMENT'], to: 'PAYMENT_CONFIRMED',
      roles: ['OPERATOR', 'EXPERT_2', 'SYSTEM'], permission: 'verify_payment', system: true,
      descFa: 'پرداخت تأیید شد',
      postCommit: notifyPatientAndRoles,
    }),
    t({
      action: 'START_SHIPPING', from: ['PAYMENT_CONFIRMED', 'PREPARING_SHIPMENT'], to: 'SHIPPED',
      roles: ['OPERATOR', 'EXPERT_2'], permission: 'manage_shipments', descFa: 'سفارش ارسال شد',
      postCommit: notifyPatientAndRoles,
    }),
    t({
      action: 'MARK_DELIVERED', from: ['SHIPPED', 'PAYMENT_CONFIRMED', 'PREPARING_SHIPMENT'], to: 'DELIVERED',
      roles: ['OPERATOR', 'EXPERT_2'], permission: 'manage_shipments', descFa: 'تحویل ثبت شد',
      postCommit: notifyPatientAndRoles,
    }),
    t({
      action: 'SCHEDULE_FOLLOWUP', from: ['DELIVERED'], to: 'FOLLOW_UP',
      roles: ['EXPERT_1', 'OPERATOR'], permission: 'manage_followups', descFa: 'پیگیری درمان فعال شد',
      postCommit: notifyPatientAndRoles,
    }),
    t({
      action: 'COMPLETE_FOLLOWUP', from: ['FOLLOW_UP'], to: 'CLOSED',
      roles: ['EXPERT_1', 'OPERATOR'], permission: 'manage_followups', descFa: 'پیگیری تکمیل شد',
      postCommit: notifyPatientAndRoles,
    }),
    t({
      action: 'REFER_AGAIN', from: ['FOLLOW_UP', 'DELIVERED'], to: 'REFERRED_AGAIN',
      roles: ['PATIENT', 'EXPERT_1', 'OPERATOR'], descFa: 'ارجاع مجدد ثبت شد',
      dataEffects: (c) => ({ followUpAt: null }),
      postCommit: notifyPatientAndRoles,
    }),
  ],
}
