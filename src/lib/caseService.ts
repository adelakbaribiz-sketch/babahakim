// Case workflow service — thin adapter over the generic Workflow Engine (Phase 02).
// applyTransition keeps its original signature so existing routes/UI keep working,
// while ALL guard/validation/event/audit/notify logic now lives in the
// CASE machine + engine (single source of truth, fully audited).
import { NextRequest } from 'next/server'
import { ok, fail } from '@/lib/api'
import { executeTransition } from '@/lib/workflow'
import type { WorkflowAction } from '@/lib/constants'

export async function applyTransition(
  req: NextRequest,
  caseId: string,
  action: WorkflowAction,
  actorId: string,
  actorRole: string,
  payload?: Record<string, unknown>,
) {
  const res = await executeTransition({
    machine: 'CASE',
    entityId: caseId,
    action,
    actor: { id: actorId, role: actorRole as never },
    payload: payload || {},
    req,
  })
  if (!res.ok) {
    return fail(res.error, res.httpStatus, res.details)
  }
  return ok({ ok: true, case: { id: res.entity.id, status: res.entity.status } })
}

// Timeline builder for a case (unchanged — feeds the patient timeline UI)
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
