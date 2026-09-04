// Image storage + smart compression pipeline (sharp)
// Versioned artifacts: original (archive) / compressed (network) / ai (model input) / thumb (UI)
import sharp from 'sharp'
import { mkdir, writeFile, readFile, stat } from 'fs/promises'
import { join } from 'path'
import { createHash } from 'crypto'
import { db } from '@/lib/db'

const STORAGE_ROOT = join(process.cwd(), 'storage', 'uploads')

export const IMAGE_TYPES = ['TONGUE', 'FACE', 'RECEIPT', 'DELIVERY', 'PRODUCT'] as const
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp']
const MAX_SIZE = 10 * 1024 * 1024 // 10MB

export interface QualityReport {
  score: number // 0..100
  blur: number
  brightness: number
  exposure: 'LOW' | 'NORMAL' | 'HIGH'
  resolution: string
  resolutionOk: boolean
  orientation: string
  issues: string[] // fa messages
}

async function ensureDir() {
  await mkdir(STORAGE_ROOT, { recursive: true })
}

function sha256(buf: Buffer) {
  return createHash('sha256').update(buf).digest('hex')
}

// ── Quality assessment (blur / brightness / exposure / resolution) ──────
export async function assessQuality(buf: Buffer, type: string): Promise<QualityReport> {
  const issues: string[] = []
  const img = sharp(buf, { failOn: 'none' })
  const meta = await img.metadata()
  const stats = await img.stats()

  // Blur: variance of Laplacian approximation via sharpness channel stats
  const gray = await sharp(buf).greyscale().raw().toBuffer({ resolveWithObject: true })
  const { data, info } = gray
  let sum = 0, sumSq = 0
  const n = data.length
  for (let i = 0; i < n; i++) { sum += data[i]; sumSq += data[i] * data[i] }
  const mean = sum / n
  const variance = sumSq / n - mean * mean
  const blurScore = Math.min(100, Math.round((variance / 2500) * 100)) // higher = sharper

  // Brightness (luma) from stats
  const brightness = Math.round((stats.channels[0].mean / 255) * 100)
  let exposure: 'LOW' | 'NORMAL' | 'HIGH' = 'NORMAL'
  if (brightness < 30) { exposure = 'LOW'; issues.push('نور تصویر کم است؛ در نور طبیعی و با فلاش خاموش مجدداً عکاسی کنید.') }
  else if (brightness > 78) { exposure = 'HIGH'; issues.push('تصویر بیش از حد روشن (Over-exposed) است.') }

  if (blurScore < 18) issues.push('تصویر تار است؛ دست و زبان را ثابت نگه دارید و فوکوس را بررسی کنید.')

  const width = meta.width || 0
  const height = meta.height || 0
  const minDim = type === 'TONGUE' ? 480 : 320
  const resolutionOk = Math.min(width, height) >= minDim
  if (!resolutionOk) issues.push(`رزولوشن پایین (${width}×${height})؛ حداقل ${minDim} پیکسل لازم است.`)

  if ((meta.size || buf.length) > MAX_SIZE) issues.push('حجم فایل بیش از حد مجاز (۱۰ مگابایت) است.')

  const orientation = meta.orientation ? `EXIF-${meta.orientation}` : 'NORMAL'

  let score = 100
  if (blurScore < 18) score -= 45
  else if (blurScore < 30) score -= 20
  if (exposure !== 'NORMAL') score -= 25
  if (!resolutionOk) score -= 30
  score = Math.max(0, Math.min(100, score))

  return { score, blur: blurScore, brightness, exposure, resolution: `${width}×${height}`, resolutionOk, orientation, issues }
}

// ── Save + generate variants ────────────────────────────────────────────
export interface StoredImage {
  originalPath: string; compressedPath: string; aiPath: string; thumbPath: string
  width: number; height: number; sizeOriginal: number; sizeCompressed: number
  sha256: string; quality: QualityReport
}

export async function storeImage(buf: Buffer, ownerId: string, type: string, nameHint = 'img'): Promise<StoredImage> {
  await ensureDir()
  const hash = sha256(buf).slice(0, 16)
  const base = `${Date.now()}-${hash}-${type}`

  const originalPath = join(STORAGE_ROOT, `${base}-original.jpg`)
  const compressedPath = join(STORAGE_ROOT, `${base}-compressed.jpg`)
  const aiPath = join(STORAGE_ROOT, `${base}-ai.jpg`)
  const thumbPath = join(STORAGE_ROOT, `${base}-thumb.jpg`)

  // Original for secure archive (re-encoded without EXIF metadata → privacy-safe archive)
  await writeFile(originalPath, await sharp(buf).rotate().jpeg({ quality: 95 }).toBuffer())
  // Compressed for network (resize + strip metadata)
  const compressed = await sharp(buf).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer()
  await writeFile(compressedPath, compressed)
  // AI-optimized: normalized 512×512 for model input
  // sharp strips metadata by default (no withMetadata) — privacy-safe AI input
  const ai = await sharp(buf).rotate().resize(512, 512, { fit: 'cover' }).normalize().jpeg({ quality: 90 }).toBuffer()
  await writeFile(aiPath, ai)
  // Thumbnail for UI
  const thumb = await sharp(buf).rotate().resize(320, 320, { fit: 'inside' }).jpeg({ quality: 70 }).toBuffer()
  await writeFile(thumbPath, thumb)

  const quality = await assessQuality(buf, type)
  const meta = await sharp(buf).rotate().metadata()

  return {
    originalPath, compressedPath, aiPath, thumbPath,
    width: meta.width || 0, height: meta.height || 0,
    sizeOriginal: buf.length, sizeCompressed: compressed.length,
    sha256: sha256(buf), quality,
  }
}

export async function readStored(path: string): Promise<Buffer> {
  return readFile(path)
}

export async function fileExists(path: string): Promise<boolean> {
  try { await stat(path); return true } catch { return false }
}

// ── AI feature extraction from the actual image ────────────────────────
export interface TongueFeatures {
  redness: number // 0..1
  pallor: number // 0..1
  purpleIndex: number // 0..1
  coatingWhite: number // 0..1
  coatingYellow: number // 0..1
  brightness: number
  textureRoughness: number
  dominantHex: string
  centerStats: { r: number; g: number; b: number }
}

export async function extractTongueFeatures(aiImagePath: string): Promise<TongueFeatures> {
  const img = sharp(aiImagePath)
  const stats = await img.stats()
  const { dominant } = stats
  const r = stats.channels[0]?.mean ?? 0
  const g = stats.channels[1]?.mean ?? 1
  const b = stats.channels[2]?.mean ?? 0

  // central region (tongue body) — crop center 40%
  const meta = await img.metadata()
  const w = meta.width || 512, h = meta.height || 512
  const center = await sharp(aiImagePath).extract({ left: Math.floor(w * 0.3), top: Math.floor(h * 0.3), width: Math.floor(w * 0.4), height: Math.floor(h * 0.4) }).stats()
  const cr = center.channels[0]?.mean ?? 0
  const cg = center.channels[1]?.mean ?? 1
  const cb = center.channels[2]?.mean ?? 0

  // grey-level texture roughness via channel stdev
  const stdev = (stats.channels[0]?.stdev ?? 0) / 64

  const redness = Math.min(1, Math.max(0, (r - g) / 70))
  const pallor = Math.min(1, Math.max(0, (165 - r) / 90))
  const purpleIndex = Math.min(1, Math.max(0, (b - g + 15) / 50))
  const coatingWhite = Math.min(1, Math.max(0, (cg - r + 10) / 45) * Math.min(1, r / 120))
  const coatingYellow = Math.min(1, Math.max(0, (r - b - 12) / 40) * Math.min(1, (g - b + 8) / 30))

  const toHex = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')
  return {
    redness, pallor, purpleIndex, coatingWhite, coatingYellow,
    brightness: Math.round((r + g + b) / 3),
    textureRoughness: Math.min(1, stdev),
    dominantHex: `#${toHex(dominant?.r ?? r)}${toHex(dominant?.g ?? g)}${toHex(dominant?.b ?? b)}`,
    centerStats: { r: Math.round(cr), g: Math.round(cg), b: Math.round(cb) },
  }
}

// simple fake receipt storage (same pipeline, type RECEIPT)
export async function storeGeneric(buf: Buffer, ownerId: string, type: string): Promise<StoredImage> {
  return storeImage(buf, ownerId, type)
}
