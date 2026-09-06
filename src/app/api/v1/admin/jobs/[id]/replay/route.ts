// API layer (thin controller) — business logic in @/server/application (ED-93).
// POST /api/v1/admin/jobs/[id]/replay — reset a DEAD job to PENDING (audited).
// The DLQ runbook: inspect → fix root cause → replay → watch it complete.
import { z } from 'zod'
import { apiRoute, parseBody } from '@/server/api/handler'
import { requireRole } from '@/server/api/guards'
import { replayJob } from '@/server/application/services/jobsService'

type P = { id: string }

// no meaningful body — parsed for the mutating-route zod contract (E5)
const ReplaySchema = z.object({}).passthrough()

export const POST = apiRoute<P>(async (req, route, env) => {
  const auth = await requireRole('ADMIN')
  const { id } = await route.params
  await parseBody(req, ReplaySchema)
  return replayJob(id, env.ctx, auth.user.id)
})
