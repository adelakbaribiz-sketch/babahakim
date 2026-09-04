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
  try {
    /* 1 — load */
    const table = (db as unknown as Record<string, { findUnique: (a: { where: { id: string } }) => Promise<EntityRow | null> }>)[machine.prismaKey]
    const row = await table?.findUnique({ where: { id: input.entityId } })
    if (!row || (row as { deletedAt?: unknown }).deletedAt) {
      return { ok: false, code: 'NOT_FOUND', error: 'رکورد یافت نشد | Not found', httpStatus: 404 }
    }

    /* 2 — guards (role / permission / ownership / graph) */
    const t = assertGuards(machine, row, input.action, input.actor)

    /* 3 — pre-write validation hook */
    const baseCtx: BaseHookCtx = { entity: row, actor: input.actor, payload, transition: t, machine, now }
    try {
      await t.validate?.(baseCtx)
    } catch (e) {
      if (e instanceof WorkflowError) throw e
      throw new WorkflowError('VALIDATION', e instanceof Error ? e.message : 'اعتبارسنجی ناموفق', 422)
    }

    /* 4 — atomic transition */
    const data = { status: t.to, ...(t.dataEffects?.(baseCtx) || {}) }
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
            fromStatus: row.status,
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
          oldValues: JSON.stringify({ status: row.status }),
          newValues: JSON.stringify({ status: t.to, action: t.action }),
          ip: extractIp(input.req),
          device: extractAgent(input.req),
        },
      })

      // declarative cascades inside the same transaction
      if (t.txEffects) await t.txEffects({ ...baseCtx, tx })

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
      entity: { id: updated.id, status: updated.status },
      transition: { action: t.action, from: row.status, to: t.to },
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

function extractIp(req: unknown): string | null {
  const r = req as { headers?: { get(k: string): string | null } } | null
  if (!r?.headers) return null
  return r.headers.get('x-forwarded-for') || r.headers.get('x-real-ip') || null
}

function extractAgent(req: unknown): string | null {
  const r = req as { headers?: { get(k: string): string | null } } | null
  return r?.headers?.get('user-agent') || null
}
