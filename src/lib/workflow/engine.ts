// BabaHakim Workflow Engine — resolution, guards, transactional execution.
//
// Guarantees (per PHASE 02 mandate):
//  - every transition is validated against the declarative machine graph
//  - every transition writes an Audit Log row (atomic with the status write)
//  - CASE transitions additionally write CaseEvent (timeline UI)
//  - status write + data effects + cascade effects run in ONE $transaction:
//    any failure rolls the whole transition back (previous status preserved)
//  - post-commit hooks (notifications) never break the caller (ED-17)
import { db } from '@/lib/db'
import {
  MachineDef, TransitionDef, WorkflowActor,
  WorkflowError, ExecResult, EntityRow, BaseHookCtx,
} from './types'
import { getMachine } from './registry'
import { assertGuards } from './pure'
import { syncWorkflowStateTx } from './subtransition'

// PHASE 09 (ED-107): the pure resolvers moved to ./pure (client-safe module).
// Server-side engine re-exports them so existing imports keep working.
export {
  resolveTransition, hasPermission, ownsEntity, assertGuards,
  reachableFrom, terminalStatuses,
} from './pure'

/* ── Execution layer (transactional) ─────────────────────────────────── */

export interface ExecuteInput {
  machine: string | MachineDef
  entityId: string
  action: string
  actor: WorkflowActor
  payload?: Record<string, unknown>
  /** NextRequest for audit IP/device capture; null for system calls. */
  req?: unknown
}

/**
 * Execute a workflow transition end-to-end:
 *   load → guards → validate → $transaction{update + event + audit + cascades}
 *   → postCommit (notifications)
 * Never throws for expected failures — returns a discriminated ExecResult.
 */
export async function executeTransition(input: ExecuteInput): Promise<ExecResult> {
  const machine = typeof input.machine === 'string' ? getMachine(input.machine) : input.machine
  const now = new Date()
  const payload = input.payload || {}
  // PHASE 11 (bug fix): machines may store their state in a non-`status` field
  // (AI_REVIEW → reviewStatus). Resolve the key ONCE and use it for reads,
  // guards, writes, audit and the result — the AI_REVIEW machine had silently
  // no-oped since PHASE 02 because row.status was undefined for AIAnalysis.
  const statusKey = machine.statusKey ?? 'status'
  try {
    /* 1 — load */
    const table = (db as unknown as Record<string, { findUnique: (a: { where: { id: string } }) => Promise<EntityRow | null> }>)[machine.prismaKey]
    const row = await table?.findUnique({ where: { id: input.entityId } })
    if (!row || (row as { deletedAt?: unknown }).deletedAt) {
      return { ok: false, code: 'NOT_FOUND', error: 'رکورد یافت نشد | Not found', httpStatus: 404 }
    }
    const currentStatus = String((row as Record<string, unknown>)[statusKey] ?? machine.initial)

    /* 2 — guards (role / permission / ownership / graph) */
    const t = assertGuards(machine, { ...row, status: currentStatus } as EntityRow, input.action, input.actor)

    /* 3 — pre-write validation hook */
    const baseCtx: BaseHookCtx = { entity: row, actor: input.actor, payload, transition: t, machine, now }
    try {
      await t.validate?.(baseCtx)
    } catch (e) {
      if (e instanceof WorkflowError) throw e
      throw new WorkflowError('VALIDATION', e instanceof Error ? e.message : 'اعتبارسنجی ناموفق', 422)
    }

    /* 4 — atomic transition */
    const data = { [statusKey]: t.to, ...(t.dataEffects?.(baseCtx) || {}) }
    const auditAction = t.auditAction || `WORKFLOW_${machine.entity}_${t.action}`

    const updated = await db.$transaction(async (tx) => {
      const txTable = (tx as unknown as Record<string, { update: (a: { where: { id: string }; data: unknown }) => Promise<EntityRow> }>)[machine.prismaKey]
      const next = await txTable.update({ where: { id: input.entityId }, data })

      // event log: CASE keeps CaseEvent (timeline UI); every machine is audited
      if (machine.entity === 'CASE') {
        await tx.caseEvent.create({
          data: {
            caseId: input.entityId,
            actorId: input.actor.id === 'SYSTEM' ? null : input.actor.id,
            action: 'STATUS_CHANGE',
            fromStatus: currentStatus,
            toStatus: t.to,
            comment: String(payload.comment || '') || t.descFa,
            reason: payload.reason != null ? String(payload.reason) : null,
          },
        })
      }

      // audit log (atomic with the transition — PHASE 02 mandate)
      await tx.auditLog.create({
        data: {
          userId: input.actor.id === 'SYSTEM' ? null : input.actor.id,
          action: auditAction,
          entity: machine.entity,
          entityId: input.entityId,
          oldValues: JSON.stringify({ [statusKey]: currentStatus }),
          newValues: JSON.stringify({ [statusKey]: t.to, action: t.action }),
          ip: extractIp(input.req),
          device: extractAgent(input.req),
        },
      })

      // declarative cascades inside the same transaction
      if (t.txEffects) await t.txEffects({ ...baseCtx, tx })

      // PHASE 12: WorkflowState projection (SLA timer restarts for the new
      // status; drift detection reconciles rows that skip this path)
      await syncWorkflowStateTx(tx, machine, input.entityId, t.to)

      return next
    })

    /* 5 — post-commit notifications (failures logged, never fatal) */
    if (t.postCommit) {
      try {
        await t.postCommit({ ...baseCtx, db })
      } catch (e) {
        console.error(JSON.stringify({
          level: 'ERROR', scope: 'workflow.postCommit',
          machine: machine.entity, action: t.action, entityId: input.entityId,
          error: e instanceof Error ? e.message : String(e),
        }))
      }
    }

    return {
      ok: true,
      entity: { id: updated.id, status: String((updated as Record<string, unknown>)[statusKey] ?? t.to) },
      transition: { action: t.action, from: currentStatus, to: t.to },
    }
  } catch (e) {
    if (e instanceof WorkflowError) {
      return { ok: false, code: e.code, error: e.message, httpStatus: e.httpStatus, details: e.details }
    }
    console.error(JSON.stringify({
      level: 'ERROR', scope: 'workflow.execute',
      machine: typeof input.machine === 'string' ? input.machine : input.machine.entity,
      action: input.action, entityId: input.entityId,
      error: e instanceof Error ? e.message : String(e),
    }))
    return { ok: false, code: 'SIDE_EFFECT', error: 'خطای داخلی در اجرای گردش کار | Workflow execution failed', httpStatus: 500 }
  }
}

/* ── PHASE 12: Admin force-recovery (escape hatch, BR-WF-07) ─────────── */

export interface AdminRecoveryInput {
  entityType: string
  entityId: string
  targetStatus: string
  reason: string
  /** Must hold role ADMIN (governance console) — checked, never trusted. */
  actor: WorkflowActor
  req?: unknown
}

/** Recovery audit action name. */
export const ADMIN_RECOVERY_ACTION = 'WORKFLOW_ADMIN_RECOVER'

/** Is this machine registered for force-recovery? (policies.ts FAILURE_POLICIES) */
export function recoveryEnabled(entityType: string): boolean {
  try {
    getMachine(entityType)
    return true
  } catch {
    return false
  }
}

/**
 * ADMIN-only escape hatch that moves ANY registered workflow instance to a
 * legal status of its machine, outside the transition graph — for stuck or
 * corrupted states (BR-WF-07). Fully audited (action WORKFLOW_ADMIN_RECOVER,
 * reason mandatory) and latched in WorkflowState, so the governance runtime
 * and the audit trail see the recovery exactly like a normal transition.
 * UI may REQUEST it; only the backend engine performs it.
 */
export async function executeAdminRecovery(input: AdminRecoveryInput): Promise<ExecResult> {
  try {
    /* 1 — authorization: ADMIN role only (never a UI-asserted fact) */
    if (input.actor.role !== 'ADMIN') {
      return {
        ok: false, code: 'FORBIDDEN_ROLE',
        error: 'بازیابی گردش کار فقط برای مدیر سیستم مجاز است | Admin only', httpStatus: 403,
      }
    }

    /* 2 — input validation */
    const reason = String(input.reason || '').trim()
    if (reason.length < 3) {
      return {
        ok: false, code: 'VALIDATION',
        error: 'دلیل بازیابی (حداقل ۳ حرف) الزامی است | Reason required', httpStatus: 422,
      }
    }

    /* 3 — machine + target status legality */
    const machine = getMachine(input.entityType)
    if (!machine.statuses.includes(input.targetStatus)) {
      return {
        ok: false, code: 'VALIDATION',
        error: `وضعیت «${input.targetStatus}» در ماشین «${machine.entity}» تعریف نشده است | Unknown target status`,
        httpStatus: 422, details: { statuses: machine.statuses },
      }
    }

    /* 4 — load (soft-delete aware) */
    const statusKey = machine.statusKey ?? 'status'
    const table = (db as unknown as Record<string, { findUnique: (a: { where: { id: string } }) => Promise<EntityRow | null> }>)[machine.prismaKey]
    const row = await table?.findUnique({ where: { id: input.entityId } })
    if (!row || (row as { deletedAt?: unknown }).deletedAt) {
      return { ok: false, code: 'NOT_FOUND', error: 'رکورد یافت نشد | Not found', httpStatus: 404 }
    }
    const currentStatus = String((row as Record<string, unknown>)[statusKey] ?? machine.initial)
    if (currentStatus === input.targetStatus) {
      return {
        ok: false, code: 'VALIDATION',
        error: 'رکورد از قبل در وضعیت هدف است | Already in target status', httpStatus: 422,
        details: { status: currentStatus },
      }
    }

    /* 5 — atomic recovery write */
    const now = new Date()
    const updated = await db.$transaction(async (tx) => {
      const txTable = (tx as unknown as Record<string, { update: (a: { where: { id: string }; data: unknown }) => Promise<EntityRow> }>)[machine.prismaKey]
      const next = await txTable.update({ where: { id: input.entityId }, data: { [statusKey]: input.targetStatus } })

      if (machine.entity === 'CASE') {
        await (tx as unknown as { caseEvent: { create: (a: unknown) => Promise<unknown> } }).caseEvent.create({
          data: {
            caseId: input.entityId, actorId: input.actor.id, action: 'STATUS_CHANGE',
            fromStatus: currentStatus, toStatus: input.targetStatus,
            comment: `بازیابی مدیریتی — دلیل: ${reason}`,
          },
        })
      }

      await (tx as unknown as { auditLog: { create: (a: unknown) => Promise<unknown> } }).auditLog.create({
        data: {
          userId: input.actor.id, action: ADMIN_RECOVERY_ACTION,
          entity: machine.entity, entityId: input.entityId,
          oldValues: JSON.stringify({ [statusKey]: currentStatus }),
          newValues: JSON.stringify({ [statusKey]: input.targetStatus, reason }),
          ip: extractIp(input.req), device: extractAgent(input.req),
        },
      })

      await syncWorkflowStateTx(tx, machine, input.entityId, input.targetStatus)
      return next
    })

    /* 6 — post-commit owner notice (failures logged, never fatal — ED-17) */
    try {
      const ownerId = machine.ownerField ? String((row as Record<string, unknown>)[machine.ownerField] ?? '') : ''
      if (ownerId) {
        const { notify } = await import('@/lib/notify')
        await notify(ownerId, 'WORKFLOW_RECOVERED', {
          extraFa: `${machine.entity} → ${input.targetStatus}`,
        })
      }
    } catch (e) {
      console.error(JSON.stringify({
        level: 'ERROR', scope: 'workflow.recovery.notify',
        entityId: input.entityId, error: e instanceof Error ? e.message : String(e),
      }))
    }

    console.warn(JSON.stringify({
      level: 'WARN', scope: 'workflow.adminRecovery',
      machine: machine.entity, entityId: input.entityId,
      from: currentStatus, to: input.targetStatus, by: input.actor.id, reason,
    }))

    return {
      ok: true,
      entity: { id: updated.id, status: input.targetStatus },
      transition: { action: 'ADMIN_RECOVER', from: currentStatus, to: input.targetStatus },
    }
  } catch (e) {
    if (e instanceof WorkflowError) {
      return { ok: false, code: e.code, error: e.message, httpStatus: e.httpStatus, details: e.details }
    }
    console.error(JSON.stringify({
      level: 'ERROR', scope: 'workflow.adminRecovery',
      entityId: input.entityId, error: e instanceof Error ? e.message : String(e),
    }))
    return { ok: false, code: 'SIDE_EFFECT', error: 'بازیابی گردش کار ناموفق بود | Recovery failed', httpStatus: 500 }
  }
}

function extractIp(req: unknown): string | null {
  const r = req as { headers?: { get(k: string): string | null } } | null
  if (!r?.headers) return null
  return r.headers.get('x-forwarded-for') || r.headers.get('x-real-ip') || null
}

function extractAgent(req: unknown): string | null {
  const r = req as { headers?: { get(k: string): string | null } } | null
  return r?.headers?.get('user-agent') || null
}
