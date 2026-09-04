// API layer (thin controller) — business logic in @/server/application (ED-93).
import { apiRoute, parseBody } from '@/server/api/handler'
import { requireAuth } from '@/server/api/guards'
import { orderPatchSchema } from '@/server/application/dto'
import { getOrder, patchOrder } from '@/server/application/services/orderService'

// GET /api/v1/orders/[id]
export const GET = apiRoute<{ id: string }>(async (req, route) => {
  const auth = await requireAuth()
  const { id } = await route.params
  return getOrder(auth, id)
})

// PATCH /api/v1/orders/[id] — operator: CONFIRM / CANCEL / PREPARING / READY / REFUND (ORDER machine)
export const PATCH = apiRoute<{ id: string }>(async (req, route, env) => {
  const auth = await requireAuth()
  const { id } = await route.params
  const input = await parseBody(req, orderPatchSchema)
  return patchOrder(auth, env.ctx, id, input)
})
