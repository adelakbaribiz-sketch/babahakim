// API layer (thin controller) — business logic in @/server/application (ED-93).
// GET /api/v1/search?q= — permission-aware global search (PHASE 14, ED-157).
import { apiRoute } from '@/server/api/handler'
import { requireAuth } from '@/server/api/guards'
import { searchEndpoint } from '@/server/application/services/searchService'

export const GET = apiRoute(async (req, _route, env) => {
  const auth = await requireAuth()
  const q = new URL(req.url).searchParams.get('q') || ''
  return searchEndpoint(auth, env.ctx.ip, q)
})
