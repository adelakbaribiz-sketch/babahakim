import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, audit, parseJSON } from '@/lib/api'
import { getAuth } from '@/lib/auth'
import { storeImage, IMAGE_TYPES } from '@/lib/storage'
import { notify } from '@/lib/notify'

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp']
const MAX_SIZE = 10 * 1024 * 1024

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

  const buf = Buffer.from(await file.arrayBuffer())
  if (buf.length === 0) return fail('فایل خالی است')

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
