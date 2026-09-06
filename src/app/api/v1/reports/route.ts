// API layer (thin controller) — business logic in @/server/application (ED-93).
// GET /api/v1/reports — permission-aware report catalog (PHASE 14, ED-154).
import { apiRoute } from '@/server/api/handler'
import { requireAuth } from '@/server/api/guards'
import { reportCatalog } from '@/server/application/services/reportingService'

export const GET = apiRoute(async () => {
  const auth = await requireAuth()
  return reportCatalog(auth)
})
