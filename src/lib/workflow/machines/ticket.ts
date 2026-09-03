// TICKET state machine — support ticket lifecycle.
// Phase 02 improvement over inline PATCH: transitions are now guarded,
// audited and validated (previously any staff PATCH could set any status
// silently). Closed tickets can only be reopened via the REOPEN transition.
import { TransitionDef, MachineDef } from '../types'

export const TICKET_STATUSES = [
  'OPEN', 'IN_PROGRESS', 'WAITING_USER', 'WAITING_EXPERT', 'RESOLVED', 'CLOSED',
] as const

const STAFF = ['OPERATOR', 'EXPERT_1', 'EXPERT_2', 'DOCTOR'] as const

const t = (def: TransitionDef): TransitionDef => def

export const TICKET_MACHINE: MachineDef = {
  entity: 'TICKET',
  prismaKey: 'ticket',
  ownerField: 'userId',
  statuses: TICKET_STATUSES,
  initial: 'OPEN',
  transitions: [
    t({
      action: 'ASSIGN', from: ['OPEN'], to: 'IN_PROGRESS',
      roles: [...STAFF], permission: 'manage_tickets', descFa: 'تیکت گرفته/تخصیص یافت',
      dataEffects: (c) => ({ assignedToId: c.payload.assignedToId ? String(c.payload.assignedToId) : c.actor.id }),
    }),
    t({
      action: 'STAFF_REPLY', from: ['OPEN'], to: 'IN_PROGRESS',
      roles: [...STAFF], permission: 'manage_tickets', descFa: 'پاسخ کارکنان ثبت شد',
      dataEffects: (c) => ({ assignedToId: (c.entity as { assignedToId?: string }).assignedToId ?? c.actor.id }),
    }),
    t({
      action: 'WAIT_USER', from: ['IN_PROGRESS', 'WAITING_EXPERT'], to: 'WAITING_USER',
      roles: [...STAFF], permission: 'manage_tickets', descFa: 'در انتظار پاسخ کاربر',
    }),
    t({
      action: 'ESCALATE', from: ['IN_PROGRESS', 'WAITING_USER'], to: 'WAITING_EXPERT',
      roles: [...STAFF], permission: 'manage_tickets', descFa: 'ارجاع به کارشناس/پزشک',
    }),
    t({
      action: 'PATIENT_REPLY', from: ['OPEN', 'IN_PROGRESS', 'WAITING_USER'], to: 'WAITING_EXPERT',
      roles: ['PATIENT'], descFa: 'پاسخ کاربر ثبت شد',
      requireOwnership: true,
    }),
    t({
      action: 'RESOLVE', from: ['IN_PROGRESS', 'WAITING_USER', 'WAITING_EXPERT'], to: 'RESOLVED',
      roles: [...STAFF], permission: 'manage_tickets', descFa: 'تیکت حل شد',
      postCommit: async (c) => {
        const { notify } = await import('@/lib/notify')
        await notify(String(c.entity.userId), 'TICKET_UPDATED', { extraFa: String(c.entity.code || '') })
      },
    }),
    t({
      action: 'CLOSE', from: ['OPEN', 'IN_PROGRESS', 'WAITING_USER', 'WAITING_EXPERT', 'RESOLVED'], to: 'CLOSED',
      roles: [...STAFF], permission: 'manage_tickets', descFa: 'تیکت بسته شد',
      postCommit: async (c) => {
        const { notify } = await import('@/lib/notify')
        await notify(String(c.entity.userId), 'TICKET_UPDATED', { extraFa: String(c.entity.code || '') })
      },
    }),
    t({
      action: 'REOPEN', from: ['RESOLVED', 'CLOSED'], to: 'IN_PROGRESS',
      roles: ['PATIENT', ...STAFF], descFa: 'تیکت بازگشایی شد',
      requireOwnership: true,
    }),
  ],
}
