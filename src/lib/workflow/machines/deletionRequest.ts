// DELETION_REQUEST state machine — privacy right-to-erasure lifecycle (PHASE 12).
// Previously the whole workflow lived inside adminService.patchDeletionRequest
// (direct status writes, no machine guards, no audit of the STATE change
// itself). Now: every hop is guarded, audited and SLA-tracked — the privacy
// deadline (PENDING > 7 days escalates, see policies.ts) becomes enforceable.
//
// Data status strings follow the LIVE schema values used by
// privacy.ts (COMPLETED) — adminService's legacy 'PROCESSED' spelling was a
// data inconsistency this machine removes (ED-124).
import { TransitionDef, MachineDef, WorkflowError } from '../types'

export const DELETION_REQUEST_STATUSES = [
  'PENDING',     // user submitted the request (created by privacy.ts)
  'PROCESSING',  // admin started working on it
  'COMPLETED',   // user anonymized (terminal)
  'REJECTED',    // admin refused with a reason (terminal)
] as const

const t = (def: TransitionDef): TransitionDef => def

export const DELETION_REQUEST_MACHINE: MachineDef = {
  entity: 'DELETION_REQUEST',
  prismaKey: 'deletionRequest',
  ownerField: 'userId',
  statuses: DELETION_REQUEST_STATUSES,
  initial: 'PENDING',
  transitions: [
    t({
      action: 'START', from: ['PENDING'], to: 'PROCESSING',
      roles: ['ADMIN'], permission: 'manage_users', descFa: 'پردازش درخواست حذف آغاز شد',
      dataEffects: (c) => ({ processedById: c.actor.id }),
    }),
    t({
      action: 'COMPLETE', from: ['PENDING', 'PROCESSING'], to: 'COMPLETED',
      roles: ['ADMIN'], permission: 'manage_users', descFa: 'درخواست حذف انجام و کاربر ناشناس‌سازی شد',
      validate: (c) => {
        // anonymization is irreversible — an explicit confirmation is mandatory
        if (c.payload.confirm !== true) {
          throw new WorkflowError('VALIDATION', 'تأیید صریح (confirm=true) برای ناشناس‌سازی الزامی است | Explicit confirm required', 422)
        }
      },
      dataEffects: (c) => ({
        processedAt: c.now,
        processedById: c.actor.id,
        anonymizedAt: c.now,
        note: String(c.payload.note || '') || null,
      }),
      // anonymization cascade runs INSIDE the same transaction (ED-125):
      // user fields blanked, sessions killed, images flagged — all-or-nothing
      txEffects: async (c) => {
        const { anonymizeUserTx } = await import('@/lib/security/privacy')
        await anonymizeUserTx(c.tx, String((c.entity as { userId?: string }).userId || ''), c.actor.id)
      },
    }),
    t({
      action: 'REJECT', from: ['PENDING', 'PROCESSING'], to: 'REJECTED',
      roles: ['ADMIN'], permission: 'manage_users', descFa: 'درخواست حذف رد شد',
      validate: (c) => {
        if (!String(c.payload.note || '').trim()) {
          throw new WorkflowError('VALIDATION', 'ذکر دلیل رد درخواست حذف الزامی است | Reason required', 422)
        }
      },
      dataEffects: (c) => ({
        processedAt: c.now,
        processedById: c.actor.id,
        note: String(c.payload.note || ''),
      }),
      postCommit: async (c) => {
        const { notify } = await import('@/lib/notify')
        await notify(String((c.entity as { userId?: string }).userId || ''), 'DELETION_REJECTED', {
          extraFa: String(c.payload.note || ''),
        })
      },
    }),
  ],
}
