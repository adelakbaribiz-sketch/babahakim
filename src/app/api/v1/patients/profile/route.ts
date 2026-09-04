// API layer (thin controller) — business logic in @/server/application (ED-93).
import { apiRoute, parseBody } from '@/server/api/handler'
import { requireAuth } from '@/server/api/guards'
import { profileUpdateSchema } from '@/server/application/dto'
import { getProfile, updateProfile } from '@/server/application/services/profileService'

// GET /api/v1/patients/profile
export const GET = apiRoute(async () => {
  const auth = await requireAuth()
  return getProfile(auth)
})

// PUT /api/v1/patients/profile
export const PUT = apiRoute(async (req, _route, env) => {
  const auth = await requireAuth()
  const input = await parseBody(req, profileUpdateSchema)
  return updateProfile(auth, env.ctx, input)
})
