// API layer (thin controller) — business logic in @/server/application (ED-93).
// POST /api/v1/admin/media/lifecycle — run one retention pass now (ops
// trigger; the recurring job also runs it every 5 minutes). ?force=1 skips
// the trash retention window (emergency purge — audited).
import { z } from 'zod'
import { apiRoute, parseBody } from '@/server/api/handler'
import { requireRole } from '@/server/api/guards'
import { lifecycleTick } from '@/server/application/services/mediaFileService'

const triggerSchema = z.object({ force: z.boolean().default(false) })

export const POST = apiRoute(async (req, _route, env) => {
  const auth = await requireRole('ADMIN')
  const input = await parseBody(req, triggerSchema) // bodyless ops trigger; force also via ?force=1
  const force = input.force || new URL(req.url).searchParams.get('force') === '1'
  return lifecycleTick(auth, env.ctx, { force })
})
