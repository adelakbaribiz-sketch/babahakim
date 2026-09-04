// ── BabaHakim Backend · Application Service: Images + Privacy (PHASE 08/10) ──
// The /api/v1/images/* surface is a thin bridge onto the PHASE-10 media
// engine: uploads return 202 and processing happens in the worker; serving
// resolves renditions from the engine when storedFileId is set (new rows)
// and from legacy flat paths otherwise (pre-PHASE-10 rows).
// Medical-file access control keeps the Phase-05 hardened model (ED-66).
import { db } from '@/lib/db'
import type { AuthContext } from '@/lib/auth'
import { getAuth, verifyImageSig } from '@/lib/auth'
import { IMAGE_TYPES } from '@/lib/storage'
import { rateLimit, LIMITS } from '@/lib/security/rate-limit'
import {
  currentConsents, recordConsent, CONSENT_TYPES, CONSENT_DOC_VERSIONS, revokeConsent,
  REVOCABLE, buildExportBundle, createDeletionRequest,
} from '@/lib/security/privacy'
import type { ConsentType } from '@/lib/security/privacy'
import { NextResponse } from 'next/server'
import { join } from 'path'
import {
  AppError, NotFoundError, ForbiddenError, RateLimitError, ValidationError,
  PayloadTooLargeError, UnsupportedMediaTypeError,
} from '@/server/core/errors'
import { writeAudit } from '@/server/infrastructure/audit'
import { withTransaction } from '@/server/infrastructure/uow'
import type { RequestContext } from '@/server/core/context'
import { acceptUpload, MediaValidationError, sanitizeFileName } from '@/server/infrastructure/media/pipeline'
import { getStorageDriver, STORAGE_ROOT } from '@/server/infrastructure/media/storage-driver'
import { fileExists, readStored } from '@/lib/storage'

// ══════════════════════════ UPLOAD (async, ED-114) ═════════════════════════

export async function uploadImage(
  auth: AuthContext, ctx: RequestContext,
  input: { file: File; type: string; caseId?: string | null; caption?: string | null },
) {
  const { file, type } = input
  if (!IMAGE_TYPES.includes(type as (typeof IMAGE_TYPES)[number])) throw new ValidationError('نوع تصویر نامعتبر است')

  const rl = rateLimit(`upload:${auth.user.id}`, LIMITS.upload.limit, LIMITS.upload.windowMs)
  if (!rl.allowed) {
    await writeAudit(ctx, { userId: auth.user.id, action: 'UPLOAD_RATE_LIMITED', entity: 'MedicalImage', newValues: { retryAfter: rl.retryAfterSec } })
    throw new RateLimitError(undefined, { retryAfterSec: rl.retryAfterSec })
  }

  if (input.caseId) {
    const c = await db.medicalCase.findUnique({ where: { id: input.caseId } })
    if (!c) throw new NotFoundError('پرونده یافت نشد')
    if (auth.user.role === 'PATIENT' && c.patientId !== auth.user.id) throw new ForbiddenError('دسترسی غیرمجاز')
  }

  const buf = Buffer.from(await file.arrayBuffer())

  let accepted
  try {
    accepted = await acceptUpload({
      ownerId: auth.user.id,
      role: auth.user.role,
      category: 'MEDICAL_IMAGE',
      type,
      declaredMime: file.type,
      fileName: sanitizeFileName(file.name),
      buf,
      caseId: input.caseId || null,
      accessClassOverride: 'PRIVATE',
    })
  } catch (e) {
    if (e instanceof MediaValidationError) {
      if (e.kind === 'SIZE') throw new PayloadTooLargeError(e.message, e.details as { limitBytes: number; actualBytes: number } | undefined)
      if (e.kind === 'MIME' || e.kind === 'MAGIC') throw new UnsupportedMediaTypeError(e.message, e.details as { allowed: string[]; declared?: string } | undefined)
      throw new ValidationError(e.message, e.details)
    }
    throw e
  }

  // clinical row: the workflow keeps reading MedicalImage; the engine owns bytes
  const rec = await withTransaction(async (tx) =>
    tx.medicalImage.create({
      data: {
        ownerId: auth.user.id, caseId: input.caseId || null, type,
        status: 'PENDING', // set to VALIDATED/REJECTED by the worker bridge
        storedFileId: accepted.fileId,
        originalPath: join(STORAGE_ROOT, `inbox/pending-${accepted.fileId}`),
        sha256: '', width: null, height: null,
        sizeOriginal: buf.length, sizeCompressed: null,
        mime: file.type,
      },
    }),
  )

  await writeAudit(ctx, {
    userId: auth.user.id, action: 'IMAGE_UPLOAD', entity: 'MedicalImage', entityId: rec.id,
    newValues: { type, bytes: buf.length, storedFileId: accepted.fileId, async: true },
  })

  // 202 Accepted — the media-process worker scans + renders + gates quality
  return NextResponse.json({
    image: {
      id: rec.id, type, status: 'PENDING',
      storedFileId: accepted.fileId, version: accepted.version,
      sizeOriginal: buf.length, createdAt: rec.createdAt,
    },
    statusUrl: `/api/v1/images/${rec.id}`,
    qualityOk: null, // available once processing completes (poll statusUrl)
    message: 'تصویر دریافت شد و در صف اعتبارسنجی و پردازش است',
    issues: [] as string[],
  }, { status: 202 })
}

// ══════════════════════════ STATUS (poll) ══════════════════════════════════

export async function getImageStatus(auth: AuthContext, ctx: RequestContext, id: string) {
  const image = await db.medicalImage.findUnique({ where: { id } })
  if (!image) throw new NotFoundError('تصویر یافت نشد')
  if (auth.user.role === 'PATIENT' && image.ownerId !== auth.user.id) throw new ForbiddenError('دسترسی غیرمجاز')
  const quality = image.quality ? safeParse(image.quality) : null
  const q = quality as { score?: number; blur?: number; brightness?: number; exposure?: string; resolution?: string; issues?: string[] } | null
  return {
    image: {
      id: image.id, status: image.status, type: image.type, caseId: image.caseId,
      storedFileId: image.storedFileId, rejectionReason: image.rejectionReason,
      width: image.width, height: image.height,
      sizeOriginal: image.sizeOriginal, sizeCompressed: image.sizeCompressed,
      sha256: image.sha256 ? image.sha256.slice(0, 16) : null,
      createdAt: image.createdAt,
    },
    quality: q ? { score: q.score ?? 0, blur: q.blur ?? 0, brightness: q.brightness ?? 0, exposure: q.exposure ?? 'NORMAL', resolution: q.resolution ?? '', issues: q.issues ?? [] } : null,
    qualityOk: image.status === 'VALIDATED',
    message: image.status === 'VALIDATED'
      ? 'تصویر با موفقیت اعتبارسنجی و پردازش شد'
      : image.status === 'REJECTED'
        ? 'کیفیت تصویر کافی نیست؛ لطفاً مجدداً تصویر واضح‌تری ارسال کنید'
        : 'در حال پردازش',
    issues: (q?.issues ?? []) as string[],
  }
}

// ══════════════════════════ FILE ACCESS (ED-66) ════════════════════════════

export async function serveImageFile(
  ctx: RequestContext, id: string, variant: string, exp: string, sig: string,
): Promise<NextResponse> {
  if (!/^[a-zA-Z0-9]{10,40}$/.test(id)) throw new ValidationError('شناسه تصویر نامعتبر است')

  const image = await db.medicalImage.findUnique({ where: { id } })
  if (!image) throw new NotFoundError('تصویر یافت نشد')

  let authorized = false
  let viewerId: string | null = null
  if (exp && sig) {
    // legacy v1 signature covers (imageId, exp) — variant NOT bound; the new
    // engine signs variant+version (ED-112). Bridge rows keep legacy verify.
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

  // engine-backed rows: resolve the rendition from the media engine
  if (image.storedFileId) {
    const rendition = await resolveEngineRendition(image.storedFileId, variant)
    if (!rendition) throw new NotFoundError('نسخه پردازش‌شده تصویر یافت نشد (در حال پردازش)')
    return new NextResponse(new Uint8Array(rendition.data), {
      headers: {
        'Content-Type': rendition.mime,
        'Cache-Control': 'private, max-age=60',
        'Content-Length': String(rendition.data.length),
        'Content-Disposition': 'inline',
        'X-Content-Type-Options': 'nosniff',
        ETag: `"${image.sha256 || image.storedFileId}-${variant}"`,
      },
    })
  }

  // legacy flat rows (pre-PHASE-10)
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

async function resolveEngineRendition(
  storedFileId: string, variant: string,
): Promise<{ data: Buffer; mime: string } | null> {
  const file = await db.storedFile.findUnique({ where: { id: storedFileId } })
  if (!file) return null
  if (file.status === 'INFECTED') throw new ForbiddenError('این فایل قرنطینه شده است')
  if (file.lifecycleState === 'DELETED' || file.lifecycleState === 'PURGED') return null
  const version = await db.storedFileVersion.findUnique({
    where: { fileId_version: { fileId: storedFileId, version: file.currentVersion } },
  })
  if (!version) return null
  const rendition = await db.storedFileVariant.findUnique({
    where: { versionId_variant: { versionId: version.id, variant: variant === 'ai' || variant === 'thumb' || variant === 'original' ? variant : 'compressed' } },
  })
  if (!rendition || !rendition.ready) return null
  const driver = getStorageDriver()
  const data = await driver.get(rendition.storageKey)
  return { data, mime: rendition.mime }
}

async function isOwnCase(userId: string, caseId: string) {
  const c = await db.medicalCase.findUnique({ where: { id: caseId }, select: { patientId: true } })
  return c?.patientId === userId
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s) } catch { return null }
}

// ══════════════════════════ PRIVACY ════════════════════════════════════════

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

export { notify } from '@/lib/notify'
