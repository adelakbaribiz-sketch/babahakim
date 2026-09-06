// API layer (thin controller) — business logic in @/server/application (ED-93).
// GET /api/v1/reports/exports — list MY report export artifacts (24h TTL).
import { apiRoute } from '@/server/api/handler'
import { requireAuth } from '@/server/api/guards'
import { myExports } from '@/server/application/services/reportingService'

export const GET = apiRoute(async () => {
  const auth = await requireAuth()
  return myExports(auth)
})
