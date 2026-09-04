// API layer (thin controller) — business logic in @/server/application (ED-93).
import { apiRoute, parseBody } from '@/server/api/handler'
import { requireAuth, requireRole } from '@/server/api/guards'
import { parseListQuery } from '@/server/api/query'
import { checkoutSchema } from '@/server/application/dto'
import { listOrders, checkout } from '@/server/application/services/orderService'

// GET /api/v1/orders?page=&limit=&status=&type= — role-scoped list
export const GET = apiRoute(async (req) => {
  const auth = await requireAuth()
  const query = parseListQuery(req.url, { defaultLimit: 50, sortable: ['createdAt', 'updatedAt', 'total'] })
  return listOrders(auth, query, query.raw.get('status') || '', query.raw.get('type') || '')
})

// POST /api/v1/orders — checkout from cart → order + proforma invoice (atomic)
export const POST = apiRoute(async (req, _route, env) => {
  const auth = await requireRole('PATIENT')
  await parseBody(req, checkoutSchema) // cart is the source of truth; body is optional
  return checkout(auth, env.ctx)
})
