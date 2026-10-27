// API layer (thin controller) — business logic in @/server/application (ED-93).
import { apiRoute, parseBody } from '@/server/api/handler'
import { passwordResetConfirmSchema } from '@/server/application/dto'
import { confirmPasswordReset } from '@/server/application/services/authService'

// POST /api/v1/auth/password-reset/confirm {challengeId, code, newPassword}
export const POST = apiRoute(async (req, _route, env) => {
  const input = await parseBody(req, passwordResetConfirmSchema)
  return confirmPasswordReset(env.ctx, input)
})
