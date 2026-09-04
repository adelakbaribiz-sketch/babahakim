// API layer (thin controller) — business logic in @/server/application (ED-93).
// CSRF-exempt by middleware (external gateway simulator, Phase 05 single exemption).
import { apiRoute } from '@/server/api/handler'
import { gatewayCallback } from '@/server/application/services/paymentService'

// GET /api/v1/payments/zarinpal/callback?authority=&status=
// Idempotent: repeated callbacks with the same authority resolve from the
// already-PAID row (BR-FIN-01); paid-cascade runs in the PAYMENT machine tx.
export const GET = apiRoute(async (req, _route, env) => {
  const url = new URL(req.url)
  const authority = url.searchParams.get('authority') || ''
  const status = url.searchParams.get('status') || ''
  return gatewayCallback(env.ctx, authority, status)
})

// POST — same as GET for programmatic simulation
export const POST = GET
