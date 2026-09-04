// API layer (thin controller) — business logic in @/server/application (ED-93).
import { apiRoute, parseBody } from '@/server/api/handler'
import { requirePermission } from '@/server/api/guards'
import { deletionRequestPatchSchema } from '@/server/application/dto'
import { listDeletionRequests, patchDeletionRequest } from '@/server/application/services/adminService'

// GET /api/v1/admin/deletion-requests?status=PENDING — queue for admin
export const GET = apiRoute(async (req) => {
  await requirePermission('manage_users')
  const status = new URL(req.url).searchParams.get('status') || 'PENDING'
  return listDeletionRequests(status)
})

// PATCH /api/v1/admin/deletion-requests {requestId, action: ANONYMIZE|REJECT, note?}
export const PATCH = apiRoute(async (req, _route, env) => {
  const auth = await requirePermission('manage_users')
  const input = await parseBody(req, deletionRequestPatchSchema)
  return patchDeletionRequest(auth, env.ctx, input)
})
