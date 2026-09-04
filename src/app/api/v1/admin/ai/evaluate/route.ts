// API layer (thin controller) — business logic in @/server/application (ED-93).
import { z } from 'zod'
import { apiRoute, parseBody } from '@/server/api/handler'
import { requireRole } from '@/server/api/guards'
import { requestEvaluation } from '@/server/application/services/aiMlopsService'

const evaluatePostSchema = z.object({
  modelId: z.string().min(1).max(64).optional(),
  datasetId: z.string().min(1).max(64).optional(),
  includeDraft: z.boolean().optional(),
})

// POST /api/v1/admin/ai/evaluate — enqueue full-metric evaluation job (async)
export const POST = apiRoute(async (req, _route, env) => {
  const auth = await requireRole('ADMIN', 'EXPERT_1')
  const input = await parseBody(req, evaluatePostSchema)
  return requestEvaluation(auth, env.ctx, input)
})
