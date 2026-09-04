// API layer (thin controller) — business logic in @/server/application (ED-93).
// POST /api/v1/images/upload — multipart (file, type, caseId?, caption?).
// REBUILT in PHASE 12: this route existed through PHASE 08–11 but was never
// committed to git and vanished from the workspace (same failure mode as
// register/route.ts in phase 00 — recorded as an engineering decision).
// Returns 202 Accepted: heavy validation/rendering runs in the media worker
// (ED-114); clients poll GET /api/v1/images/[id].
import { z } from 'zod'
import { apiRoute } from '@/server/api/handler'
import { requireAuth } from '@/server/api/guards'
import { ValidationError } from '@/server/core/errors'
import { uploadImage } from '@/server/application/services/imageService'

// multipart fields validated with zod at the boundary (E5) — the file blob
// itself is validated by the media engine (magic bytes, size, type policy)
const formFieldsSchema = z.object({
  type: z.string().min(1, 'نوع تصویر الزامی است | type is required'),
  caseId: z.string().min(1).optional().nullable(),
  caption: z.string().max(500).optional().nullable(),
})

export const POST = apiRoute(async (req, _route, env) => {
  const auth = await requireAuth()

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    throw new ValidationError('بدنه درخواست باید multipart/form-data باشد | multipart body required')
  }

  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) {
    throw new ValidationError('فایل تصویر الزامی است | file is required')
  }

  const raw = {
    type: String(form.get('type') || ''),
    caseId: form.get('caseId') != null && String(form.get('caseId')).length > 0 ? String(form.get('caseId')) : null,
    caption: form.get('caption') != null && String(form.get('caption')).length > 0 ? String(form.get('caption')) : null,
  }
  const parsed = formFieldsSchema.safeParse(raw)
  if (!parsed.success) {
    throw new ValidationError('داده‌های ارسالی معتبر نیست', {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code })),
    })
  }

  return uploadImage(auth, env.ctx, {
    file,
    type: parsed.data.type,
    caseId: parsed.data.caseId ?? null,
    caption: parsed.data.caption ?? null,
  })
})
