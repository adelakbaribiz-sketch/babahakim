// API layer (thin controller) — business logic in @/server/application (ED-93).
// Unified workflow endpoint; 100% of preparation/transition logic lives in
// caseActionService (was 263 inline lines before PHASE 08).
import { apiRoute, parseBody } from '@/server/api/handler'
import { requireAuth } from '@/server/api/guards'
import { caseActionBaseSchema } from '@/server/application/dto'
import { applyCaseAction } from '@/server/application/services/caseActionService'

// POST /api/v1/cases/[id]/action — {action, ...per-action fields}
// Actions: CLAIM | SUBMIT_ASSESSMENT | USER_APPROVE | USER_DECLINE | SUBMIT_PRESCRIPTION |
// EXPERT2_REVIEW | DOCTOR_APPROVE | DOCTOR_REJECT | DOCTOR_REVISION | CREATE_PROFORMA |
// CONFIRM_PROFORMA | REJECT_PROFORMA | MARK_PAID | START_SHIPPING | MARK_DELIVERED |
// SCHEDULE_FOLLOWUP | COMPLETE_FOLLOWUP | REFER_AGAIN
export const POST = apiRoute<{ id: string }>(async (req, route, env) => {
  const auth = await requireAuth()
  const { id } = await route.params
  const body = await parseBody(req, caseActionBaseSchema)
  const outcome = await applyCaseAction(auth, env.ctx, id, body as Record<string, unknown>)
  return { ok: true, case: outcome.case, ...(outcome.extra || {}) }
})
