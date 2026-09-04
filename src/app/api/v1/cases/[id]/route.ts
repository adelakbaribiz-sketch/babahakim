// API layer (thin controller) — business logic in @/server/application (ED-93).
import { apiRoute } from '@/server/api/handler'
import { requireAuth } from '@/server/api/guards'
import { getCaseDetail } from '@/server/application/services/caseService'

// GET /api/v1/cases/[id] — full case detail (role-scoped, audited for staff)
export const GET = apiRoute<{ id: string }>(async (req, route, env) => {
  const auth = await requireAuth()
  const { id } = await route.params
  return getCaseDetail(auth, env.ctx, id)
})
