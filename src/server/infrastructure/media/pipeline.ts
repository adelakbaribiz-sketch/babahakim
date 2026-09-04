// ── BabaHakim Backend · Media Pipeline (PHASE 10, ED-114) ───────────────────
// The two orchestrations of the file/media engine:
//
//   acceptUpload  (request thread — CHEAP: validate, stage to inbox, persist
//                  PENDING rows, enqueue the job, return 202 immediately)
//   processFile   (worker thread — scan → renditions → metadata → READY)
//
// Heavy work (sharp encode, scanning) happens ONLY in processFile, driven by
// the JobQueue (retry/backoff/DLQ, ED-102). Requests are never blocked by
// processing — the PHASE 10 charter requirement.
import { createHash } from 'crypto'
import { join } from 'path'
import { db } from '@/lib/db'
import { executeTransition } from '@/lib/workflow/engine'
import { childLogger } from '@/server/core/logger'
import { enqueue } from '@/server/infrastructure/jobs'
import { publish, Events } from '@/server/infrastructure/events'
import {
  MEDIA_POLICY, categoryPolicy, maxBytesFor, typeAllowedFor, resolveAccessClass,
  type MediaVariant, type MediaCategory, toMedicalStatus,
} from './config'
import {
  getStorageDriver, zoneForAccessClass, renditionKey, inboxKey, quarantineKey,
  extForMime, STORAGE_ROOT,
} from './storage-driver'
import { scanBuffer } from './scanner'
import { processImage, passThrough } from './processing'
import type { ScanReport } from './scanner'

const log = childLogger({ svc: 'media-pipeline' })

// ── magic-byte detection (route edge re-verification, ED-108) ──────────────

const MAGIC: Array<{ mime: string; test: (b: Buffer) => boolean }> = [
  { mime: 'image/jpeg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', test: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: 'image/webp', test: (b) => b.length > 12 && b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP' },
  { mime: 'application/pdf', test: (b) => b.length > 5 && b.slice(0, 5).toString('ascii') === '%PDF-' },
]

export function sniffMime(buf: Buffer): string | null {
  for (const m of MAGIC) if (m.test(buf)) return m.mime
  return null
}

export function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

// ── accept: request-thread stage (fast, no encoding) ───────────────────────

export interface AcceptInput {
  ownerId: string
  role: string
  category: MediaCategory
  type: string
  declaredMime: string
  fileName?: string | null
  buf: Buffer
  caseId?: string | null
  accessClassOverride?: string | null
  ttlSec?: number | null
  /** addVersion path: append to an existing file instead of creating one. */
  existingFileId?: string
}

export interface AcceptResult {
  fileId: string
  versionId: string
  version: number
  status: string
  jobId: string
}

export class MediaValidationError extends Error {
  constructor(
    message: string,
    readonly kind: 'TYPE' | 'MIME' | 'MAGIC' | 'SIZE' | 'EMPTY' | 'STATE',
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'MediaValidationError'
  }
}

/** Validate + stage + enqueue. Throws MediaValidationError (mapped by service). */
export async function acceptUpload(input: AcceptInput): Promise<AcceptResult> {
  const policy = categoryPolicy(input.category)

  // type ↔ category consistency
  if (!typeAllowedFor(input.category, input.type)) {
    throw new MediaValidationError(
      `نوع «${input.type}» برای دسته «${input.category}» مجاز نیست`,
      'TYPE', { category: input.category, allowed: [...policy.types] },
    )
  }
  // declared MIME allowlist (single source: MEDIA_POLICY, ED-107)
  if (!(policy.mimes as readonly string[]).includes(input.declaredMime)) {
    throw new MediaValidationError(
      'فرمت فایل مجاز نیست',
      'MIME', { allowed: [...policy.mimes], declared: input.declaredMime },
    )
  }
  if (input.buf.length === 0) throw new MediaValidationError('فایل خالی است', 'EMPTY')
  // size ceiling per (category, role)
  const limit = maxBytesFor(input.category, input.role)
  if (input.buf.length > limit) {
    throw new MediaValidationError('حجم فایل بیش از حد مجاز است', 'SIZE', { limitBytes: limit, actualBytes: input.buf.length })
  }
  // magic-byte sniff + declared/detected consistency (anti content-type spoofing)
  const detected = sniffMime(input.buf)
  if (!detected) {
    throw new MediaValidationError('محتوای فایل با فرمت اعلامی مطابقت ندارد', 'MAGIC', { declared: input.declaredMime })
  }
  if (detected !== input.declaredMime) {
    throw new MediaValidationError(
      'فرمت واقعی فایل با فرمت اعلامی متفاوت است',
      'MAGIC', { declared: input.declaredMime, detected },
    )
  }

  const accessClass = resolveAccessClass(input.category, input.accessClassOverride)
  const sha = sha256Hex(input.buf)
  const driver = getStorageDriver()

  // versioning: append to an existing file?
  let fileId = input.existingFileId ?? ''
  let version = 1
  if (input.existingFileId) {
    const existing = await db.storedFile.findUnique({ where: { id: input.existingFileId } })
    if (!existing) throw new MediaValidationError('فایل یافت نشد', 'STATE')
    if (existing.lifecycleState !== 'ACTIVE') {
      throw new MediaValidationError('فایل آرشیو/حذف‌شده قابل نسخه‌بندی نیست', 'STATE')
    }
    version = existing.currentVersion + 1
  }

  // stage raw bytes to the inbox zone (no encoding happens here)
  const stagingKey = inboxKey(fileId || `new-${sha.slice(0, 16)}`, version, sha)
  await driver.put(stagingKey, input.buf)

  // persist PENDING rows + variant slots
  let versionId = ''
  if (input.existingFileId) {
    const created = await db.storedFileVersion.create({
      data: {
        fileId: input.existingFileId, version,
        fileName: sanitizeFileName(input.fileName),
        mime: detected, sizeBytes: input.buf.length, sha256: sha,
        storageKey: stagingKey, scanStatus: 'PENDING',
      },
    })
    versionId = created.id
    await db.storedFileVariant.create({
      data: { versionId, variant: 'original', storageKey: stagingKey, mime: detected, sizeBytes: input.buf.length },
    })
    await db.storedFile.update({
      where: { id: input.existingFileId },
      data: { currentVersion: version, status: 'PROCESSING', rejectionReason: null, updatedAt: new Date() },
    })
    fileId = input.existingFileId
  } else {
    fileId = ''
    const file = await db.storedFile.create({
      data: {
        ownerId: input.ownerId, category: input.category, type: input.type,
        accessClass, lifecycleState: 'ACTIVE', status: 'PENDING',
        caseId: input.caseId ?? null, currentVersion: 1,
        expiresAt: accessClass === 'TEMPORARY' ? new Date(Date.now() + ttlMs(input)) : null,
        fileName: sanitizeFileName(input.fileName),
        mime: detected, sizeBytes: input.buf.length, sha256: sha,
      },
    })
    fileId = file.id
    const created = await db.storedFileVersion.create({
      data: {
        fileId, version: 1,
        fileName: sanitizeFileName(input.fileName),
        mime: detected, sizeBytes: input.buf.length, sha256: sha,
        storageKey: inboxKey(fileId, 1, sha), scanStatus: 'PENDING',
      },
    })
    versionId = created.id
    // move the staged bytes under the canonical inbox key
    await driver.move(stagingKey, inboxKey(fileId, 1, sha))
    await db.storedFileVersion.update({ where: { id: versionId }, data: { storageKey: inboxKey(fileId, 1, sha) } })
    await db.storedFileVariant.create({
      data: { versionId, variant: 'original', storageKey: inboxKey(fileId, 1, sha), mime: detected, sizeBytes: input.buf.length },
    })
  }

  const jobId = enqueue('media-process', { fileId, versionId }, { maxAttempts: 3, backoffMs: 2000 })
  log.info('upload accepted', { fileId, versionId, category: input.category, bytes: input.buf.length, jobId })

  return { fileId, versionId, version, status: 'PENDING', jobId }
}

function ttlMs(input: AcceptInput): number {
  const t = MEDIA_POLICY.temporary
  const ttl = input.ttlSec ?? t.defaultTtlSec
  return Math.min(Math.max(ttl, t.minTtlSec), t.maxTtlSec) * 1000
}

export function sanitizeFileName(name?: string | null): string | null {
  if (!name) return null
  const cleaned = name.replace(/[\u0000-\u001f\\/:"*?<>|]/g, '_').trim()
  return cleaned ? cleaned.slice(0, 180) : null
}

// ── process: worker-thread stage (scan → renditions → READY) ───────────────

export interface ProcessResult {
  fileId: string
  version: number
  status: 'READY' | 'REJECTED' | 'INFECTED' | 'FAILED'
  scan: Pick<ScanReport, 'status' | 'findings' | 'engine'>
  quality?: { score: number; resolutionOk: boolean; issues: string[] }
}

/** Worker entrypoint — idempotent, retry-safe. Throws only on hard errors. */
export async function processFile(fileId: string, versionId: string): Promise<ProcessResult> {
  const file = await db.storedFile.findUnique({ where: { id: fileId }, include: { versions: true } })
  if (!file) throw new Error(`stored file not found: ${fileId}`)
  const version = file.versions.find((v) => v.id === versionId)
  if (!version) throw new Error(`version not found: ${versionId}`)

  // idempotency: already-terminal versions are skipped on job replay
  if (version.scanStatus === 'CLEAN' || version.scanStatus === 'INFECTED' || version.scanStatus === 'SUSPECT') {
    log.info('process skipped (already scanned)', { fileId, versionId, scanStatus: version.scanStatus })
    return {
      fileId, version: version.version, status: file.status as ProcessResult['status'],
      scan: { status: version.scanStatus as ScanReport['status'], findings: [], engine: version.scanEngine || '' },
    }
  }

  await db.storedFile.update({ where: { id: fileId }, data: { status: 'PROCESSING' } })

  const driver = getStorageDriver()
  const raw = await driver.get(version.storageKey) // still in inbox

  // ── L1..L4 malware scan ──
  const scan = await scanBuffer(raw, version.mime)
  const versionMetadata: Record<string, unknown> = { scan }

  if (scan.status !== 'CLEAN') {
    // quarantine: raw bytes leave the inbox, access is denied forever
    const qKey = quarantineKey(fileId, version.version, version.sha256)
    await driver.move(version.storageKey, qKey)
    const metadata = JSON.stringify({ scan, quarantinedAt: new Date().toISOString() })
    await db.storedFileVersion.update({
      where: { id: versionId },
      data: {
        scanStatus: scan.status, scanEngine: scan.engine, storageKey: qKey, metadata,
      },
    })
    await db.storedFile.update({
      where: { id: fileId },
      data: {
        status: 'INFECTED',
        rejectionReason: scan.status === 'INFECTED' ? 'MALWARE_DETECTED' : 'SUSPICIOUS_CONTENT',
      },
    })
    await db.storedFileVariant.deleteMany({ where: { versionId, variant: { not: 'original' } } })
    await db.storedFileVariant.update({
      where: { versionId_variant: { versionId, variant: 'original' } },
      data: { storageKey: qKey, ready: true },
    })
    await publish(Events.MediaFileInfected, { fileId, versionId, ownerId: file.ownerId, findings: scan.findings })
    log.warn('file quarantined', { fileId, versionId, findings: scan.findings })
    return { fileId, version: version.version, status: 'INFECTED', scan }
  }

  // ── renditions (heavy sharp work lives here, off the request path) ──
  const isImage = version.mime.startsWith('image/')
  let renditions: { variant: MediaVariant; mime: string; data: Buffer; width?: number; height?: number }[]
  let width = version.width ?? 0
  let height = version.height ?? 0
  let quality: { score: number; resolutionOk: boolean; issues: string[] } | undefined
  if (isImage) {
    const processed = await processImage(raw, file.category, file.type)
    renditions = processed.renditions
    width = processed.width
    height = processed.height
    if (processed.quality) {
      quality = {
        score: processed.quality.score,
        resolutionOk: processed.quality.resolutionOk,
        issues: processed.quality.issues,
      }
      versionMetadata.quality = processed.quality
    }
    versionMetadata.stats = processed.stats
  } else {
    renditions = passThrough(raw, version.mime)
  }

  // ── promote to the classified zone (content-addressed keys) ──
  const zone = zoneForAccessClass(file.accessClass)
  const ext = extForMime(version.mime)
  const finalKeys: Record<string, string> = {}
  for (const r of renditions) {
    const key = renditionKey(zone, version.sha256, version.version, r.variant, r.variant === 'original' ? ext : 'jpg')
    await driver.put(key, r.data)
    finalKeys[r.variant] = key
  }
  // remove the raw inbox copy
  await driver.delete(version.storageKey)

  // ── persist version + variant rows ──
  const qualityGate = quality
    ? { ok: quality.score >= MEDIA_POLICY.quality.minScore && quality.resolutionOk, ...quality }
    : null
  const status: 'READY' | 'REJECTED' = qualityGate && !qualityGate.ok ? 'REJECTED' : 'READY'

  await db.storedFileVersion.update({
    where: { id: versionId },
    data: {
      scanStatus: 'CLEAN', scanEngine: scan.engine,
      storageKey: finalKeys.original,
      width: isImage ? width : null, height: isImage ? height : null,
      metadata: JSON.stringify({ ...versionMetadata, promotedAt: new Date().toISOString() }),
    },
  })

  const originalR = renditions.find((r) => r.variant === 'original')!
  const compressedR = renditions.find((r) => r.variant === 'compressed')
  const aiR = renditions.find((r) => r.variant === 'ai')
  const thumbR = renditions.find((r) => r.variant === 'thumb')

  await db.storedFileVariant.update({
    where: { versionId_variant: { versionId, variant: 'original' } },
    data: { storageKey: finalKeys.original, mime: originalR.mime, sizeBytes: originalR.data.length, width: originalR.width, height: originalR.height, ready: true },
  })
  for (const [variant, r] of [
    ['compressed', compressedR], ['ai', aiR], ['thumb', thumbR],
  ] as const) {
    if (!r) {
      await db.storedFileVariant.deleteMany({ where: { versionId, variant } })
      continue
    }
    const existing = await db.storedFileVariant.findUnique({ where: { versionId_variant: { versionId, variant } } })
    const data = {
      storageKey: finalKeys[variant], mime: r.mime, sizeBytes: r.data.length,
      width: r.width, height: r.height, ready: true,
    }
    if (existing) await db.storedFileVariant.update({ where: { id: existing.id }, data })
    else await db.storedFileVariant.create({ data: { versionId, variant, ...data } })
  }

  await db.storedFile.update({
    where: { id: fileId },
    data: {
      status,
      rejectionReason: status === 'REJECTED' ? 'QUALITY_GATE' : null,
      mime: originalR.mime, sizeBytes: originalR.data.length, sha256: version.sha256,
      fileName: version.fileName,
    },
  })

  // ── MedicalImage bridge (legacy consumers keep working, ED-115) ──
  if (file.category === 'MEDICAL_IMAGE') {
    const medicalStatus = toMedicalStatus(status)
    // PHASE 12: the clinical status write flows through the MEDICAL_IMAGE
    // machine (guarded, audited, WorkflowState-synced). The worker is not in
    // a transaction — executeTransition opens its own.
    const images = await db.medicalImage.findMany({ where: { storedFileId: fileId }, select: { id: true } })
    const action = medicalStatus === 'VALIDATED' ? 'VALIDATE'
      : medicalStatus === 'REJECTED' ? 'REJECT'
        : 'MARK_PROCESSED'
    // at this point in processFile the quality gate has already spoken:
    // status is READY (→ VALIDATE) or REJECTED (quality failure)
    const reason = status === 'REJECTED' ? 'کیفیت تصویر کافی نیست' : undefined
    for (const img of images) {
      await executeTransition({
        machine: 'MEDICAL_IMAGE', entityId: img.id, action,
        actor: { id: 'SYSTEM', role: 'SYSTEM' },
        payload: {
          ...(reason ? { reason } : {}),
          originalPath: join(STORAGE_ROOT, finalKeys.original),
          compressedPath: compressedR ? join(STORAGE_ROOT, finalKeys.compressed) : null,
          aiPath: aiR ? join(STORAGE_ROOT, finalKeys.ai) : null,
          thumbPath: thumbR ? join(STORAGE_ROOT, finalKeys.thumb) : null,
          width: width || null, height: height || null,
          sizeOriginal: originalR.data.length,
          sizeCompressed: compressedR?.data.length ?? null,
          quality: versionMetadata.quality ?? null,
        },
      })
    }
    if (medicalStatus === 'VALIDATED') {
      // legacy event: bootstrap notifies the patient (IMAGE_RECEIVED)
      await publish(Events.ImageUploaded, { userId: file.ownerId, imageId: fileId }, undefined)
    }
  }

  await publish(Events.MediaFileReady, { fileId, versionId, ownerId: file.ownerId, category: file.category, status })
  log.info('file processed', { fileId, version: version.version, status, scan: scan.status })

  return { fileId, version: version.version, status, scan, quality: qualityGate ?? undefined }
}
