// API layer (thin controller) — business logic in @/server/application (ED-93).
import { z } from 'zod'
import { apiRoute, parseBody } from '@/server/api/handler'
import { requireRole } from '@/server/api/guards'
import { datasetAction, listDatasets } from '@/server/application/services/aiMlopsService'

const datasetPostSchema = z.object({
  action: z.enum(['freeze', 'exclude']),
  itemId: z.string().min(1).max(64).optional(),
  reason: z.string().max(500).optional(),
})

// GET /api/v1/admin/ai/datasets — dataset versions + labeled items + stats
export const GET = apiRoute(async () => {
  await requireRole('ADMIN', 'EXPERT_1', 'EXPERT_2')
  return listDatasets()
})

// POST /api/v1/admin/ai/datasets — freeze current draft | exclude an item (QC)
export const POST = apiRoute(async (req, _route, env) => {
  const auth = await requireRole('ADMIN')
  const input = await parseBody(req, datasetPostSchema)
  return datasetAction(auth, env.ctx, input)
})
