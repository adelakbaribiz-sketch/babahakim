// ── BabaHakim Backend · Application Service: Workflow Governance Ops ────────
// PHASE 12 — the admin workflow-health console backend: machine catalog,
// SLA/stuck snapshot, governance tick trigger and the admin force-recovery.
// Controllers stay thin (ED-93); authorization at the boundary
// (requireRole/requirePermission), engine remains the only state writer.
import { db } from '@/lib/db'
import type { AuthContext } from '@/lib/auth'
import { allMachines } from '@/lib/workflow/registry'
import {
  executeAdminRecovery, ADMIN_RECOVERY_ACTION,
} from '@/lib/workflow/engine'
import {
  allTimeoutPolicies, RETRY_POLICIES, FAILURE_POLICIES, slaLabel,
} from '@/lib/workflow/policies'
import {
  workflowHealthSnapshot, lastGovernanceReport, runWorkflowGovernanceTick,
} from '@/lib/workflow/governance'
import { deadLetters, queueStats } from '@/server/infrastructure/jobs'
import { rateLimit } from '@/lib/security/rate-limit'
import { AppError, ErrorCode, RateLimitError } from '@/server/core/errors'
import { toAuditReq } from '@/server/infrastructure/audit'
import type { RequestContext } from '@/server/core/context'
import type { z } from 'zod'
import type { workflowRecoverSchema } from '@/server/application/dto'

// ════════════════════════════ OVERVIEW (catalog + runtime) ═════════════════

export async function workflowOverview() {
  const policies = allTimeoutPolicies()
  const machines = allMachines().map((m) => ({
    entity: m.entity,
    prismaKey: m.prismaKey,
    statusKey: m.statusKey ?? 'status',
    ownerField: m.ownerField ?? null,
    initial: m.initial,
    statuses: m.statuses,
    transitions: m.transitions.map((t) => ({
      action: t.action, from: t.from, to: t.to, roles: t.roles,
      permission: t.permission ?? null, system: t.system ?? false,
    })),
    timeoutPolicies: policies
      .filter((p) => p.entity === m.entity)
      .map((p) => ({
        status: p.status, afterMs: p.afterMs, afterLabel: slaLabel(p), level: p.level,
        notifyRoles: p.notifyRoles ?? [], notifyOwner: p.notifyOwner ?? false,
        autoAction: p.autoAction ?? null, descFa: p.descFa,
      })),
    retryPolicies: RETRY_POLICIES.filter((r) => r.entity === m.entity),
    failurePolicy: FAILURE_POLICIES.find((f) => f.entity === m.entity) ?? null,
  }))

  const [stuck, recentRecoveries] = await Promise.all([
    workflowHealthSnapshot(),
    db.auditLog.findMany({
      where: { action: ADMIN_RECOVERY_ACTION },
      orderBy: { createdAt: 'desc' }, take: 20,
    }),
  ])

  return {
    machines,
    stuck: stuck.map((s) => ({
      ...s,
      breachHours: Math.round(s.breachMs / 3_600_000),
    })),
    lastTick: lastGovernanceReport(),
    queue: queueStats(),
    deadLetters: deadLetters().map((j) => ({
      id: j.id, type: j.type, attempts: j.attempts, createdAt: j.createdAt,
    })),
    recentRecoveries: recentRecoveries.map((a) => ({
      at: a.createdAt, entity: a.entity, entityId: a.entityId, newValues: a.newValues,
    })),
  }
}

// ════════════════════════════ SCAN (manual tick) ═══════════════════════════

export async function triggerGovernanceScan(auth: { user: { id: string } }) {
  // manual scans are an on-call trigger — the recurring job already ticks
  const rl = rateLimit(`wf-scan:${auth.user.id}`, 3, 60_000)
  if (!rl.allowed) throw new RateLimitError(undefined, { retryAfterSec: rl.retryAfterSec })
  const report = await runWorkflowGovernanceTick()
  return { report }
}

// ════════════════════════════ RECOVER (admin force) ════════════════════════

export async function adminWorkflowRecover(
  auth: AuthContext, ctx: RequestContext, input: z.infer<typeof workflowRecoverSchema>,
) {
  const rl = rateLimit(`wf-recover:${auth.user.id}`, 10, 60_000)
  if (!rl.allowed) throw new RateLimitError(undefined, { retryAfterSec: rl.retryAfterSec })
  const res = await executeAdminRecovery({
    entityType: input.entityType,
    entityId: input.entityId,
    targetStatus: input.targetStatus,
    reason: input.reason,
    actor: { id: auth.user.id, role: auth.user.role as never },
    req: toAuditReq(ctx),
  })
  if (!res.ok) throw new AppError(mapEngineCode(res.code), res.error, res.httpStatus, res.details)
  return { ok: true as const, entity: res.entity, transition: res.transition }
}

/** Map workflow engine error codes onto API error codes. */
function mapEngineCode(code?: string): ErrorCode {
  switch (code) {
    case 'NOT_FOUND': return 'NOT_FOUND'
    case 'FORBIDDEN_ROLE': case 'FORBIDDEN_PERMISSION': case 'NOT_OWNER': return 'FORBIDDEN'
    case 'INVALID_TRANSITION': case 'ALREADY_OWNED': case 'PRECONDITION': return 'CONFLICT'
    case 'VALIDATION': return 'BUSINESS_RULE'
    default: return 'INTERNAL'
  }
}
