// API layer (thin controller) — business logic in @/server/application (ED-93).
import { apiRoute } from '@/server/api/handler'
import { requireRole } from '@/server/api/guards'
import { aiOverview } from '@/server/application/services/aiMlopsService'

// GET /api/v1/admin/ai/overview — full AI ops snapshot:
// model registry + dataset stats + inference monitoring + bias + cost + reports
export const GET = apiRoute(async () => {
  await requireRole('ADMIN', 'EXPERT_1', 'EXPERT_2', 'DOCTOR')
  return aiOverview()
})
