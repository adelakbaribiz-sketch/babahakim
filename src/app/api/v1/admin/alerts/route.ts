// API layer (thin controller) — business logic in @/server/application (ED-93).
// GET /api/v1/admin/alerts — alert lifecycle list (?status=OPEN|RESOLVED).
// POST /api/v1/admin/alerts — manual resolve { id } (audited, ED-180).
import { apiRoute, parseBody } from '@/server/api/handler'
import { requireRole } from '@/server/api/guards'
import { z } from 'zod'
import { listAlerts, resolveAlertAction } from '@/server/application/services/observabilityService'

export const GET = apiRoute(async (req) => {
  await requireRole('ADMIN')
  const url = new URL(req.url)
  return listAlerts({
    status: url.searchParams.get('status') ?? undefined,
    page: Number(url.searchParams.get('page') ?? 1),
    limit: Number(url.searchParams.get('limit') ?? 20),
  })
})

const ResolveSchema = z.object({ id: z.string().min(10).max(40) })

export const POST = apiRoute(async (req, _route, env) => {
  const auth = await requireRole('ADMIN')
  const { id } = await parseBody(req, ResolveSchema)
  return resolveAlertAction(id, env.ctx, auth.user.id)
})
