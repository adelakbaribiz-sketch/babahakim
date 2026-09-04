// ── BabaHakim Backend · Application Service: Images + Privacy (PHASE 08) ──
// Upload pipeline (magic-byte sniff, quality gate) + medical-file access
// control (ED-66) + privacy rights (Phase-05 ports, thin wrappers).
import { db } from '@/lib/db'
import type { AuthContext } from '@/lib/auth'
import { getAuth, verifyImageSig } from '@/lib/auth'
import { readStored, fileExists, storeImage, IMAGE_TYPES } from '@/lib/storage'
import { rateLimit, LIMITS } from '@/lib/security/rate-limit'
import {
  currentConsents, recordConsent, CONSENT_TYPES, CONSENT_DOC_VERSIONS, revokeConsent,
  REVOCABLE, buildExportBundle, createDeletionRequest,
} from '@/lib/security/privacy'
import type { ConsentType } from '@/lib/security/privacy'
import { NextResponse } from 'next/server'
import { AppError, NotFoundError, ForbiddenError, RateLimitError, ValidationError } from '@/server/core/errors'
import { writeAudit } from '@/server/infrastructure/audit'
import { publish, Events } from '@/server/infrastructure/events'
import { withTransaction } from '@/server/infrastructure/uow'
import type { RequestContext } from '@/server/core/context'
import { notify } from '@/lib/notify'

// ════════════════════════════ UPLOAD ═══════════════════════════════════════

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp']
const MAX_SIZE = 10 * 1024 * 1024

const MAGIC: Array<{ mime: string; test: (b: Buffer) => boolean }> = [
  { mime: 'image/jpeg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', test: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: 'image/webp', test: (b) => b.length > 12 && b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP' },
]
function sniffMime(buf: Buffer): string | null {
  for (const m of MAGIC) if (m.test(buf)) return m.mime
  return null
}

export async function uploadImage(
  auth: AuthContext, ctx: RequestContext,
  input: { file: File; type: string; caseId?: string | null; caption?: string | null },
) {
  const { file, type } = input
  if (!IMAGE_TYPES.includes(type as (typeof IMAGE_TYPES)[number])) throw new ValidationError('نوع تصویر نامعتبر است')
  if (!ALLOWED_MIME.includes(file.type)) throw new ValidationError('فرمت فایل مجاز نیست (JPG / PNG / WebP)')
  if (file.size > MAX_SIZE) throw new ValidationError('حجم فایل بیش از ۱۰ مگابایت است')

  const rl = rateLimit(`upload:${auth.user.id}`, LIMITS.upload.limit, LIMITS.upload.windowMs)
  if (!rl.allowed) {
    await writeAudit(ctx, { userId: auth.user.id, action: 'UPLOAD_RATE_LIMITED', entity: 'MedicalImage', newValues: { retryAfter: rl.retryAfterSec } })
    throw new RateLimitError(undefined, { retryAfterSec: rl.retryAfterSec })
  }

  const buf = Buffer.from(await file.arrayBuffer())
  if (buf.length === 0) throw new ValidationError('فایل خالی است')
  const sniffed = sniffMime(buf)
  if (!sniffed) {
    await writeAudit(ctx, { userId: auth.user.id, action: 'UPLOAD_MAGIC_REJECT', entity: 'MedicalImage', newValues: { declared: file.type } })
    throw new ValidationError('محتوای فایل یک تصویر معتبر نیست')
  }

  if (input.caseId) {
    const c = await db.medicalCase.findUnique({ where: { id: input.caseId } })
    if (!c) throw new NotFoundError('پرونده یافت نشد')
    if (auth.user.role === 'PATIENT' && c.patientId !== auth.user.id) throw new ForbiddenError('دسترسی غیرمجاز')
  }

  let stored
  try {
    stored = await storeImage(buf, auth.user.id, type as (typeof IMAGE_TYPES)[number])
  } catch {
    throw new AppError('BUSINESS_RULE', 'فایل تصویری خراب است یا قابل پردازش نیست | Corrupted image', 422)
  }

  const qualityOk = stored.quality.score >= 55 && stored.quality.resolutionOk

  const rec = await withTransaction(async (tx) =>
    tx.medicalImage.create({
      data: {
        ownerId: auth.user.id, caseId: input.caseId || null, type,
        status: qualityOk ? 'VALIDATED' : 'REJECTED',
        originalPath: stored.originalPath, compressedPath: stored.compressedPath,
        aiPath: stored.aiPath, thumbPath: stored.thumbPath,
        sha256: stored.sha256, width: stored.width, height: stored.height,
        sizeOriginal: stored.sizeOriginal, sizeCompressed: stored.sizeCompressed,
        mime: file.type, quality: JSON.stringify(stored.quality),
      },
    }),
  )

  await publish(Events.ImageUploaded, { userId: auth.user.id, imageId: rec.id }, ctx.reqId)
  await writeAudit(ctx, {
    userId: auth.user.id, action: 'IMAGE_UPLOAD', entity: 'MedicalImage', entityId: rec.id,
    newValues: { type, quality: stored.quality.score, bytes: stored.sizeOriginal },
  })

  return {
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
  }
}

// ════════════════════════════ FILE ACCESS (ED-66) ══════════════════════════

export async function serveImageFile(
  ctx: RequestContext, id: string, variant: string, exp: string, sig: string,
): Promise<NextResponse> {
  if (!/^[a-zA-Z0-9]{10,40}$/.test(id)) throw new ValidationError('شناسه تصویر نامعتبر است')

  const image = await db.medicalImage.findUnique({ where: { id } })
  if (!image) throw new NotFoundError('تصویر یافت نشد')

  let authorized = false
  let viewerId: string | null = null
  if (exp && sig) {
    authorized = verifyImageSig(id, exp, sig)
  } else {
    const auth = await getAuth()
    if (auth) {
      viewerId = auth.user.id
      if (auth.user.role === 'PATIENT') {
        authorized = image.ownerId === auth.user.id || (image.caseId != null && (await isOwnCase(auth.user.id, image.caseId)))
      } else {
        authorized = auth.user.role === 'ADMIN' || auth.permissions.includes('view_images') || auth.permissions.includes('view_medical_files')
      }
    }
  }
  if (!authorized) {
    if (viewerId) await writeAudit(ctx, { userId: viewerId, action: 'MEDICAL_FILE_ACCESS_DENIED', entity: 'MedicalImage', entityId: id })
    throw new ForbiddenError('دسترسی به تصویر پزشکی غیرمجاز است')
  }

  if (exp && sig) {
    await writeAudit(ctx, { userId: viewerId, action: 'DOWNLOAD_IMAGE', entity: 'MedicalImage', entityId: id, newValues: { variant, via: 'SIGNED_URL' } })
  } else if (viewerId && viewerId !== image.ownerId) {
    await writeAudit(ctx, { userId: viewerId, action: 'VIEW_MEDICAL_FILE', entity: 'MedicalImage', entityId: id, newValues: { variant } })
  }

  const path = variant === 'thumb' ? image.thumbPath : variant === 'ai' ? image.aiPath : variant === 'original' ? image.originalPath : image.compressedPath
  if (!path || !(await fileExists(path))) throw new NotFoundError('فایل یافت نشد')
  const buf = await readStored(path)
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'private, max-age=60, no-store-when-shared',
      'Content-Length': String(buf.length),
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

async function isOwnCase(userId: string, caseId: string) {
  const c = await db.medicalCase.findUnique({ where: { id: caseId }, select: { patientId: true } })
  return c?.patientId === userId
}

// ════════════════════════════ PRIVACY ══════════════════════════════════════

export async function listConsents(userId: string) {
  const state = await currentConsents(userId)
  return { consents: state, documentVersions: CONSENT_DOC_VERSIONS }
}

export async function grantConsent(auth: AuthContext, ctx: RequestContext, consentType: string) {
  if (!CONSENT_TYPES.includes(consentType as ConsentType)) throw new AppError('BUSINESS_RULE', 'نوع رضایت نامعتبر است', 422)
  await recordConsent(auth.user.id, consentType as ConsentType, ctx.ip, ctx.device)
  await writeAudit(ctx, { userId: auth.user.id, action: 'CONSENT_GRANTED', entity: 'ConsentRecord', entityId: auth.user.id, newValues: { consentType } })
  return { consentType, granted: true }
}

export async function revokeConsentFor(auth: AuthContext, ctx: RequestContext, consentType: string) {
  if (!REVOCABLE.includes(consentType as ConsentType)) {
    throw new AppError('CONFLICT', 'این رضایت به دلیل فعال بودن خدمات قابل لغو نیست؛ برای حذف کامل داده درخواست حذف ثبت کنید', 409)
  }
  const done = await revokeConsent(auth.user.id, consentType as ConsentType)
  if (!done) throw new NotFoundError('رضایت فعالی برای لغو یافت نشد')
  await writeAudit(ctx, { userId: auth.user.id, action: 'CONSENT_REVOKED', entity: 'ConsentRecord', entityId: auth.user.id, newValues: { consentType } })
  return { consentType, granted: false }
}

export async function exportData(auth: AuthContext, ctx: RequestContext) {
  const rl = rateLimit(`export:${auth.user.id}`, LIMITS.export.limit, LIMITS.export.windowMs)
  if (!rl.allowed) {
    await writeAudit(ctx, { userId: auth.user.id, action: 'EXPORT_RATE_LIMITED', entity: 'User', entityId: auth.user.id })
    throw new RateLimitError('خروجی داده روزانه یک‌بار مجاز است', { retryAfterSec: rl.retryAfterSec })
  }
  const bundle = await buildExportBundle(auth.user.id)
  await writeAudit(ctx, { userId: auth.user.id, action: 'DATA_EXPORT', entity: 'User', entityId: auth.user.id, newValues: { sections: Object.keys(bundle) } })
  return new NextResponse(JSON.stringify({ ...bundle, generatedAt: new Date().toISOString() }, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="babahakim-data-export-${Date.now()}.json"`,
      'Cache-Control': 'no-store',
    },
  })
}

export async function getDeletionRequest(userId: string) {
  const rec = await db.deletionRequest.findUnique({ where: { userId } })
  return { request: rec ? { status: rec.status, requestedAt: rec.requestedAt, processedAt: rec.processedAt, note: rec.note } : null }
}

export async function createDeletionRequestFor(auth: AuthContext, ctx: RequestContext, reason: string | null) {
  const res = await createDeletionRequest(auth.user.id, reason)
  if (!res.ok || !res.rec) throw new AppError('CONFLICT', 'درخواست حذف در جریان است', 409)
  await writeAudit(ctx, { userId: auth.user.id, action: 'DELETION_REQUESTED', entity: 'DeletionRequest', entityId: res.rec.id, newValues: { reason: reason ? 'provided' : 'none' } })
  return { request: { id: res.rec.id, status: res.rec.status, requestedAt: res.rec.requestedAt } }
}

export { notify }
