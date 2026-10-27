// API layer (thin controller) — business logic in @/server/application (ED-93).
import { apiRoute } from '@/server/api/handler'
import { requireRole } from '@/server/api/guards'
import { listVocabulary } from '@/server/application/services/vocabularyService'

// GET /api/v1/vocabulary?kind=DOSAGE — active presets for prescription comboboxes (staff)
export const GET = apiRoute(async (req) => {
  await requireRole('ADMIN', 'EXPERT_1', 'EXPERT_2', 'DOCTOR', 'OPERATOR')
  return listVocabulary(new URL(req.url).searchParams.get('kind'), false)
})
