// API layer (thin controller) — business logic in @/server/application (ED-93).
import { apiRoute } from '@/server/api/handler'
import { requireRole } from '@/server/api/guards'
import { listAiModels } from '@/server/application/services/adminService'

// GET /api/v1/admin/ai-models — model registry + dataset stats (learning loop)
export const GET = apiRoute(async () => {
  await requireRole('ADMIN', 'EXPERT_1', 'EXPERT_2', 'DOCTOR')
  return listAiModels()
})
