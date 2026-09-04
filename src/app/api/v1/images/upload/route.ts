import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, audit, parseJSON } from '@/lib/api'
import { getAuth } from '@/lib/auth'
import { storeImage, IMAGE_TYPES } from '@/lib/storage'
import { notify } from '@/lib/notify'
import { rateLimit, rateLimited, LIMITS } from '@/lib/security/rate-limit'

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp']
const MAX_SIZE = 10 * 1024 * 1024

// Magic-byte signatures (PHASE 05, T-UP-01): the declared MIME can lie;
// actual content must be JPEG/PNG/WebP or the file is rejected pre-pipeline.
const MAGIC: Array<{ mime: string; test: (b: Buffer) => boolean }> = [
  { mime: 'image/jpeg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', test: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: 'image/webp', test: (b) => b.length > 12 && b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP' },
]

function sniffMime(buf: Buffer): string | null {
  for (const m of MAGIC) if (m.test(buf)) return m.mime
  return null
}

// POST /api/v1/images/upload (multipart: file, type, caseId?)
// Pipeline: validate MIME/size/corruption → strip metadata → variants (original/compressed/ai/thumb) → quality gate
export async function POST(req: NextRequest) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)

  const form = await req.formData().catch(() => null)
  if (!form) return fail('فرم نامعتبر است')
  const file = form.get('file') as File | null
  const type = String(form.get('type') || 'TONGUE') as (typeof IMAGE_TYPES)[number]
  const caseId = (form.get('caseId') as string) || null
  const caption = (form.get('caption') as string) || null

  if (!file) return fail('فایلی ارسال نشده است')
  if (!IMAGE_TYPES.includes(type)) return fail('نوع تصویر نامعتبر است')
  if (!ALLOWED_MIME.includes(file.type)) return fail('فرمت فایل مجاز نیست (JPG / PNG / WebP)')
  if (file.size > MAX_SIZE) return fail('حجم فایل بیش از ۱۰ مگابایت است')

  // per-user upload rate limit (abuse/flooding guard)
  const rl = rateLimit(`upload:${auth.user.id}`, LIMITS.upload.limit, LIMITS.upload.windowMs)
  if (!rl.allowed) {
    await audit(req, auth.user.id, 'UPLOAD_RATE_LIMITED', 'MedicalImage', null, null, { retryAfter: rl.retryAfterSec })
    return rateLimited(rl)
  }

  const buf = Buffer.from(await file.arrayBuffer())
  if (buf.length === 0) return fail('فایل خالی است')
  const sniffed = sniffMime(buf)
  if (!sniffed) {
    await audit(req, auth.user.id, 'UPLOAD_MAGIC_REJECT', 'MedicalImage', null, null, { declared: file.type })
    return fail('محتوای فایل یک تصویر معتبر نیست', 400)
  }

  // case ownership check
  if (caseId) {
    const c = await db.medicalCase.findUnique({ where: { id: caseId } })
    if (!c) return fail('پرونده یافت نشد', 404)
    if (auth.user.role === 'PATIENT' && c.patientId !== auth.user.id) return fail('دسترسی غیرمجاز', 403)
  } else if (auth.user.role === 'PATIENT' && type === 'TONGUE') {
    // standalone tongue upload is allowed; case creation binds it later
  }

  let stored
  try {
    stored = await storeImage(buf, auth.user.id, type)
  } catch (e) {
    return fail('فایل تصویری خراب است یا قابل پردازش نیست | Corrupted image', 422)
  }

  const qualityOk = stored.quality.score >= 55 && stored.quality.resolutionOk

  const rec = await db.medicalImage.create({
    data: {
      ownerId: auth.user.id, caseId, type,
      status: qualityOk ? 'VALIDATED' : 'REJECTED',
      originalPath: stored.originalPath, compressedPath: stored.compressedPath,
      aiPath: stored.aiPath, thumbPath: stored.thumbPath,
      sha256: stored.sha256, width: stored.width, height: stored.height,
      sizeOriginal: stored.sizeOriginal, sizeCompressed: stored.sizeCompressed,
      mime: file.type, quality: JSON.stringify(stored.quality),
    },
  })

  await notify(auth.user.id, 'IMAGE_RECEIVED', { link: '/records' })
  await audit(req, auth.user.id, 'IMAGE_UPLOAD', 'MedicalImage', rec.id, null, { type, quality: stored.quality.score, bytes: stored.sizeOriginal })

  return ok({
    image: {
      id: rec.id, type, status: rec.status, quality: stored.quality,
      width: stored.width, height: stored.height,
      sizeOriginal: stored.sizeOriginal, sizeCompressed: stored.sizeCompressed,
      compressionRatio: +(stored.sizeCompressed / Math.max(1, stored.sizeOriginal)).toFixed(2),
      sha256: stored.sha256.slice(0, 16), createdAt: rec.createdAt,
    },
    qualityOk,
    message: qualityOk
      ? 'تصویر با موفقیت اعتبارسنجی و پردازش شد'
      : 'کیفیت تصویر کافی نیست؛ لطفاً مجدداً تصویر واضح‌تری ارسال کنید',
    issues: stored.quality.issues,
  })
}
