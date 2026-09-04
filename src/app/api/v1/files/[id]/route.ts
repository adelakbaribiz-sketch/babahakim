// API layer (thin controller) — business logic in @/server/application (ED-93).
// GET    /api/v1/files/[id] — status + metadata (poll endpoint for 202 uploads)
// PATCH  /api/v1/files/[id] — access class / archive (staff+owner)
// DELETE /api/v1/files/[id] — soft delete → trash retention → purge
import { z } from 'zod'
import { apiRoute, parseBody } from '@/server/api/handler'
import { requireAuth } from '@/server/api/guards'
import { getFileStatus, patchFile, deleteFile } from '@/server/application/services/mediaFileService'

type P = { id: string }

const patchBodySchema = z.object({
  accessClass: z.enum(['PUBLIC', 'PRIVATE', 'TEMPORARY']).optional(),
  archive: z.boolean().optional(),
  ttlSec: z.coerce.number().int().min(60).max(86_400).optional(),
})

export const GET = apiRoute<P>(async (_req, route, env) => {
  const auth = await requireAuth()
  const { id } = await route.params
  return getFileStatus(auth, env.ctx, id)
})

export const PATCH = apiRoute<P>(async (req, route, env) => {
  const auth = await requireAuth()
  const { id } = await route.params
  const body = await parseBody(req, patchBodySchema)
  return patchFile(auth, env.ctx, id, body)
})

export const DELETE = apiRoute<P>(async (_req, route, env) => {
  const auth = await requireAuth()
  const { id } = await route.params
  return deleteFile(auth, env.ctx, id)
})
