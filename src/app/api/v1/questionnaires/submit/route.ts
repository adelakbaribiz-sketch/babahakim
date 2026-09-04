// API layer (thin controller) — business logic in @/server/application (ED-93).
import { apiRoute, parseBody } from '@/server/api/handler'
import { requireAuth } from '@/server/api/guards'
import { questionnaireSubmitSchema } from '@/server/application/dto'
import { submitQuestionnaire } from '@/server/application/services/questionnaireService'

// POST /api/v1/questionnaires/submit — score & persist temperament (history never deleted)
export const POST = apiRoute(async (req, _route, env) => {
  const auth = await requireAuth()
  const input = await parseBody(req, questionnaireSubmitSchema)
  return submitQuestionnaire(auth, env.ctx, input)
})
