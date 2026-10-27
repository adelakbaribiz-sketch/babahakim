// API layer (thin controller) — business logic in @/server/application (ED-93).
import { apiRoute, parseBody } from '@/server/api/handler'
import { requireRole } from '@/server/api/guards'
import { adminNationalIdSchema } from '@/server/application/dto'
import { revealNationalId, changeNationalId } from '@/server/application/services/adminService'
import { ValidationError } from '@/server/core/errors'

// GET /api/v1/admin/users/national-id?userId= — reveal (ADMIN only, audited)
export const GET = apiRoute(async (req, _route, env) => {
  const auth = await requireRole('ADMIN')
  const userId = new URL(req.url).searchParams.get('userId')
  if (!userId) throw new ValidationError('شناسه کاربر الزامی است')
  return revealNationalId(auth, env.ctx, userId)
})

// PUT /api/v1/admin/users/national-id {userId, nationalId, reason} — the ONLY
// path that changes a national ID (patients cannot); duplicate-checked, audited
export const PUT = apiRoute(async (req, _route, env) => {
  const auth = await requireRole('ADMIN')
  const input = await parseBody(req, adminNationalIdSchema)
  return changeNationalId(auth, env.ctx, input)
})
