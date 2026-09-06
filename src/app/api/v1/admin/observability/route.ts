// API layer (thin controller) — business logic in @/server/application (ED-93).
// GET /api/v1/admin/observability — full observability snapshot for the
// ADMIN console: health, system (CPU/mem/disk/loop), queue, db, metrics,
// time-series, integration summary, alerts, log tail (ED-180).
import { apiRoute } from '@/server/api/handler'
import { requireRole } from '@/server/api/guards'
import { observabilitySnapshot } from '@/server/application/services/observabilityService'

export const GET = apiRoute(async () => {
  await requireRole('ADMIN')
  return observabilitySnapshot()
})
