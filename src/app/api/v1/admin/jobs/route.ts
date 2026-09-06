// API layer (thin controller) — business logic in @/server/application (ED-93).
// GET /api/v1/admin/jobs — durable queue + DLQ listing (?status=&type=&page=&limit=).
// PHASE 17 (ED-190): the dead-letter queue becomes visible and operable.
import { apiRoute } from '@/server/api/handler'
import { requireRole } from '@/server/api/guards'
import { listJobs } from '@/server/application/services/jobsService'

export const GET = apiRoute(async (req) => {
  await requireRole('ADMIN')
  const url = new URL(req.url)
  return listJobs({
    status: url.searchParams.get('status') ?? undefined,
    type: url.searchParams.get('type') ?? undefined,
    page: Number(url.searchParams.get('page') ?? 1) || 1,
    limit: Number(url.searchParams.get('limit') ?? 20) || 20,
  })
})
