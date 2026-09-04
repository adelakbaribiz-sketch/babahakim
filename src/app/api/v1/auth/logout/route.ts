// API layer (thin controller) — business logic in @/server/application (ED-93).
import { apiRoute } from '@/server/api/handler'
import { logoutCurrent } from '@/server/application/services/authService'

// POST /api/v1/auth/logout — revoke family + clear cookies (no body by design)
export const POST = apiRoute(async (req, _route, env) => logoutCurrent(env.ctx))
