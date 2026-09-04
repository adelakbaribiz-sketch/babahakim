// API layer (thin controller) — business logic in @/server/application (ED-93).
import { apiRoute, parseBody } from '@/server/api/handler'
import { requireAuth } from '@/server/api/guards'
import { receiptSchema } from '@/server/application/dto'
import { submitReceipt } from '@/server/application/services/paymentService'

// POST /api/v1/payments/[id]/receipt — patient uploads card-to-card receipt
// {trackingCode, amount?, note?, imageId} — PAYMENT machine SUBMIT_RECEIPT.
export const POST = apiRoute<{ id: string }>(async (req, route, env) => {
  const auth = await requireAuth()
  const { id } = await route.params
  const input = await parseBody(req, receiptSchema)
  return submitReceipt(auth, env.ctx, id, input)
})
