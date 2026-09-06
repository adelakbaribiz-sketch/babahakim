// API layer (thin controller) — business logic in @/server/application (ED-93).
// PHASE 17 chaos console (ED-187).
// GET  /api/v1/admin/chaos — armed faults + chaos-mode status
// POST /api/v1/admin/chaos — { action, fault?, type?, payload?, ttlMs? }
//
// Double-guarded failure injection (audit REL1):
//   1. env gate  — BH_CHAOS=1 or a test runner; otherwise this route 404s
//      (invisible in production — chaosEnabled() is checked by the faults
//      module AND here, so the route can never arm anything in prod)
//   2. auth gate — ADMIN session + CSRF (middleware) + audited every call
import { apiRoute, parseBody } from '@/server/api/handler'
import { requireRole } from '@/server/api/guards'
import { z } from 'zod'
import { getChaosStatus, runChaosAction, chaosModeOn, chaosNotFound } from '@/server/application/services/chaosService'

export const GET = apiRoute(async () => {
  if (!chaosModeOn()) chaosNotFound() // invisible outside test/drill
  await requireRole('ADMIN')
  return getChaosStatus()
})

const ChaosSchema = z.object({
  action: z.enum(['activate', 'deactivate', 'clear', 'inject-job', 'inject-stale-running', 'recover']),
  fault: z.string().max(32).optional(),
  type: z.string().max(64).optional(),
  payload: z.unknown().optional(),
  /** time-boxed blast radius: the fault self-clears after this many ms */
  ttlMs: z.number().int().min(500).max(120_000).optional(),
})

export const POST = apiRoute(async (req, _route, env) => {
  if (!chaosModeOn()) chaosNotFound()
  const auth = await requireRole('ADMIN')
  const input = await parseBody(req, ChaosSchema)
  return runChaosAction(input, env.ctx, auth.user.id)
})
