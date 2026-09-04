// API layer (thin controller) — business logic in @/server/application (ED-93).
import { apiRoute, parseBody } from '@/server/api/handler'
import { requireAuth, requireRole } from '@/server/api/guards'
import { parseListQuery } from '@/server/api/query'
import { caseCreateSchema, caseListFilterSchema } from '@/server/application/dto'
import { listCases, createCase } from '@/server/application/services/caseService'

// GET /api/v1/cases?page=&limit=&sort=&order=&status=&q= — role-scoped queue/list
export const GET = apiRoute(async (req) => {
  const auth = await requireAuth()
  const query = parseListQuery(req.url, { defaultLimit: 50, sortable: ['createdAt', 'updatedAt', 'priority'] })
  const { status } = caseListFilterSchema.parse(Object.fromEntries(query.raw.entries()))
  return listCases(auth, query, status)
})

// POST /api/v1/cases — patient creates case {description, imageId, priority}
export const POST = apiRoute(async (req, _route, env) => {
  const auth = await requireRole('PATIENT', 'ADMIN')
  const input = await parseBody(req, caseCreateSchema)
  return createCase(auth, env.ctx, input)
})
