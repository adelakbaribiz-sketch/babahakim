// API layer (thin controller) — business logic in @/server/application (ED-93).
import { apiRoute, parseBody } from '@/server/api/handler'
import { loginSchema } from '@/server/application/dto'
import { login } from '@/server/application/services/authService'

// POST /api/v1/auth/login — phone + password (rate-limited, MFA hook)
export const POST = apiRoute(async (req, _route, env) => {
  const input = await parseBody(req, loginSchema)
  return login(env.ctx, input)
})
