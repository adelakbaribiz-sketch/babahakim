// API layer (thin controller) — business logic in @/server/application (ED-93).
import { apiRoute } from '@/server/api/handler'
import { refresh } from '@/server/application/services/authService'

// POST /api/v1/auth/refresh — refresh token rotation (family-kill on reuse, ED-64)
// (reuse-detector wiring lives in authService module scope)
export const POST = apiRoute(async (req, _route, env) => refresh(env.ctx))
