// API layer (thin controller) — business logic in @/server/application (ED-93).
import { apiRoute } from '@/server/api/handler'
import { requireRole } from '@/server/api/guards'
import { listSmsLog } from '@/server/application/services/adminService'

// GET /api/v1/admin/sms-log (ADMIN/OPERATOR)
export const GET = apiRoute(async () => {
  await requireRole('ADMIN', 'OPERATOR')
  return listSmsLog()
})
