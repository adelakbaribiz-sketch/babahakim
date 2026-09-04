// API layer (thin controller) — business logic in @/server/application (ED-93).
import { apiRoute } from '@/server/api/handler'
import { requireAuth } from '@/server/api/guards'
import { exportData } from '@/server/application/services/imageService'

// GET /api/v1/privacy/export — full personal data export (JSON bundle, 1/day)
export const GET = apiRoute(async (req, _route, env) => {
  const auth = await requireAuth()
  return exportData(auth, env.ctx)
})
