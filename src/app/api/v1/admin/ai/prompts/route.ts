// API layer (thin controller) — business logic in @/server/application (ED-93).
import { apiRoute } from '@/server/api/handler'
import { requireRole } from '@/server/api/guards'
import { promptRegistry } from '@/server/application/services/aiMlopsService'

// GET /api/v1/admin/ai/prompts — prompt template registry (versioned, immutable)
export const GET = apiRoute(async () => {
  await requireRole('ADMIN', 'EXPERT_1', 'EXPERT_2')
  return promptRegistry()
})
