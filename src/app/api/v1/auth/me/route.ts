// API layer (thin controller) — business logic in @/server/application (ED-93).
import { apiRoute } from '@/server/api/handler'
import { requireAuth } from '@/server/api/guards'
import { me } from '@/server/application/services/authService'

// GET /api/v1/auth/me — session user + effective permissions
export const GET = apiRoute(async () => {
  const auth = await requireAuth()
  return me(auth)
})
