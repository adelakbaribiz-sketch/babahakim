// API layer (thin controller) — business logic in @/server/application (ED-93).
import { apiRoute } from '@/server/api/handler'
import { requireAuth } from '@/server/api/guards'
import { getDashboard } from '@/server/application/services/dashboardService'

// GET /api/v1/dashboard — role-scoped dynamic dashboard data (15s cache)
export const GET = apiRoute(async () => {
  const auth = await requireAuth()
  return getDashboard(auth)
})
