// ── PHASE 12: Workflow Governance Runtime (server-side) ─────────────────
//
// The recurring heartbeat that turns the policy layer (policies.ts) into
// enforced behavior. Every 2 minutes (bootstrap wiring) it:
//
//   1. BACKFILL + DRIFT-RECONCILE each machine: entities missing from
//      WorkflowState are projected (enteredAt = createdAt); entries whose
//      projected status no longer matches the entity row are re-synced and
//      audited as WORKFLOW_STATE_DRIFT — any future code path that writes
//      status around the engine becomes visible here (backend SoT guard).
//   2. EVALUATE the SLA ladder per entry → REMIND (notify owner + roles,
//      cooldown + cap) / ESCALATE (one-shot, ADMIN + roles) /
//      AUTO_TRANSITION (machine action fired by the SYSTEM actor, idempotent,
//      cooldown-backed retry).
//
// The runtime NEVER writes entity status directly — every state change goes
// through executeTransition, so guards/audit/CaseEvent apply uniformly.
// All writes are bounded (BACKFILL_LIMIT per machine per tick) to keep the
// tick O(entities) predictable on SQLite.
import { db } from '@/lib/db'
import type { MachineDef } from './types'
import { allMachines } from './registry'
import {
  TimeoutPolicy, timeoutPoliciesFor, timeoutPolicyStatuses,
  governanceDecision, GovernanceEntry,
} from './policies'
import { executeTransition } from './engine'

const BACKFILL_LIMIT = 500
const SYSTEM_ACTOR = { id: 'SYSTEM', role: 'SYSTEM' as const }

export interface GovernanceReport {
  ranAt: string
  machines: number
  scanned: number
  backfilled: number
  driftReconciled: number
  reminded: number
  escalated: number
  autoTransitions: number
  autoNoOps: number
  errors: string[]
}

export interface StuckInstance {
  entityType: string
  entityId: string
  status: string
  enteredAt: Date
  /** Milliseconds past the SLA deadline of the binding policy (>= 0). */
  breachMs: number
  level: 'REMIND' | 'ESCALATE' | 'AUTO_TRANSITION' | 'SILENCED'
  descFa: string
  reminderCount: number
  escalated: boolean
}

const g = globalThis as unknown as { __bhGovernance?: { lastReport?: GovernanceReport } }

/** Report of the last completed tick (admin overview). */
export function lastGovernanceReport(): GovernanceReport | null {
  return g.__bhGovernance?.lastReport ?? null
}

/** Run one full governance tick (also exposed to the admin scan endpoint). */
export async function runWorkflowGovernanceTick(opts?: { now?: Date }): Promise<GovernanceReport> {
  const now = opts?.now ?? new Date()
  const report: GovernanceReport = {
    ranAt: now.toISOString(), machines: 0, scanned: 0, backfilled: 0, driftReconciled: 0,
    reminded: 0, escalated: 0, autoTransitions: 0, autoNoOps: 0, errors: [],
  }
  for (const machine of allMachines()) {
    report.machines += 1
    try {
      await backfillAndReconcile(machine, now, report)
      await evaluateTimeouts(machine, now, report)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      report.errors.push(`${machine.entity}: ${msg}`)
      govLog('tick machine failed', { machine: machine.entity, error: msg })
    }
  }
  g.__bhGovernance ??= {}
  g.__bhGovernance.lastReport = report
  govLog('governance tick complete', { ...report, errors: report.errors.length })
  return report
}

/* ── backfill + drift reconciliation (bounded per machine) ─────────────── */

/**
 * Timestamp-column capabilities per machine table (probed against the live
 * schema — not every model carries updatedAt/deletedAt; DeletionRequest
 * tracks time via requestedAt). `updated` is a best-effort drift timestamp:
 * tables without updatedAt fall back to createdAt.
 */
const TS_CAPS: Record<string, { created: string; updated: string; deleted: string | null }> = {
  medicalCase: { created: 'createdAt', updated: 'updatedAt', deleted: 'deletedAt' },
  prescription: { created: 'createdAt', updated: 'updatedAt', deleted: null },
  order: { created: 'createdAt', updated: 'updatedAt', deleted: null },
  payment: { created: 'createdAt', updated: 'createdAt', deleted: null },
  shipment: { created: 'createdAt', updated: 'createdAt', deleted: null },
  ticket: { created: 'createdAt', updated: 'updatedAt', deleted: null },
  followUp: { created: 'createdAt', updated: 'createdAt', deleted: null },
  aIAnalysis: { created: 'createdAt', updated: 'createdAt', deleted: null },
  deletionRequest: { created: 'requestedAt', updated: 'requestedAt', deleted: null },
  medicalImage: { created: 'createdAt', updated: 'createdAt', deleted: null },
  invoice: { created: 'createdAt', updated: 'createdAt', deleted: null },
}

async function backfillAndReconcile(machine: MachineDef, now: Date, report: GovernanceReport): Promise<void> {
  const statusKey = machine.statusKey ?? 'status'
  const caps = TS_CAPS[machine.prismaKey] ?? { created: 'createdAt', updated: 'updatedAt', deleted: null }
  const delegate = (db as unknown as Record<string, {
    findMany: (a: { take: number; orderBy: Record<string, 'asc' | 'desc'>; select: Record<string, boolean> }) => Promise<Array<Record<string, unknown>>>
  }>)[machine.prismaKey]
  if (!delegate) return

  const select: Record<string, boolean> = { id: true }
  select[statusKey] = true
  select[caps.created] = true
  select[caps.updated] = true
  if (caps.deleted) select[caps.deleted] = true
  if (machine.ownerField) select[machine.ownerField] = true
  const rows = await delegate.findMany({ take: BACKFILL_LIMIT, orderBy: { [caps.created]: 'desc' }, select })
  if (!rows.length) return

  const live = rows.filter((r) => (caps.deleted ? !r[caps.deleted] : true))
  const entries = await db.workflowState.findMany({
    where: { entityType: machine.entity, entityId: { in: live.map((r) => String(r.id)) } },
  })
  const byEntity = new Map(entries.map((e) => [e.entityId, e]))

  for (const row of live) {
    const id = String(row.id)
    const actualStatus = String(row[statusKey] ?? machine.initial)
    const entry = byEntity.get(id)

    if (!entry) {
      // legacy row created before PHASE 12 — project it now
      await db.workflowState.create({
        data: {
          entityType: machine.entity, entityId: id, status: actualStatus,
          enteredAt: (row[caps.created] as Date) ?? now, reminderCount: 0,
        },
      }).catch(() => { /* concurrent tick created it — fine */ })
      report.backfilled += 1
      continue
    }

    if (entry.status !== actualStatus) {
      // DRIFT: something moved the status outside the engine. Re-sync the
      // projection (entity row stays canonical) + audit the anomaly.
      await db.workflowState.update({
        where: { id: entry.id },
        data: { status: actualStatus, enteredAt: (row[caps.updated] as Date) ?? now, lastDriftSyncAt: now },
      })
      await systemAudit('WORKFLOW_STATE_DRIFT', machine.entity, id, {
        projected: entry.status, actual: actualStatus,
      })
      report.driftReconciled += 1
    }
  }
}

/* ── SLA ladder evaluation ────────────────────────────────────────────── */

async function evaluateTimeouts(machine: MachineDef, now: Date, report: GovernanceReport): Promise<void> {
  const statuses = timeoutPolicyStatuses(machine.entity)
  if (!statuses.length) return
  const entries = await db.workflowState.findMany({
    where: { entityType: machine.entity, status: { in: statuses } },
    take: 1000,
  })
  report.scanned += entries.length

  for (const entry of entries) {
    const policies = timeoutPoliciesFor(machine.entity, entry.status)
    const gEntry: GovernanceEntry = {
      status: entry.status, enteredAt: entry.enteredAt,
      lastRemindedAt: entry.lastRemindedAt, reminderCount: entry.reminderCount,
      escalatedAt: entry.escalatedAt,
    }
    for (const policy of policies) {
      const decision = governanceDecision(gEntry, policy, now)
      if (!decision.fire) continue
      try {
        if (decision.level === 'REMIND') await applyRemind(machine, entry, policy, now, report)
        else if (decision.level === 'ESCALATE') await applyEscalate(machine, entry, policy, now, report)
        else await applyAutoTransition(machine, entry, policy, now, report)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        report.errors.push(`${machine.entity}/${entry.entityId}/${policy.level}: ${msg}`)
      }
    }
  }
}

async function applyRemind(
  machine: MachineDef,
  entry: { entityId: string; reminderCount: number },
  policy: TimeoutPolicy,
  now: Date,
  report: GovernanceReport,
): Promise<void> {
  // latch FIRST: notification failures must not re-fire every tick
  await db.workflowState.updateMany({
    where: { entityType: machine.entity, entityId: entry.entityId },
    data: { lastRemindedAt: now, reminderCount: { increment: 1 } },
  })
  await systemAudit('WORKFLOW_SLA_REMIND', machine.entity, entry.entityId, {
    status: policy.status, reminder: entry.reminderCount + 1, descFa: policy.descFa,
  })
  await notifyPolicyTargets(machine, entry.entityId, policy, 'WORKFLOW_REMINDER')
  report.reminded += 1
}

async function applyEscalate(
  machine: MachineDef,
  entry: { entityId: string; escalatedAt: Date | null },
  policy: TimeoutPolicy,
  now: Date,
  report: GovernanceReport,
): Promise<void> {
  // one-shot latch
  await db.workflowState.updateMany({
    where: { entityType: machine.entity, entityId: entry.entityId },
    data: { escalatedAt: now },
  })
  await systemAudit('WORKFLOW_SLA_ESCALATE', machine.entity, entry.entityId, {
    status: policy.status, descFa: policy.descFa,
  })
  // ESCALATE always informs ADMIN; the policy may add more roles/owner
  const { notifyRole } = await import('@/lib/notify')
  const extraFa = `${machine.entity} (${policy.status}) — ${policy.descFa}`
  await notifyRole('ADMIN', 'WORKFLOW_ESCALATED', { extraFa }).catch(() => { /* non-fatal */ })
  await notifyPolicyTargets(machine, entry.entityId, policy, 'WORKFLOW_ESCALATED')
  report.escalated += 1
}

async function applyAutoTransition(
  machine: MachineDef,
  entry: { entityId: string; lastRemindedAt: Date | null },
  policy: TimeoutPolicy,
  now: Date,
  report: GovernanceReport,
): Promise<void> {
  // attempt latch (5-min default cooldown backs the retry ladder)
  await db.workflowState.updateMany({
    where: { entityType: machine.entity, entityId: entry.entityId },
    data: { lastRemindedAt: now },
  })
  const res = await executeTransition({
    machine: machine.entity, entityId: entry.entityId,
    action: String(policy.autoAction || ''),
    actor: SYSTEM_ACTOR,
    payload: { reason: `SLA: ${policy.descFa}` },
  })
  if (res.ok) {
    report.autoTransitions += 1
    await systemAudit('WORKFLOW_SLA_AUTO', machine.entity, entry.entityId, {
      action: policy.autoAction, from: policy.status, descFa: policy.descFa,
    })
    return
  }
  // benign: the entity moved before the timer (user/gateway won the race) —
  // backfill on the next tick reconciles the projection
  if (res.code === 'INVALID_TRANSITION' || res.code === 'NOT_FOUND') {
    report.autoNoOps += 1
    return
  }
  // transient failure: cooldown-gated retry (policies RETRY_POLICIES documents
  // the backoff curve); surfaced in the report + engine logs
  report.autoNoOps += 1
  report.errors.push(`${machine.entity}/${entry.entityId}/AUTO: ${res.code} — ${res.error}`)
}

/* ── health snapshot (admin overview, read-only) ──────────────────────── */

/**
 * All currently-breached workflow instances with the policy that binds them.
 * SILENCED = breached but suppressed (max reminders / already escalated) —
 * still actionable via the admin recovery console.
 */
export async function workflowHealthSnapshot(now: Date = new Date()): Promise<StuckInstance[]> {
  const stuck: StuckInstance[] = []
  for (const machine of allMachines()) {
    const statuses = timeoutPolicyStatuses(machine.entity)
    if (!statuses.length) continue
    const entries = await db.workflowState.findMany({
      where: { entityType: machine.entity, status: { in: statuses } },
      take: 1000,
    })
    for (const entry of entries) {
      const policies = timeoutPoliciesFor(machine.entity, entry.status)
      let worst: StuckInstance | null = null
      for (const policy of policies) {
        const decision = governanceDecision(
          {
            status: entry.status, enteredAt: entry.enteredAt,
            lastRemindedAt: entry.lastRemindedAt, reminderCount: entry.reminderCount,
            escalatedAt: entry.escalatedAt,
          },
          policy, now,
        )
        const overdueMs = now.getTime() - (entry.enteredAt.getTime() + policy.afterMs)
        if (overdueMs < 0) continue
        const level: StuckInstance['level'] = decision.fire ? decision.level : 'SILENCED'
        const candidate: StuckInstance = {
          entityType: machine.entity, entityId: entry.entityId, status: entry.status,
          enteredAt: entry.enteredAt, breachMs: overdueMs, level,
          descFa: policy.descFa, reminderCount: entry.reminderCount,
          escalated: Boolean(entry.escalatedAt),
        }
        // keep the most severe firing policy (AUTO > ESCALATE > REMIND > SILENCED)
        if (!worst || severity(candidate.level) > severity(worst.level)) worst = candidate
      }
      if (worst) stuck.push(worst)
    }
  }
  return stuck.sort((a, b) => b.breachMs - a.breachMs)
}

function severity(level: StuckInstance['level']): number {
  switch (level) {
    case 'AUTO_TRANSITION': return 3
    case 'ESCALATE': return 2
    case 'REMIND': return 1
    default: return 0
  }
}

/* ── notification fan-out (failures never break the tick) ─────────────── */

async function notifyPolicyTargets(machine: MachineDef, entityId: string, policy: TimeoutPolicy, event: 'WORKFLOW_REMINDER' | 'WORKFLOW_ESCALATED'): Promise<void> {
  const { notify, notifyRole } = await import('@/lib/notify')
  const extraFa = `${machine.entity} (${policy.status}) — ${policy.descFa}`
  if (policy.notifyOwner) {
    const ownerId = await resolveOwnerId(machine, entityId)
    if (ownerId) await notify(ownerId, event, { extraFa }).catch(() => { /* non-fatal */ })
  }
  for (const role of policy.notifyRoles ?? []) {
    await notifyRole(role, event, { extraFa }).catch(() => { /* non-fatal */ })
  }
}

async function resolveOwnerId(machine: MachineDef, entityId: string): Promise<string | null> {
  if (!machine.ownerField) return null
  const delegate = (db as unknown as Record<string, {
    findUnique: (a: { where: { id: string }; select: Record<string, boolean> }) => Promise<Record<string, unknown> | null>
  }>)[machine.prismaKey]
  if (!delegate) return null
  const select: Record<string, boolean> = { id: true }
  select[machine.ownerField] = true
  const row = await delegate.findUnique({ where: { id: entityId }, select })
  return row ? String(row[machine.ownerField as string] ?? '') || null : null
}

async function systemAudit(action: string, entity: string, entityId: string, newValues: Record<string, unknown>): Promise<void> {
  await db.auditLog.create({
    data: {
      userId: null, action, entity, entityId,
      oldValues: null, newValues: JSON.stringify(newValues),
      ip: 'system', device: 'System', sensitive: false,
    },
  }).catch(() => { /* audit best-effort (same discipline as jobs.ts DLQ hook) */ })
}

function govLog(msg: string, meta: Record<string, unknown>): void {
  console.log(JSON.stringify({ level: 'INFO', scope: 'workflow.governance', msg, ...meta }))
}
