// API layer (thin controller) — business logic in @/server/application (ED-93).
// POST /api/v1/files — multipart upload → 202 Accepted (async processing, ED-114)
// GET  /api/v1/files — list (owner-scoped; staff sees all) with ED-100 contract
import { z } from 'zod'
import { apiRoute } from '@/server/api/handler'
import { requireAuth } from '@/server/api/guards'
import { parseListQuery } from '@/server/api/query'
import { uploadFile, listFiles } from '@/server/application/services/mediaFileService'
import { ValidationError } from '@/server/core/errors'

const uploadFormSchema = z.object({
  category: z.string().min(1).max(40),
  type: z.string().min(1).max(40),
  fileName: z.string().max(255).nullable().optional(),
  caseId: z.string().max(64).nullable().optional(),
  accessClass: z.enum(['PUBLIC', 'PRIVATE', 'TEMPORARY']).nullable().optional(),
  ttlSec: z.coerce.number().int().min(1).max(86_400).nullable().optional(),
})

function multipartField(form: FormData, key: string): string | null {
  const v = form.get(key)
  return typeof v === 'string' && v !== '' ? v : null
}

export const POST = apiRoute(async (req, _route, env) => {
  const auth = await requireAuth()
  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) throw new ValidationError('فایلی ارسال نشده است')
  const parsed = uploadFormSchema.parse({
    category: multipartField(form, 'category') || '',
    type: multipartField(form, 'type') || '',
    fileName: file.name || null,
    caseId: multipartField(form, 'caseId'),
    accessClass: multipartField(form, 'accessClass'),
    ttlSec: multipartField(form, 'ttlSec'),
  })
  return uploadFile(auth, env.ctx, { file, ...parsed, declaredMime: file.type || 'application/octet-stream' })
})

export const GET = apiRoute(async (req, _route, env) => {
  const auth = await requireAuth()
  const query = parseListQuery(req.url, { defaultLimit: 20, maxLimit: 100, sortable: ['createdAt', 'updatedAt', 'sizeBytes'] })
  return listFiles(auth, env.ctx, query)
})
