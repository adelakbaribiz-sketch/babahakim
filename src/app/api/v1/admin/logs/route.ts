// API layer (thin controller) — business logic in @/server/application (ED-93).
// GET /api/v1/admin/logs — search ServiceLog (warn/error durable store) with
// bounded pagination + Persian-normalized free text (ED-166/180).
// ?q=&lvl=&svc=&route=&reqId=&corrId=&page=&limit=&live=1 (ring tail)
import { apiRoute } from '@/server/api/handler'
import { requireRole } from '@/server/api/guards'
import { searchServiceLogs, liveLogTail } from '@/server/application/services/observabilityService'

export const GET = apiRoute(async (req) => {
  await requireRole('ADMIN')
  const url = new URL(req.url)
  if (url.searchParams.get('live') === '1') return liveLogTail(Number(url.searchParams.get('n') ?? 50))
  return searchServiceLogs({
    q: url.searchParams.get('q') ?? undefined,
    lvl: url.searchParams.get('lvl') ?? undefined,
    svc: url.searchParams.get('svc') ?? undefined,
    route: url.searchParams.get('route') ?? undefined,
    reqId: url.searchParams.get('reqId') ?? undefined,
    corrId: url.searchParams.get('corrId') ?? undefined,
    page: Number(url.searchParams.get('page') ?? 1),
    limit: Number(url.searchParams.get('limit') ?? 20),
  })
})
