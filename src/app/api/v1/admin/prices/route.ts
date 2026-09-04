// API layer (thin controller) — business logic in @/server/application (ED-93).
import { apiRoute, parseBody } from '@/server/api/handler'
import { requireRole } from '@/server/api/guards'
import { priceEngineSchema } from '@/server/application/dto'
import { priceEngine, listPriceHistory } from '@/server/application/services/adminService'

// POST /api/v1/admin/prices — {mode: preview|commit|bulk} (history preserved)
export const POST = apiRoute(async (req, _route, env) => {
  const auth = await requireRole('ADMIN', 'OPERATOR')
  const input = await parseBody(req, priceEngineSchema)
  return priceEngine(auth, env.ctx, input)
})

// GET /api/v1/admin/prices — full price history log
export const GET = apiRoute(async () => {
  await requireRole('ADMIN', 'OPERATOR', 'EXPERT_2')
  return listPriceHistory()
})
