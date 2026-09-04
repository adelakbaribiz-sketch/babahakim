// ── PHASE 12: Sub-Transition Engine (in-transaction machine-guarded cascades)
//
// The payment/order/case cascades (paymentPaidCascade, cascadePaid, …) used
// to write `status` directly inside their transaction — machine-adjacent but
// NOT machine-guarded: no role/permission/graph check, no audit row, no
// WorkflowState projection. applySubTransition() gives them the full engine
// discipline INSIDE the caller's transaction:
//
//   guards (SYSTEM actor) → validate → status+dataEffects write →
//   CaseEvent (CASE) → AuditLog → WorkflowState upsert
//
// Contract:
//  - runs INSIDE the caller's interactive transaction (tx injected — this
//    module never imports @/lib/db, so machines can import it cycle-free);
//  - cascades always execute as the SYSTEM actor. The initiating human
//    transition's own audit row attributes the human (BR-AUD trail intact);
//  - idempotent: when the target already moved (race with a user action or
//    a replayed gateway callback) the guards return INVALID_TRANSITION and
//    the caller treats it as a no-op (BR-FIN-01 replay semantics);
//  - postCommit hooks DO NOT run here — notifications belong to the parent
//    transition (ED-99: services never notify from inside transactions).
import {
  MachineDef, TransitionDef, WorkflowActor, WorkflowError, ExecResult,
  EntityRow, BaseHookCtx, TxClient,
} from './types'
import { assertGuards } from './pure'

export const SYSTEM_ACTOR: WorkflowActor = { id: 'SYSTEM', role: 'SYSTEM' }

/**
 * Upsert the WorkflowState projection for one instance (atomic with the
 * caller's transition). Entering a new status resets the SLA counters —
 * the governance runtime starts a fresh ladder for the new status.
 */
export async function syncWorkflowStateTx(
  tx: TxClient,
  machine: MachineDef,
  entityId: string,
  status: string,
): Promise<void> {
  const t = tx as unknown as {
    workflowState: {
      upsert: (a: {
        where: { entityType_entityId: { entityType: string; entityId: string } }
        create: Record<string, unknown>
        update: Record<string, unknown>
      }) => Promise<unknown>
    }
  }
  const now = new Date()
  await t.workflowState.upsert({
    where: { entityType_entityId: { entityType: machine.entity, entityId } },
    create: { entityType: machine.entity, entityId, status, enteredAt: now, reminderCount: 0 },
    update: { status, enteredAt: now, reminderCount: 0, escalatedAt: null, lastRemindedAt: null },
  })
}

export interface SubTransitionInput {
  /** Caller's Prisma interactive-transaction client. */
  tx: TxClient
  /** Machine definition object (pass the imported constant — no registry lookup, no import cycle). */
  machine: MachineDef
  entityId: string
  action: string
  payload?: Record<string, unknown>
  /** Override the acting actor — defaults to SYSTEM (cascades are system-attributed). */
  actor?: WorkflowActor
}

/**
 * Machine-guarded transition inside the caller's transaction.
 * Never throws for expected failures — returns a discriminated ExecResult
 * exactly like executeTransition, so cascade callers can branch on
 * `code === 'INVALID_TRANSITION'` for idempotent no-ops.
 */
export async function applySubTransition(input: SubTransitionInput): Promise<ExecResult> {
  const machine = input.machine
  const actor = input.actor ?? SYSTEM_ACTOR
  const now = new Date()
  const payload = input.payload ?? {}
  const statusKey = machine.statusKey ?? 'status'
  const tx = input.tx as unknown as Record<string, {
    findUnique: (a: { where: { id: string } }) => Promise<EntityRow | null>
    update: (a: { where: { id: string }; data: unknown }) => Promise<EntityRow>
  }>
  try {
    /* 1 — load */
    const table = tx[machine.prismaKey]
    const row = await table?.findUnique({ where: { id: input.entityId } })
    if (!row || (row as { deletedAt?: unknown }).deletedAt) {
      return { ok: false, code: 'NOT_FOUND', error: 'رکورد یافت نشد | Not found', httpStatus: 404 }
    }
    const currentStatus = String((row as Record<string, unknown>)[statusKey] ?? machine.initial)

    /* 2 — guards (SYSTEM passes only transitions marked `system`) */
    const t = assertGuards(machine, { ...row, status: currentStatus } as EntityRow, input.action, actor)

    /* 3 — validation hook */
    const baseCtx: BaseHookCtx = { entity: row, actor, payload, transition: t, machine, now }
    try {
      await t.validate?.(baseCtx)
    } catch (e) {
      if (e instanceof WorkflowError) throw e
      throw new WorkflowError('VALIDATION', e instanceof Error ? e.message : 'اعتبارسنجی ناموفق', 422)
    }

    /* 4 — writes, all inside the caller's tx */
    const data = { [statusKey]: t.to, ...(t.dataEffects?.(baseCtx) || {}) }
    const next = await tx[machine.prismaKey].update({ where: { id: input.entityId }, data })

    if (machine.entity === 'CASE') {
      const txCaseEvent = (input.tx as unknown as {
        caseEvent: { create: (a: unknown) => Promise<unknown> }
      }).caseEvent
      await txCaseEvent.create({
        data: {
          caseId: input.entityId,
          actorId: null,
          action: 'STATUS_CHANGE',
          fromStatus: currentStatus,
          toStatus: t.to,
          comment: String(payload.comment || '') || `${t.descFa} (کاسکاد سیستمی)`,
        },
      })
    }

    const txAudit = (input.tx as unknown as {
      auditLog: { create: (a: unknown) => Promise<unknown> }
    }).auditLog
    await txAudit.create({
      data: {
        userId: null,
        action: t.auditAction || `WORKFLOW_${machine.entity}_${t.action}`,
        entity: machine.entity,
        entityId: input.entityId,
        oldValues: JSON.stringify({ [statusKey]: currentStatus }),
        newValues: JSON.stringify({ [statusKey]: t.to, action: t.action, via: 'CASCADE' }),
        ip: 'system', device: 'System',
      },
    })

    // declarative cascades may chain further sub-transitions
    if (t.txEffects) await t.txEffects({ ...baseCtx, tx: input.tx })

    /* 5 — WorkflowState projection (atomic with the status write) */
    await syncWorkflowStateTx(input.tx, machine, input.entityId, t.to)

    return {
      ok: true,
      entity: { id: next.id, status: String((next as Record<string, unknown>)[statusKey] ?? t.to) },
      transition: { action: t.action, from: currentStatus, to: t.to },
    }
  } catch (e) {
    if (e instanceof WorkflowError) {
      return { ok: false, code: e.code, error: e.message, httpStatus: e.httpStatus, details: e.details }
    }
    // cascade failures must never take the parent transaction down silently —
    // rethrow so the caller's $transaction rolls everything back atomically
    throw e
  }
}

/**
 * Idempotent cascade helper: fire a sub-transition, treating
 * INVALID_TRANSITION (target already moved) and NOT_FOUND (row gone /
 * soft-deleted) as a benign no-op. Everything else propagates.
 */
export async function cascadeSubTransition(
  input: SubTransitionInput,
): Promise<ExecResult | null> {
  const res = await applySubTransition(input)
  if (res.ok) return res
  if (res.code === 'INVALID_TRANSITION' || res.code === 'NOT_FOUND') return null
  return res
}

/** Type re-export so machines can annotate their cascade params. */
export type { TransitionDef }
