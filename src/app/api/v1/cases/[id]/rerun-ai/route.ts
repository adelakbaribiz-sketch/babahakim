// API layer (thin controller) — business logic in @/server/application (ED-93).
import { z } from 'zod'
import { apiRoute, parseBody } from '@/server/api/handler'
import { requireRole } from '@/server/api/guards'
import { rerunCaseAi } from '@/server/application/services/aiMlopsService'

// POST /api/v1/cases/[id]/rerun-ai — re-run analysis with the active model
// (new AIAnalysis row — history preserved; starts PENDING_REVIEW like all AI output)
const rerunSchema = z.object({}).strip() // no input by design — future opts go here

export const POST = apiRoute<{ id: string }>(async (req, route, env) => {
  const auth = await requireRole('ADMIN', 'EXPERT_1')
  const { id } = await route.params
  await parseBody(req, rerunSchema)
  return rerunCaseAi(auth, env.ctx, id)
})
