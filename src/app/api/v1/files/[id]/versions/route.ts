// API layer (thin controller) — business logic in @/server/application (ED-93).
// GET  /api/v1/files/[id]/versions — immutable version history
// POST /api/v1/files/[id]/versions — append a new version (202, async)
import { z } from 'zod'
import { apiRoute } from '@/server/api/handler'
import { requireAuth } from '@/server/api/guards'
import { listVersions, addVersion } from '@/server/application/services/mediaFileService'
import { ValidationError } from '@/server/core/errors'

type P = { id: string }

const versionFormSchema = z.object({
  fileName: z.string().max(255).nullable().optional(),
})

export const GET = apiRoute<P>(async (_req, route, env) => {
  const auth = await requireAuth()
  const { id } = await route.params
  return listVersions(auth, env.ctx, id)
})

export const POST = apiRoute<P>(async (req, route, env) => {
  const auth = await requireAuth()
  const { id } = await route.params
  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) throw new ValidationError('فایلی ارسال نشده است')
  const parsed = versionFormSchema.parse({ fileName: file.name || null })
  return addVersion(auth, env.ctx, id, {
    file,
    declaredMime: file.type || 'application/octet-stream',
    fileName: parsed.fileName ?? null,
  })
})
