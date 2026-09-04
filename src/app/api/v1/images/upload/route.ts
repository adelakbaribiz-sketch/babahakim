// API layer (thin controller) — business logic in @/server/application (ED-93).
import { apiRoute } from '@/server/api/handler'
import { requireAuth } from '@/server/api/guards'
import { z } from 'zod'
import { ValidationError } from '@/server/core/errors'
import { IMAGE_TYPE } from '@/server/api/schemas'
import { uploadImage } from '@/server/application/services/imageService'

const uploadFormSchema = z.object({
  type: IMAGE_TYPE.default('TONGUE'),
  caseId: z.string().max(64).optional().nullable(),
  caption: z.string().max(500).optional().nullable(),
})

// POST /api/v1/images/upload (multipart: file, type, caseId?, caption?)
// Pipeline: MIME/size/magic-byte validation → variants → quality gate (service)
export const POST = apiRoute(async (req, _route, env) => {
  const auth = await requireAuth()
  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) throw new ValidationError('فایلی ارسال نشده است')
  const parsed = uploadFormSchema.parse({
    type: String(form.get('type') || 'TONGUE'),
    caseId: (form.get('caseId') as string) || null,
    caption: (form.get('caption') as string) || null,
  })
  return uploadImage(auth, env.ctx, { file, ...parsed })
})
