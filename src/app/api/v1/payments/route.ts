// API layer (thin controller) — business logic in @/server/application (ED-93).
import { apiRoute, parseBody } from '@/server/api/handler'
import { requireAuth, requireRole } from '@/server/api/guards'
import { parseListQuery } from '@/server/api/query'
import { paymentStartSchema } from '@/server/application/dto'
import { listPayments } from '@/server/application/services/orderService'
import { startPayment } from '@/server/application/services/paymentService'

// GET /api/v1/payments?status= — role-scoped (patient: own; staff: all for verify)
export const GET = apiRoute(async (req) => {
  const auth = await requireAuth()
  const query = parseListQuery(req.url, { defaultLimit: 50, sortable: ['createdAt', 'amount'] })
  return listPayments(auth, query, query.raw.get('status') || '')
})

// POST /api/v1/payments — start payment (Zarinpal-mock OR card-to-card receipt)
export const POST = apiRoute(async (req, _route, env) => {
  const auth = await requireRole('PATIENT')
  const input = await parseBody(req, paymentStartSchema)
  return startPayment(auth, env.ctx, input)
})
