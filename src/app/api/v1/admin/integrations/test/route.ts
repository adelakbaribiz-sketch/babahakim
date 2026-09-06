// API layer (thin controller) — business logic in @/server/application (ED-93).
// POST /api/v1/admin/integrations/test — smoke-test ONE external integration
// adapter (9 kinds): resets the circuit breaker, probes the provider (mock in
// dev/test, live when credentials exist), audits INTEGRATION_SMOKE_TEST, and
// answers { ok, provider, mode, latencyMs, detail, hintFa }. Rate-limited
// 3/minute per admin (a smoke test may hit a LIVE provider). Validation runs
// FIRST: a malformed kind burns no quota (PHASE 14 fix: 400 ≠ 429).
//
// REG-02 (PHASE 18): this endpoint existed only in the service layer + docs
// during PHASE 13 — the route file was never committed and was later lost
// outright. Reconstructed from its locked contract (tests/integration/
// integrations.test.ts §4–5, tests/regression/regression.test.ts REG-02,
// AdminViews3 integrations console) and now guarded by the QA2 route
// inventory so the class can never silently regress again.
import { apiRoute, parseBody } from '@/server/api/handler'
import { requireRole } from '@/server/api/guards'
import { integrationSmokeTest } from '@/server/application/services/integrationsService'
import { integrationSmokeSchema } from '@/server/application/dto'

export const POST = apiRoute(async (req, _route, env) => {
  const auth = await requireRole('ADMIN')
  // zod enum rejects NOT_A_KIND with 400 VALIDATION before any provider call
  const input = await parseBody(req, integrationSmokeSchema)
  return integrationSmokeTest(auth, env.ctx, input)
})
