// API layer (thin controller) — business logic in @/server/application (ED-93).
import { apiRoute, parseBody } from '@/server/api/handler'
import { requireAuth } from '@/server/api/guards'
import { paymentVerifySchema } from '@/server/application/dto'
import { verifyPayment } from '@/server/application/services/paymentService'

// POST /api/v1/payments/[id]/verify — operator approves/rejects card-to-card receipt
// {decision: APPROVE|REJECT|MORE_INFO, note} — PAYMENT machine cascade is atomic.
export const POST = apiRoute<{ id: string }>(async (req, route, env) => {
  const auth = await requireAuth()
  const { id } = await route.params
  const input = await parseBody(req, paymentVerifySchema)
  return verifyPayment(auth, env.ctx, id, input)
})
