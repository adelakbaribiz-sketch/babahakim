// API layer (thin controller) — business logic in @/server/application (ED-93).
// GET /api/v1/images/[id] — upload status + quality report (poll endpoint
// for the 202-accepted async pipeline; PHASE 10 contract).
import { apiRoute } from '@/server/api/handler'
import { requireAuth } from '@/server/api/guards'
import { getImageStatus } from '@/server/application/services/imageService'

type P = { id: string }

export const GET = apiRoute<P>(async (_req, route, env) => {
  const auth = await requireAuth()
  const { id } = await route.params
  return getImageStatus(auth, env.ctx, id)
})
