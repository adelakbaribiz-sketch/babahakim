// ── BabaHakim Backend · Media Processing (PHASE 10, ED-113) ─────────────────
// Rendition pipeline for scanned buffers. Runs ONLY inside the background
// worker (media-process job) — never in a request thread (ED-114: heavy work
// must not block requests). Every derived rendition is re-encoded by sharp,
// which strips EXIF/metadata and neutralizes embedded payloads (scanner L3).
//
// Variant matrix (images):
//   original   archival re-encode, quality 95, EXIF-orientation applied
//   compressed network rendition, max 1600×1600 inside, mozjpeg q82
//   ai          model input, 512×512 cover, normalized (medical only)
//   thumb       UI rendition, max 320×320 inside, q70
import sharp from 'sharp'
import { MEDIA_POLICY, type MediaVariant } from './config'
import { assessQuality, type QualityReport } from '@/lib/storage'

export interface Rendition {
  variant: MediaVariant
  mime: string
  data: Buffer
  width?: number
  height?: number
}

export interface ProcessedImage {
  renditions: Rendition[]
  width: number
  height: number
  quality?: QualityReport
  stats: { decodeMs: number; encodeMs: number; inputBytes: number; outputBytes: number }
}

const MEDICAL_CATEGORIES = new Set(['MEDICAL_IMAGE'])

/** Build every derived rendition for a scanned image buffer. */
export async function processImage(
  buf: Buffer, category: string, type: string,
): Promise<ProcessedImage> {
  const t0 = Date.now()
  const base = sharp(buf, { failOn: 'none' })
  const meta = await base.metadata()
  const oriented = sharp(buf, { failOn: 'none' }).rotate() // apply EXIF orientation once
  const orientedMeta = await oriented.metadata()

  const policyVariants = (MEDIA_POLICY as { categories: Record<string, { variants: readonly string[] }> }).categories[category]?.variants
    ?? ['original', 'compressed', 'thumb']

  const renditions: Rendition[] = []
  const wants = (v: string) => policyVariants.includes(v) || v === 'original'

  // original: archival re-encode (privacy-safe: no EXIF is carried over)
  if (wants('original')) {
    const data = await sharp(buf, { failOn: 'none' }).rotate().jpeg({ quality: 95 }).toBuffer()
    renditions.push({ variant: 'original', mime: 'image/jpeg', data, width: orientedMeta.width, height: orientedMeta.height })
  }
  // compressed: network rendition
  if (wants('compressed')) {
    const data = await sharp(buf, { failOn: 'none' }).rotate()
      .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true }).toBuffer()
    const m = await sharp(data).metadata()
    renditions.push({ variant: 'compressed', mime: 'image/jpeg', data, width: m.width, height: m.height })
  }
  // ai: model input (medical categories only)
  if (wants('ai') && MEDICAL_CATEGORIES.has(category)) {
    const data = await sharp(buf, { failOn: 'none' }).rotate()
      .resize(512, 512, { fit: 'cover' }).normalize().jpeg({ quality: 90 }).toBuffer()
    renditions.push({ variant: 'ai', mime: 'image/jpeg', data, width: 512, height: 512 })
  }
  // thumb: UI rendition
  if (wants('thumb')) {
    const data = await sharp(buf, { failOn: 'none' }).rotate()
      .resize(320, 320, { fit: 'inside' }).jpeg({ quality: 70 }).toBuffer()
    const m = await sharp(data).metadata()
    renditions.push({ variant: 'thumb', mime: 'image/jpeg', data, width: m.width, height: m.height })
  }

  const t1 = Date.now()

  // medical quality gate (same scoring contract as the v1 pipeline)
  let quality: QualityReport | undefined
  if (MEDICAL_CATEGORIES.has(category)) {
    quality = await assessQuality(buf, type)
  }

  const outputBytes = renditions.reduce((s, r) => s + r.data.length, 0)
  return {
    renditions,
    width: orientedMeta.width || meta.width || 0,
    height: orientedMeta.height || meta.height || 0,
    quality,
    stats: {
      decodeMs: t1 - t0,
      encodeMs: Date.now() - t1,
      inputBytes: buf.length,
      outputBytes,
    },
  }
}

/** Non-image categories (PDF) keep the original as the only rendition. */
export function passThrough(buf: Buffer, mime: string): Rendition[] {
  return [{ variant: 'original', mime, data: buf }]
}
