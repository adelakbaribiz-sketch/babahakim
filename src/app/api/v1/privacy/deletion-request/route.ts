// API layer (thin controller) — business logic in @/server/application (ED-93).
import { z } from 'zod'
import { apiRoute, parseBody } from '@/server/api/handler'
import { requireAuth } from '@/server/api/guards'
import { getDeletionRequest, createDeletionRequestFor } from '@/server/application/services/imageService'

const deletionSchema = z.object({ reason: z.string().max(500).optional().nullable() })

// GET /api/v1/privacy/deletion-request — my current deletion request status
export const GET = apiRoute(async () => {
  const auth = await requireAuth()
  return getDeletionRequest(auth.user.id)
})

// POST /api/v1/privacy/deletion-request {reason?} — erasure via anonymization (ED-69)
export const POST = apiRoute(async (req, _route, env) => {
  const auth = await requireAuth()
  const input = await parseBody(req, deletionSchema)
  return createDeletionRequestFor(auth, env.ctx, input.reason || null)
})
