// API layer (thin controller) — business logic in @/server/application (ED-93).
import { apiRoute } from '@/server/api/handler'
import { requireRole } from '@/server/api/guards'
import { getReports } from '@/server/application/services/adminService'

// GET /api/v1/admin/reports?from=&to=&groupBy=day (aggregation in service)
export const GET = apiRoute(async () => {
  await requireRole('ADMIN', 'OPERATOR', 'EXPERT_2')
  return getReports()
})
