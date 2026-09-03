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
import { ROLE_PERMISSIONS } from '@/lib/constants'
import {
  MachineDef, TransitionDef, WorkflowActor, WorkflowRole,
  WorkflowError, ExecResult, EntityRow, BaseHookCtx,
} from './types'
import { getMachine } from './registry'

/* ── Pure layer (unit-testable, no DB) ───────────────────────────────── */

/**
 * Find the legal transition for (status, action, role).
 * ADMIN passes any role guard (BR-RBAC-02); SYSTEM passes only
 * transitions explicitly marked `system`.
 */
export function resolveTransition(
  machine: MachineDef,
  status: string,
  action: string,
  role: WorkflowRole,
): TransitionDef | null {
  for (const t of machine.transitions) {
    if (t.action !== action) continue
    if (!t.from.includes(status)) continue
    if (role === 'ADMIN') return t
    if (role === 'SYSTEM') {
      if (t.system) return t
      continue
    }
    if (t.roles.includes(role)) return t
  }
  return null
}

/** Does the actor hold the permission required by this transition? */
export function hasPermission(role: WorkflowRole, permission?: string): boolean {
  if (!permission) return true
  if (role === 'ADMIN') return true
  if (role === 'SYSTEM') return true // system transitions are pre-authorized
  const perms = ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS] || []
  return (perms as readonly string[]).includes(permission)
}

/** Ownership guard for patient-facing transitions (BR-RBAC-03). */
export function ownsEntity(
  machine: MachineDef,
  row: EntityRow,
  actor: WorkflowActor,
): boolean {
  if (actor.role !== 'PATIENT') return true
  if (!machine.ownerField) return false // patient + no owner field → deny
  return row[machine.ownerField] === actor.id
}

/** All guard checks — throws WorkflowError on rejection. */
export function assertGuards(
  machine: MachineDef,
  row: EntityRow,
  action: string,
  actor: WorkflowActor,
): TransitionDef {
  const t = resolveTransition(machine, row.status, action, actor.role)
  if (!t) {
    const known = machine.transitions.some((x) => x.action === action)
    throw new WorkflowError(
      'INVALID_TRANSITION',
      known
        ? `اقدام «${action}» از وضعیت «${row.status}» یا نقش «${actor.role}» مجاز نیست | Invalid transition`
        : `اقدام «${action}» در این گردش کار تعریف نشده است | Unknown action`,
      409,
      { status: row.status },
    )
  }
  if (!hasPermission(actor.role, t.permission)) {
    throw new WorkflowError(
      'FORBIDDEN_PERMISSION',
      'دسترسی لازم را ندارید | Permission denied',
      403,
      { required: t.permission },
    )
  }
  if (t.requireOwnership || actor.role === 'PATIENT') {
    if (!ownsEntity(machine, row, actor)) {
      throw new WorkflowError(
        'NOT_OWNER',
        'شما فقط به رکوردهای خودتان دسترسی دارید | Not your record',
        403,
      )
    }
  }
  return t
}

/** Statuses reachable from a given status (graph helper for tests/docs). */
export function reachableFrom(machine: MachineDef, status: string): string[] {
  const out = new Set<string>()
  for (const t of machine.transitions) {
    if (t.from.includes(status)) out.add(t.to)
  }
  return [...out]
}

/** Statuses with no outgoing transitions (terminal states). */
export function terminalStatuses(machine: MachineDef): string[] {
  return machine.statuses.filter((s) => reachableFrom(machine, s).length === 0)
}

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
