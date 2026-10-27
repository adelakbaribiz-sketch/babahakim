// API layer (thin controller) — business logic in @/server/application (ED-93).
import { apiRoute, parseBody } from '@/server/api/handler'
import { passwordResetRequestSchema } from '@/server/application/dto'
import { requestPasswordReset } from '@/server/application/services/authService'

// POST /api/v1/auth/password-reset {nationalId, phone} — OTP to the account's
// mobile, bound to that one account; identical response when nothing matches
export const POST = apiRoute(async (req, _route, env) => {
  const input = await parseBody(req, passwordResetRequestSchema)
  return requestPasswordReset(env.ctx, input)
})
