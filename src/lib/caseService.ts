// Case workflow service — centralized state transitions with audit, locking, notifications
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { canTransition, WorkflowAction } from '@/lib/constants'
import { audit, fail, ok, parseJSON } from '@/lib/api'
import { notify } from '@/lib/notify'

export async function applyTransition(
  req: NextRequest,
  caseId: string,
  action: WorkflowAction,
  actorId: string,
  actorRole: string,
  payload?: Record<string, unknown>,
) {
  // Lock case row (idempotent-ish; SQLite serializes writes)
  const existing = await db.medicalCase.findUnique({ where: { id: caseId } })
  if (!existing || existing.deletedAt) return fail('پرونده یافت نشد | Case not found', 404)

  const tr = canTransition(existing.status, action, actorRole)
  if (!tr) {
    return fail(`اقدام «${action}» برای وضعیت «${existing.status}» و نقش «${actorRole}» مجاز نیست | Invalid transition`, 409, { status: existing.status })
  }

  // permission check for non-admin
  if (actorRole !== 'ADMIN' && tr.permission) {
    const { ROLE_PERMISSIONS, Role } = await import('@/lib/constants')
    const perms = ROLE_PERMISSIONS[actorRole as keyof typeof ROLE_PERMISSIONS] || []
    if (!perms.includes(tr.permission as never)) {
      return fail('دسترسی لازم را ندارید | Permission denied', 403)
    }
  }

  // Patient can only act on own case
  if (actorRole === 'PATIENT' && existing.patientId !== actorId) {
    return fail('شما فقط به پرونده خودتان دسترسی دارید | Not your case', 403)
  }

  const data: Record<string, unknown> = { status: tr.to }
  const p = payload || {}

  switch (action) {
    case 'CLAIM':
      data.assignedExpert1Id = actorId
      break
    case 'SUBMIT_ASSESSMENT':
      data.expert1Summary = (p.summary as string) || ''
      data.assignedExpert1Id = existing.assignedExpert1Id || actorId
      break
    case 'USER_APPROVE':
      data.userApprovedTreatment = true
      break
    case 'USER_DECLINE':
      data.closingNote = (p.reason as string) || 'کاربر ادامه درمان را نپذیرفت'
      data.closedAt = new Date()
      break
    case 'DOCTOR_APPROVE':
      data.assignedDoctorId = existing.assignedDoctorId || actorId
      data.followUpDays = (p.followUpDays as number) ?? existing.followUpDays ?? 40
      break
    case 'DOCTOR_REJECT':
      data.closingNote = (p.reason as string) || 'رد توسط پزشک'
      data.closedAt = new Date()
      break
    case 'REFER_AGAIN':
      data.followUpAt = null
      break
  }

  const updated = await db.medicalCase.update({ where: { id: caseId }, data })

  await db.caseEvent.create({
    data: {
      caseId, actorId, action: 'STATUS_CHANGE',
      fromStatus: existing.status, toStatus: tr.to,
      comment: (p.comment as string) || tr.descFa,
      reason: (p.reason as string) || null,
    },
  })

  // Notifications
  const patient = await db.user.findUnique({ where: { id: updated.patientId } })
  const events: Record<string, { userId: string; code: Parameters<typeof notify>[1]; extra?: string }> = {}
  if (patient) {
    events[tr.to] = { userId: patient.id, code: statusEvent(tr.to) }
  }
  // notify expert queue on new waiting
  if (tr.to === 'WAITING_FOR_EXPERT_1') await notifyRoleNotify('EXPERT_1', 'ASSIGNED_EXPERT')
  if (tr.to === 'WAITING_FOR_EXPERT_2') await notifyRoleNotify('EXPERT_2', 'ASSIGNED_EXPERT')
  if (tr.to === 'WAITING_FOR_DOCTOR') await notifyRoleNotify('DOCTOR', 'ASSIGNED_EXPERT')
  for (const key of Object.keys(events)) {
    const e = events[key]
    if (e && e.code) await notify(e.userId, e.code, { link: `/cases/${caseId}`, sms: true, phone: patient?.phone })
  }

  await audit(req, actorId, 'CASE_TRANSITION', 'MedicalCase', caseId, { status: existing.status }, { status: tr.to, action })
  return ok({ ok: true, case: { id: updated.id, status: updated.status } })
}

function statusEvent(status: string): Parameters<typeof notify>[1] | null {
  const map: Record<string, Parameters<typeof notify>[1]> = {
    WAITING_FOR_USER_APPROVAL: 'ASSESSMENT_READY',
    WAITING_FOR_EXPERT_1_PRESCRIPTION: 'TREATMENT_APPROVED',
    WAITING_FOR_EXPERT_2: 'PRESCRIPTION_CREATED',
    WAITING_FOR_DOCTOR: 'SENT_TO_DOCTOR',
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
  return map[status] || null
}

async function notifyRoleNotify(role: string, code: Parameters<typeof notify>[1]) {
  const users = await db.user.findMany({ where: { role, isActive: true, deletedAt: null }, select: { id: true } })
  for (const u of users) await notify(u.id, code, {})
}

// Timeline builder for a case
export function buildTimeline(caseRow: {
  createdAt: Date; events: { action: string; fromStatus: string | null; toStatus: string | null; comment: string | null; reason: string | null; createdAt: Date; actor?: { firstName: string; lastName: string; role: string } | null }[]
  status: string
}) {
  const items: { at: Date; code: string; actor: string; actorRole: string; desc: string }[] = [
    { at: caseRow.createdAt, code: 'CREATED', actor: '', actorRole: 'PATIENT', desc: 'ایجاد پرونده و قرارگیری در صف' },
  ]
  for (const e of caseRow.events) {
    items.push({
      at: e.createdAt, code: e.toStatus || e.action,
      actor: e.actor ? `${e.actor.firstName} ${e.actor.lastName}` : '—',
      actorRole: e.actor?.role || '',
      desc: e.comment || e.reason || e.action,
    })
  }
  return items.sort((a, b) => a.at.getTime() - b.at.getTime())
}
