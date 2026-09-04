// ── BabaHakim Backend · Application Service: Media Files (PHASE 10) ────────
// Facade over the media engine with the PHASE-08 discipline: guards →
// engine call → DTO. Handles authorization (classification-aware), the
// 202-accepted upload contract, status polling, versioning, signed URLs and
// rendition serving with correct cache/nosniff headers.
//
// Authorization model (ED-118):
//   PUBLIC files    — anonymous: only category publicVariants; staff: all
//   PRIVATE/TEMP    — owner, ADMIN, or view_images/view_medical_files perms;
//                     signed URLs (variant+version-bound, expiring)
//   ARCHIVED        — staff only. DELETED/PURGED — nobody (404).
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import type { AuthContext } from '@/lib/auth'
import { getAuth } from '@/lib/auth'
import { rateLimit, LIMITS } from '@/lib/security/rate-limit'
import {
  AppError, NotFoundError, ForbiddenError, ValidationError, RateLimitError,
  PayloadTooLargeError, UnsupportedMediaTypeError, BusinessRuleError,
} from '@/server/core/errors'
import type { RequestContext } from '@/server/core/context'
import { writeAudit } from '@/server/infrastructure/audit'
import { publish, Events } from '@/server/infrastructure/events'
import type { ListQuery } from '@/server/api/query'
import {
  MEDIA_POLICY, isMediaCategory, categoryPolicy, resolveAccessClass,
  MEDIA_VARIANTS, type MediaVariant, type MediaCategory,
} from '@/server/infrastructure/media/config'
import { getStorageDriver, extForMime } from '@/server/infrastructure/media/storage-driver'
import { signMediaUrl, verifyMediaSig } from '@/server/infrastructure/media/signed-url'
import { acceptUpload, MediaValidationError, sanitizeFileName } from '@/server/infrastructure/media/pipeline'
import { runLifecycleTick } from '@/server/infrastructure/media/lifecycle'
import { queueStats } from '@/server/infrastructure/jobs'

// ══════════════════════════ UPLOAD (202 async) ═════════════════════════════

const uploadInputSchema = z.object({
  category: z.string().min(1).max(40),
  type: z.string().min(1).max(40),
  declaredMime: z.string().min(1).max(100),
  fileName: z.string().max(255).nullable().optional(),
  caseId: z.string().max(64).nullable().optional(),
  accessClass: z.enum(['PUBLIC', 'PRIVATE', 'TEMPORARY']).nullable().optional(),
  ttlSec: z.coerce.number().int().min(1).max(86_400).nullable().optional(),
})

export async function uploadFile(
  auth: AuthContext, ctx: RequestContext,
  input: { file: File } & z.infer<typeof uploadInputSchema>,
) {
  const parsed = uploadInputSchema.parse(input)
  if (!isMediaCategory(parsed.category)) throw new ValidationError('دسته رسانه نامعتبر است')

  // upload rate limit (same bucket as the legacy images endpoint)
  const rl = rateLimit(`upload:${auth.user.id}`, LIMITS.upload.limit, LIMITS.upload.windowMs)
  if (!rl.allowed) {
    await writeAudit(ctx, { userId: auth.user.id, action: 'UPLOAD_RATE_LIMITED', entity: 'StoredFile', newValues: { retryAfter: rl.retryAfterSec } })
    throw new RateLimitError(undefined, { retryAfterSec: rl.retryAfterSec })
  }

  // case linkage guard (patients may only attach to their own cases)
  if (parsed.caseId) {
    const c = await db.medicalCase.findUnique({ where: { id: parsed.caseId } })
    if (!c) throw new NotFoundError('پرونده یافت نشد')
    if (auth.user.role === 'PATIENT' && c.patientId !== auth.user.id) throw new ForbiddenError('دسترسی غیرمجاز')
  }

  const buf = Buffer.from(await input.file.arrayBuffer())

  let result
  try {
    result = await acceptUpload({
      ownerId: auth.user.id,
      role: auth.user.role,
      category: parsed.category as MediaCategory,
      type: parsed.type,
      declaredMime: parsed.declaredMime,
      fileName: sanitizeFileName(parsed.fileName),
      buf,
      caseId: parsed.caseId ?? null,
      accessClassOverride: parsed.accessClass ?? null,
      ttlSec: parsed.ttlSec ?? null,
    })
  } catch (e) {
    if (e instanceof MediaValidationError) throw mapValidationError(e)
    if (e instanceof AppError) throw e
    throw new AppError('INTERNAL', 'خطا در دریافت فایل', 500)
  }

  await writeAudit(ctx, {
    userId: auth.user.id, action: 'MEDIA_UPLOAD', entity: 'StoredFile', entityId: result.fileId,
    newValues: { category: parsed.category, type: parsed.type, bytes: buf.length, accessClass: resolveAccessClass(parsed.category, parsed.accessClass ?? null), version: result.version },
  })

  // 202 Accepted — processing continues in the background worker (ED-114)
  return NextResponse.json({
    file: {
      id: result.fileId, status: result.status, version: result.version,
      category: parsed.category, type: parsed.type,
      sizeBytes: buf.length, sha256: undefined,
    },
    statusUrl: `/api/v1/files/${result.fileId}`,
    message: 'فایل دریافت شد و در حال پردازش است',
  }, { status: 202 })
}

function mapValidationError(e: MediaValidationError): AppError {
  const d = e.details as Record<string, unknown> | undefined
  switch (e.kind) {
    case 'SIZE': return new PayloadTooLargeError(e.message, d as { limitBytes: number; actualBytes: number } | undefined)
    case 'MIME': return new UnsupportedMediaTypeError(e.message, d as { allowed: string[]; declared?: string; detected?: string } | undefined)
    case 'MAGIC': return new UnsupportedMediaTypeError(e.message, d as { declared?: string; detected?: string } | undefined)
    default: return new ValidationError(e.message, d)
  }
}

// ══════════════════════════ STATUS / METADATA ══════════════════════════════

export async function getFileStatus(auth: AuthContext, ctx: RequestContext, id: string) {
  const file = await loadFileForRead(auth, id)
  const versions = await db.storedFileVersion.findMany({
    where: { fileId: id },
    orderBy: { version: 'desc' },
    include: { variants: true },
  })
  const current = versions.find((v) => v.version === file.currentVersion)
  const meta = current ? parseJson(current.metadata) : null
  return {
    file: {
      id: file.id, category: file.category, type: file.type,
      accessClass: file.accessClass, lifecycleState: file.lifecycleState,
      status: file.status, currentVersion: file.currentVersion,
      caseId: file.caseId, expiresAt: file.expiresAt,
      fileName: file.fileName, mime: file.mime, sizeBytes: file.sizeBytes,
      sha256: file.sha256, createdAt: file.createdAt, updatedAt: file.updatedAt,
      rejectionReason: file.rejectionReason,
    },
    currentVersionDetail: current ? {
      version: current.version, scanStatus: current.scanStatus, scanEngine: current.scanEngine,
      width: current.width, height: current.height, createdAt: current.createdAt,
      quality: (meta as { quality?: unknown } | null)?.quality ?? null,
      scan: (meta as { scan?: { findings?: string[] } } | null)?.scan ?? null,
      variants: current.variants
        .filter((v) => v.ready)
        .map((v) => ({ variant: v.variant, mime: v.mime, sizeBytes: v.sizeBytes, width: v.width, height: v.height })),
    } : null,
    versions: versions.map((v) => ({
      version: v.version, scanStatus: v.scanStatus, sizeBytes: v.sizeBytes,
      createdAt: v.createdAt, current: v.version === file.currentVersion,
    })),
  }
}

// ══════════════════════════ LIST (ED-100 contract) ═════════════════════════

export async function listFiles(auth: AuthContext, ctx: RequestContext, query: ListQuery) {
  const isStaff = auth.user.role !== 'PATIENT'
  const where: Record<string, unknown> = {
    lifecycleState: { not: 'PURGED' },
    ...(isStaff ? {} : { ownerId: auth.user.id }),
    ...(query.raw.get('category') ? { category: query.raw.get('category') } : {}),
    ...(query.raw.get('status') ? { status: query.raw.get('status') } : {}),
    ...(query.raw.get('accessClass') ? { accessClass: query.raw.get('accessClass') } : {}),
    ...(query.raw.get('ownerId') && isStaff ? { ownerId: query.raw.get('ownerId') } : {}),
  }
  const total = await db.storedFile.count({ where })
  const files = await db.storedFile.findMany({
    where, orderBy: { [qSortable(query.sort)]: query.order },
    skip: query.offset, take: query.limit,
    select: {
      id: true, category: true, type: true, accessClass: true, lifecycleState: true,
      status: true, currentVersion: true, fileName: true, mime: true, sizeBytes: true,
      sha256: true, createdAt: true, ownerId: true,
    },
  })
  return {
    files,
    meta: { page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit) },
  }
}

/** Whitelist sortable columns (injection-safe order clause). */
function qSortable(sort: string): string {
  return ['createdAt', 'updatedAt', 'sizeBytes'].includes(sort) ? sort : 'createdAt'
}

// ══════════════════════════ VERSIONING ═════════════════════════════════════

export async function addVersion(
  auth: AuthContext, ctx: RequestContext, id: string,
  input: { file: File; declaredMime: string; fileName?: string | null },
) {
  const file = await loadFileForWrite(auth, id)
  if (file.lifecycleState !== 'ACTIVE') throw new BusinessRuleError('فایل فعال نیست؛ نسخه جدید مجاز نیست')

  const buf = Buffer.from(await input.file.arrayBuffer())
  let result
  try {
    result = await acceptUpload({
      ownerId: file.ownerId, role: auth.user.role,
      category: file.category as MediaCategory, type: file.type,
      declaredMime: input.declaredMime, fileName: sanitizeFileName(input.fileName),
      buf, existingFileId: id,
    })
  } catch (e) {
    if (e instanceof MediaValidationError) throw mapValidationError(e)
    throw e
  }
  await writeAudit(ctx, {
    userId: auth.user.id, action: 'MEDIA_NEW_VERSION', entity: 'StoredFile', entityId: id,
    newValues: { version: result.version, bytes: buf.length },
  })
  return NextResponse.json({
    file: { id: id, status: 'PROCESSING', version: result.version },
    statusUrl: `/api/v1/files/${id}`,
    message: 'نسخه جدید دریافت شد و در حال پردازش است',
  }, { status: 202 })
}

export async function listVersions(auth: AuthContext, ctx: RequestContext, id: string) {
  const file = await loadFileForRead(auth, id)
  const versions = await db.storedFileVersion.findMany({
    where: { fileId: id }, orderBy: { version: 'desc' }, include: { variants: true },
  })
  return {
    versions: versions.map((v) => {
      const meta = parseJson(v.metadata) as { scan?: { findings?: string[]; status?: string }; quality?: { score?: number } } | null
      return {
        version: v.version, current: v.version === file.currentVersion,
        fileName: v.fileName, mime: v.mime, sizeBytes: v.sizeBytes, sha256: v.sha256,
        width: v.width, height: v.height, scanStatus: v.scanStatus, scanEngine: v.scanEngine,
        scanFindings: meta?.scan?.findings ?? [], qualityScore: meta?.quality?.score ?? null,
        createdAt: v.createdAt,
        variants: v.variants.filter((x) => x.ready).map((x) => ({ variant: x.variant, sizeBytes: x.sizeBytes, mime: x.mime })),
      }
    }),
  }
}

// ══════════════════════════ SIGNED URLS ════════════════════════════════════

const mintSchema = z.object({
  variant: z.enum(['original', 'compressed', 'ai', 'thumb']).default('compressed'),
  version: z.coerce.number().int().min(1).optional(),
  ttlSec: z.coerce.number().int().min(1).max(MEDIA_POLICY.signedUrl.maxTtlSec).optional(),
  download: z.boolean().default(false),
})

export async function mintSignedUrl(auth: AuthContext, ctx: RequestContext, id: string, body: unknown) {
  const input = mintSchema.parse(body ?? {})
  const file = await loadFileForRead(auth, id)
  if (file.accessClass === 'PUBLIC') {
    // public renditions do not need signatures — hand back the direct path
    return { url: `/api/v1/files/${id}/content?v=${file.currentVersion}&variant=${input.variant}`, signed: false, expiresAt: null }
  }
  assertRenditionAllowed(file, input.variant)
  const signed = signMediaUrl(id, input.version ?? file.currentVersion, input.variant, { ttlSec: input.ttlSec, download: input.download })
  await writeAudit(ctx, {
    userId: auth.user.id, action: 'MEDIA_SIGN_URL', entity: 'StoredFile', entityId: id,
    newValues: { variant: input.variant, version: input.version ?? file.currentVersion, ttlSec: input.ttlSec, download: input.download },
  })
  return {
    url: signed.path, signed: true,
    expiresAt: new Date(signed.exp * 1000).toISOString(),
  }
}

// ══════════════════════════ SERVING ════════════════════════════════════════

export interface ServeQuery {
  variant: string
  version: string | null
  exp: string | null
  sig: string | null
  download: boolean
  range: string | null
}

export async function serveFile(ctx: RequestContext, id: string, query: ServeQuery): Promise<NextResponse> {
  if (!/^[a-zA-Z0-9]{10,40}$/.test(id)) throw new ValidationError('شناسه فایل نامعتبر است')
  const file = await db.storedFile.findUnique({ where: { id } })
  // DELETED/PURGED are tombstones: 404 without revealing anything further
  if (!file || file.lifecycleState === 'PURGED' || file.lifecycleState === 'DELETED') throw new NotFoundError('فایل یافت نشد')

  const variant = normalizeVariant(query.variant)
  const versionNum = query.version ? Number(query.version) : file.currentVersion
  if (!Number.isInteger(versionNum) || versionNum < 1) throw new ValidationError('شماره نسخه نامعتبر است')

  // INFECTED files are never served to anyone
  if (file.status === 'INFECTED') throw new ForbiddenError('این فایل قرنطینه شده است')

  const version = await db.storedFileVersion.findUnique({ where: { fileId_version: { fileId: id, version: versionNum } } })
  if (!version) throw new NotFoundError('نسخه یافت نشد')
  const rendition = await db.storedFileVariant.findUnique({ where: { versionId_variant: { versionId: version.id, variant } } })
  if (!rendition || !rendition.ready) throw new NotFoundError('نسخه پردازش‌شده فایل یافت نشد')

  // ── authorization ──
  let authorized = false
  let via: 'SIGNED' | 'SESSION' | 'PUBLIC' = 'SESSION'
  let viewerId: string | null = null

  if (query.exp && query.sig) {
    authorized = verifyMediaSig(id, versionNum, variant, query.exp, query.sig)
    via = 'SIGNED'
  } else {
    const auth = await getAuth()
    if (auth) {
      viewerId = auth.user.id
      authorized = checkSessionAccess(auth, file)
    }
    if (!authorized && file.accessClass === 'PUBLIC') {
      const policy = categoryPolicy(file.category)
      if ((policy.publicVariants as readonly string[]).includes(variant)) {
        authorized = true
        via = 'PUBLIC'
      }
    }
  }
  // expired TEMPORARY files are dead even with a valid signature
  if (file.accessClass === 'TEMPORARY' && file.expiresAt && file.expiresAt.getTime() < Date.now()) {
    authorized = false
  }
  if (file.lifecycleState === 'ARCHIVED') {
    const auth = await getAuth()
    authorized = Boolean(auth && auth.user.role !== 'PATIENT')
  }

  if (!authorized) {
    if (viewerId) await writeAudit(ctx, { userId: viewerId, action: 'MEDIA_FILE_ACCESS_DENIED', entity: 'StoredFile', entityId: id })
    throw new ForbiddenError('دسترسی به فایل غیرمجاز است')
  }

  // audit: signed downloads + non-owner session views (owner self-views and
  // public fetches are not audited to keep the log signal-dense)
  if (via === 'SIGNED' || (via === 'SESSION' && viewerId && viewerId !== file.ownerId)) {
    await writeAudit(ctx, {
      userId: viewerId, action: via === 'SIGNED' ? 'MEDIA_DOWNLOAD' : 'MEDIA_VIEW', entity: 'StoredFile', entityId: id,
      newValues: { variant, version: versionNum, via },
    })
  }

  const driver = getStorageDriver()
  const buf = await driver.get(rendition.storageKey)
  const mime = rendition.mime || 'application/octet-stream'

  const headers = new Headers({
    'Content-Type': mime,
    'Content-Length': String(buf.length),
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `${query.download ? 'attachment' : 'inline'}; filename="${(file.fileName || `${id}-${variant}.${extForMime(mime)}`).replace(/["\r\n]/g, '')}"`,
    'Cache-Control': file.accessClass === 'PUBLIC'
      ? 'public, max-age=3600, immutable'
      : 'private, no-store',
    ETag: `"${version.sha256}-${variant}"`,
  })

  // single-range support (documents / large originals)
  if (query.range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(query.range)
    if (m) {
      const start = m[1] === '' ? 0 : Math.max(0, parseInt(m[1], 10))
      const end = m[2] === '' ? buf.length - 1 : Math.min(buf.length - 1, parseInt(m[2], 10))
      if (start <= end) {
        const slice = buf.subarray(start, end + 1)
        headers.set('Content-Range', `bytes ${start}-${end}/${buf.length}`)
        headers.set('Content-Length', String(slice.length))
        headers.set('Accept-Ranges', 'bytes')
        return new NextResponse(new Uint8Array(slice), { status: 206, headers })
      }
    }
  }
  headers.set('Accept-Ranges', 'bytes')
  return new NextResponse(new Uint8Array(buf), { status: 200, headers })
}

function normalizeVariant(v: string): MediaVariant {
  const found = MEDIA_VARIANTS.find((x) => x === v)
  if (!found) throw new ValidationError('نوع نسخه (variant) نامعتبر است')
  return found
}

function checkSessionAccess(auth: AuthContext, file: { ownerId: string; caseId: string | null }): boolean {
  if (auth.user.role === 'ADMIN') return true
  if (auth.user.role === 'PATIENT') return file.ownerId === auth.user.id
  return auth.permissions.includes('view_images') || auth.permissions.includes('view_medical_files')
}

function assertRenditionAllowed(file: { category: string; accessClass: string }, variant: string): void {
  const policy = categoryPolicy(file.category)
  if (!(policy.variants as readonly string[]).includes(variant)) {
    throw new ValidationError(`نسخه ${variant} برای این دسته تولید نمی‌شود`)
  }
}

// ══════════════════════════ LIFECYCLE OPS ══════════════════════════════════

const patchSchema = z.object({
  accessClass: z.enum(['PUBLIC', 'PRIVATE', 'TEMPORARY']).optional(),
  archive: z.boolean().optional(),
  ttlSec: z.coerce.number().int().min(60).max(86_400).optional(),
})

export async function patchFile(auth: AuthContext, ctx: RequestContext, id: string, body: unknown) {
  const input = patchSchema.parse(body ?? {})
  const file = await loadFileForWrite(auth, id)
  if (file.lifecycleState !== 'ACTIVE') throw new BusinessRuleError('فایل فعال نیست')

  const data: Record<string, unknown> = {}
  if (input.accessClass) {
    const effective = resolveAccessClass(file.category, input.accessClass)
    if (file.category === 'MEDICAL_IMAGE' && effective !== 'PRIVATE') {
      throw new BusinessRuleError('فایل‌های پزشکی هرگز عمومی نمی‌شوند (ED-66)')
    }
    data.accessClass = effective
    // re-classifying storage zones is handled on the next version; renditions
    // already in the old zone stay unreachable through policy, and PUBLIC
    // upgrades require a fresh upload in production (documented in FILE-MEDIA.md)
    if (effective === 'TEMPORARY') data.expiresAt = new Date(Date.now() + (input.ttlSec ?? MEDIA_POLICY.temporary.defaultTtlSec) * 1000)
    else data.expiresAt = null
  }
  if (input.archive === true) data.lifecycleState = 'ARCHIVED'
  if (input.archive === false) data.lifecycleState = 'ACTIVE'

  const updated = await db.storedFile.update({ where: { id }, data })
  await writeAudit(ctx, {
    userId: auth.user.id, action: 'MEDIA_PATCH', entity: 'StoredFile', entityId: id,
    oldValues: JSON.stringify({ accessClass: file.accessClass, lifecycleState: file.lifecycleState }),
    newValues: JSON.stringify({ accessClass: updated.accessClass, lifecycleState: updated.lifecycleState, expiresAt: updated.expiresAt }),
  })
  return { file: { id, accessClass: updated.accessClass, lifecycleState: updated.lifecycleState, expiresAt: updated.expiresAt } }
}

export async function deleteFile(auth: AuthContext, ctx: RequestContext, id: string) {
  const file = await loadFileForWrite(auth, id)
  if (file.lifecycleState !== 'ACTIVE' && file.lifecycleState !== 'ARCHIVED') {
    throw new BusinessRuleError('فایل قبلاً حذف شده است')
  }
  await db.storedFile.update({ where: { id }, data: { lifecycleState: 'DELETED', deletedAt: new Date() } })
  await publish(Events.MediaFilePurged, { fileId: id, ownerId: file.ownerId, softDeleted: true })
  await writeAudit(ctx, { userId: auth.user.id, action: 'MEDIA_DELETE', entity: 'StoredFile', entityId: id })
  return { file: { id, lifecycleState: 'DELETED', purgeAfter: new Date(Date.now() + MEDIA_POLICY.lifecycle.trashRetentionMs).toISOString() } }
}

export async function lifecycleTick(auth: AuthContext, ctx: RequestContext, opts: { force?: boolean } = {}) {
  const report = await runLifecycleTick(opts)
  await writeAudit(ctx, { userId: auth.user.id, action: 'MEDIA_LIFECYCLE_RUN', entity: 'StoredFile', newValues: JSON.stringify(report) })
  return { report }
}

// ══════════════════════════ ADMIN STATS ════════════════════════════════════

export async function mediaStats() {
  const [byStatus, byClass, byCategory, totals, infected] = await Promise.all([
    db.storedFile.groupBy({ by: ['status'], _count: { _all: true }, _sum: { sizeBytes: true } }),
    db.storedFile.groupBy({ by: ['accessClass'], _count: { _all: true }, _sum: { sizeBytes: true } }),
    db.storedFile.groupBy({ by: ['category'], _count: { _all: true }, _sum: { sizeBytes: true } }),
    db.storedFile.aggregate({ _count: { _all: true }, _sum: { sizeBytes: true } }),
    db.storedFileVersion.count({ where: { scanStatus: { in: ['INFECTED', 'SUSPECT'] } } }),
  ])
  return {
    totals: { files: totals._count._all, bytes: totals._sum.sizeBytes ?? 0 },
    byStatus: byStatus.map((s) => ({ status: s.status, files: s._count._all, bytes: s._sum.sizeBytes ?? 0 })),
    byAccessClass: byClass.map((s) => ({ accessClass: s.accessClass, files: s._count._all, bytes: s._sum.sizeBytes ?? 0 })),
    byCategory: byCategory.map((s) => ({ category: s.category, files: s._count._all, bytes: s._sum.sizeBytes ?? 0 })),
    quarantined: infected,
    queue: queueStats(),
    policy: {
      limits: Object.fromEntries(Object.entries(MEDIA_POLICY.categories).map(([k, v]) => [k, { patientMaxBytes: v.patientMaxBytes, staffMaxBytes: v.staffMaxBytes }])),
      lifecycle: MEDIA_POLICY.lifecycle,
    },
  }
}

// ══════════════════════════ helpers ════════════════════════════════════════

async function loadFileForRead(auth: AuthContext, id: string) {
  const file = await db.storedFile.findUnique({ where: { id } })
  if (!file || file.lifecycleState === 'PURGED') throw new NotFoundError('فایل یافت نشد')
  if (!checkSessionAccess(auth, file)) throw new ForbiddenError('دسترسی به فایل غیرمجاز است')
  return file
}

async function loadFileForWrite(auth: AuthContext, id: string) {
  const file = await db.storedFile.findUnique({ where: { id } })
  if (!file || file.lifecycleState === 'PURGED') throw new NotFoundError('فایل یافت نشد')
  if (auth.user.role === 'ADMIN') return file
  if (auth.user.role === 'PATIENT' && file.ownerId !== auth.user.id) throw new ForbiddenError('دسترسی به فایل غیرمجاز است')
  if (auth.user.role !== 'PATIENT' && !(auth.permissions.includes('view_images') || auth.permissions.includes('view_medical_files'))) {
    throw new ForbiddenError('دسترسی به فایل غیرمجاز است')
  }
  return file
}

function parseJson(s: string | null): unknown {
  if (!s) return null
  try { return JSON.parse(s) } catch { return null }
}
