// API layer (thin controller) — business logic in @/server/application (ED-93).
import { apiRoute, parseBody } from '@/server/api/handler'
import { registerSchema } from '@/server/application/dto'
import { register } from '@/server/application/services/authService'

// POST /api/v1/auth/register — patient self-registration (validated, rate-limited)
export const POST = apiRoute(async (req, _route, env) => {
  const input = await parseBody(req, registerSchema)
  return register(env.ctx, input)
})
