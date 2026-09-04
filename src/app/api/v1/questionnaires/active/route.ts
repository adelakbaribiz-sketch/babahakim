// API layer (thin controller) — business logic in @/server/application (ED-93).
import { apiRoute } from '@/server/api/handler'
import { requireAuth } from '@/server/api/guards'
import { getActiveQuestionnaire } from '@/server/application/services/questionnaireService'

// GET /api/v1/questionnaires/active — active questionnaire with questions+options
export const GET = apiRoute(async () => {
  const auth = await requireAuth()
  return getActiveQuestionnaire(auth.user.id)
})
