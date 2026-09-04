// API layer (thin controller) — business logic in @/server/application (ED-93).
// GET /api/v1/admin/media/stats — storage totals by status/class/category,
// quarantine count, live queue stats, effective policy table.
import { apiRoute } from '@/server/api/handler'
import { requireRole } from '@/server/api/guards'
import { mediaStats } from '@/server/application/services/mediaFileService'

export const GET = apiRoute(async (_req, _route, _env) => {
  await requireRole('ADMIN')
  return mediaStats()
})
