// API layer (thin controller) — business logic in @/server/application (ED-93).
// GET /api/v1/admin/reports?from=&to= — LEGACY adapter (PHASE 14, ED-159).
// The v1 response shape is preserved for the SPA + pentest contract, but the
// implementation is bounded + SQL-side (see reportingService.legacyAdminReports).
// The rich permission-aware center lives at GET /api/v1/reports*.
import { apiRoute } from '@/server/api/handler'
import { requireRole } from '@/server/api/guards'
import { legacyAdminReports } from '@/server/application/services/reportingService'

export const GET = apiRoute(async (req) => {
  const auth = await requireRole('ADMIN', 'OPERATOR', 'EXPERT_2')
  const url = new URL(req.url)
  return legacyAdminReports(auth, url.searchParams.get('from'), url.searchParams.get('to'))
})
