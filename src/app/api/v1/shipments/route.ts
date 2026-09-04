// API layer (thin controller) — business logic in @/server/application (ED-93).
import { apiRoute, parseBody } from '@/server/api/handler'
import { requireAuth } from '@/server/api/guards'
import { parseListQuery } from '@/server/api/query'
import { shippingSchema } from '@/server/application/dto'
import { listShipments, patchShipment } from '@/server/application/services/supportService'

// GET /api/v1/shipments — staff: all; patient: own (via orders)
export const GET = apiRoute(async (req) => {
  const auth = await requireAuth()
  const query = parseListQuery(req.url, { defaultLimit: 100 })
  return listShipments(auth, query)
})

// PATCH /api/v1/shipments — staff registers/updates delivery info
// {shipmentId, method?, driverName?, trackingCode?, cost?, status?, reason?}
export const PATCH = apiRoute(async (req, _route, env) => {
  const auth = await requireAuth()
  const input = await parseBody(req, shippingSchema)
  return patchShipment(auth, env.ctx, input)
})
