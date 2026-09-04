// API layer (thin controller) — business logic in @/server/application (ED-93).
import { apiRoute } from '@/server/api/handler'
import { requireAuth } from '@/server/api/guards'
import { getHistory } from '@/server/application/services/questionnaireService'

// GET /api/v1/questionnaires/history — patient's own submissions (history kept)
export const GET = apiRoute(async () => {
  const auth = await requireAuth()
  return getHistory(auth.user.id)
})
