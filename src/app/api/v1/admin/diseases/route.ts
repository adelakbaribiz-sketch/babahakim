// API layer (thin controller) — business logic in @/server/application (ED-93).
import { apiRoute, parseBody } from '@/server/api/handler'
import { requireRole } from '@/server/api/guards'
import { diseaseCreateSchema, looseIdSchema } from '@/server/application/dto'
import { listDiseases, createDisease, patchDisease } from '@/server/application/services/adminService'

// GET /api/v1/admin/diseases (ADMIN/clinical roles)
export const GET = apiRoute(async () => {
  await requireRole('ADMIN', 'EXPERT_1', 'EXPERT_2', 'DOCTOR')
  return listDiseases()
})

// POST /api/v1/admin/diseases — create (ADMIN)
export const POST = apiRoute(async (req, _route, env) => {
  const auth = await requireRole('ADMIN')
  const input = await parseBody(req, diseaseCreateSchema)
  return createDisease(auth, env.ctx, input)
})

// PATCH /api/v1/admin/diseases — update / deactivate (ADMIN)
export const PATCH = apiRoute(async (req, _route, env) => {
  const auth = await requireRole('ADMIN')
  const input = await parseBody(req, looseIdSchema)
  return patchDisease(auth, env.ctx, input as Record<string, unknown>)
})
