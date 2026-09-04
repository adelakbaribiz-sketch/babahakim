// API layer (thin controller) — business logic in @/server/application (ED-93).
import { apiRoute, parseBody } from '@/server/api/handler'
import { requireAuth } from '@/server/api/guards'
import { followupPatchSchema } from '@/server/application/dto'
import { listFollowups, patchFollowup } from '@/server/application/services/supportService'

// GET /api/v1/followups — staff: all (Due Today/Overdue/Upcoming); patient: own
export const GET = apiRoute(async () => {
  const auth = await requireAuth()
  return listFollowups(auth)
})

// PATCH /api/v1/followups {id, status?, note?, resultNote?, reason?}
export const PATCH = apiRoute(async (req, _route, env) => {
  const auth = await requireAuth()
  const input = await parseBody(req, followupPatchSchema)
  return patchFollowup(auth, env.ctx, input)
})
