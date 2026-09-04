// API layer (thin controller) — business logic in @/server/application (ED-93).
import { apiRoute } from '@/server/api/handler'
import { requireRole } from '@/server/api/guards'
import { monitoringSnapshot } from '@/server/application/services/aiMlopsService'

// GET /api/v1/admin/ai/monitoring — inference stats + bias + cost + live drift check
export const GET = apiRoute(async () => {
  await requireRole('ADMIN', 'EXPERT_1', 'EXPERT_2')
  return monitoringSnapshot()
})
