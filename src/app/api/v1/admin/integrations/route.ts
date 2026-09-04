// API layer (thin controller) — business logic in @/server/application (ED-93).
// GET /api/v1/admin/integrations — the integration health console backend:
// 9 kinds × (mode, credentials PRESENCE, circuit, telemetry, 24h durable
// stats) + recent failures + recent calls. ADMIN-only; no secrets in output.
import { apiRoute } from '@/server/api/handler'
import { requireRole } from '@/server/api/guards'
import { integrationsOverview } from '@/server/application/services/integrationsService'

export const GET = apiRoute(async () => {
  await requireRole('ADMIN')
  return integrationsOverview()
})
