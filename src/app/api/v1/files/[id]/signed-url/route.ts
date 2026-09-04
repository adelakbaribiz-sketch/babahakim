// API layer (thin controller) — business logic in @/server/application (ED-93).
// POST /api/v1/files/[id]/signed-url — mint a short-lived rendition URL.
// Body: { variant?, version?, ttlSec?, download? }
import { apiRoute, parseBody } from '@/server/api/handler'
import { requireAuth } from '@/server/api/guards'
import { mintSignedUrl } from '@/server/application/services/mediaFileService'
import { z } from 'zod'

type P = { id: string }

const bodySchema = z.object({
  variant: z.enum(['original', 'compressed', 'ai', 'thumb']).default('compressed'),
  version: z.coerce.number().int().min(1).optional(),
  ttlSec: z.coerce.number().int().min(1).max(3600).optional(),
  download: z.boolean().default(false),
})

export const POST = apiRoute<P>(async (req, route, env) => {
  const auth = await requireAuth()
  const { id } = await route.params
  const body = await parseBody(req, bodySchema)
  return mintSignedUrl(auth, env.ctx, id, body)
})
