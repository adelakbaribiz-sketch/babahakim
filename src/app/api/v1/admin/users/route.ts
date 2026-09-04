// API layer (thin controller) — business logic in @/server/application (ED-93).
import { apiRoute, parseBody } from '@/server/api/handler'
import { requireRole } from '@/server/api/guards'
import { parseListQuery } from '@/server/api/query'
import { adminUserPatchSchema } from '@/server/application/dto'
import { listAdminUsers, patchAdminUser } from '@/server/application/services/adminService'

// GET /api/v1/admin/users?q=&role= (ADMIN)
export const GET = apiRoute(async (req) => {
  await requireRole('ADMIN')
  const query = parseListQuery(req.url, { defaultLimit: 100, maxLimit: 300 })
  return listAdminUsers(query, query.raw.get('role') || '')
})

// PATCH /api/v1/admin/users — activate/deactivate/role change (ADMIN)
export const PATCH = apiRoute(async (req, _route, env) => {
  const auth = await requireRole('ADMIN')
  const input = await parseBody(req, adminUserPatchSchema)
  return patchAdminUser(auth, env.ctx, input)
})
