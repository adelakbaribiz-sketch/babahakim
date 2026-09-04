// API layer (thin controller) — business logic in @/server/application (ED-93).
import { z } from 'zod'
import { apiRoute, parseBody } from '@/server/api/handler'
import { requestOtpChallenge } from '@/server/application/services/authService'

// shape-only at the boundary; semantic validation (phone range, purpose set)
// stays in the service and returns 422 per the Phase-05 contract.
const otpRequestRouteSchema = z.object({
  phone: z.string().min(1).max(20),
  purpose: z.string().min(1).max(40),
})

// POST /api/v1/auth/otp/request {phone, purpose} — rate-limited 3/10min per phone
export const POST = apiRoute(async (req, _route, env) => {
  const input = await parseBody(req, otpRequestRouteSchema)
  return requestOtpChallenge(env.ctx, input.phone, input.purpose)
})
