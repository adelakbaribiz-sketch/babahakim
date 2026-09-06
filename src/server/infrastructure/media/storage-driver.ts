// ── BabaHakim Backend · Storage Driver (PHASE 10, ED-109) ───────────────────
// Zone-based local storage with a small driver port so S3/MinIO (ADR-0006)
// is a swap, not a rewrite. Zones:
//
//   inbox/          raw uploads awaiting scan+processing (TTL-purged)
//   files/public/   PUBLIC class renditions
//   files/private/  PRIVATE class renditions (medical, receipts, docs)
//   files/temp/     TEMPORARY class renditions (same auth, expiry-purged)
//   quarantine/     files the scanner flagged (INFECTED/SUSPECT)
//   trash/          soft-deleted files during the retention window
//
// Keys are driver-relative, always zone-prefixed, and structurally validated:
// path traversal (".."), absolute paths, backslashes and unsafe characters are
// rejected BEFORE any fs call (ED-110). No caller may join user input into a
// filesystem path.
import { mkdir, readFile, writeFile, rename, unlink, stat, readdir } from 'fs/promises'
import { join, dirname } from 'path'
import { faultActive, FAULT_STORAGE_DOWN } from '@/server/infrastructure/faults'

export const STORAGE_ROOT = join(process.cwd(), 'storage')

export const ZONES = {
  inbox: 'inbox',
  filesPublic: 'files/public',
  filesPrivate: 'files/private',
  filesTemp: 'files/temp',
  quarantine: 'quarantine',
  trash: 'trash',
} as const

export type Zone = (typeof ZONES)[keyof typeof ZONES]

export interface StorageDriver {
  readonly name: string
  put(key: string, data: Buffer): Promise<void>
  get(key: string): Promise<Buffer>
  move(from: string, to: string): Promise<void>
  delete(key: string): Promise<void>
  exists(key: string): Promise<boolean>
  size(key: string): Promise<number>
  /** List keys under a prefix (zone sweeps; shallow per-directory walk). */
  list(prefix: string): Promise<string[]>
}

// ── key validation (ED-110: structural path safety) ────────────────────────

const ZONE_PREFIXES = Object.values(ZONES)
const KEY_RE = /^[a-zA-Z0-9][a-zA-Z0-9/._-]*$/

export function assertSafeKey(key: string): void {
  if (!KEY_RE.test(key)) throw new Error(`unsafe storage key rejected: ${JSON.stringify(key.slice(0, 80))}`)
  if (key.includes('..') || key.includes('\\') || key.startsWith('/')) {
    throw new Error(`path traversal attempt rejected: ${JSON.stringify(key.slice(0, 80))}`)
  }
  const zoned = ZONE_PREFIXES.some((z) => key === z || key.startsWith(`${z}/`))
  if (!zoned) throw new Error(`storage key must be zone-prefixed: ${JSON.stringify(key.slice(0, 80))}`)
}

function abs(key: string): string {
  assertSafeKey(key)
  return join(STORAGE_ROOT, key)
}

// ── local driver ───────────────────────────────────────────────────────────

class LocalDriver implements StorageDriver {
  readonly name = 'local'

  /** PHASE 17 (ED-187): chaos seam — storage:down throws a realistic fs EIO
   * error so outage handling (→ 503 STORAGE, readiness degraded) is testable
   * against the live server. No-op in every non-chaos environment. */
  private chaos(): void {
    if (!faultActive(FAULT_STORAGE_DOWN)) return
    const err = new Error('EIO: injected storage fault (chaos) — storage unavailable') as Error & { code?: string }
    err.code = 'EIO'
    throw err
  }

  async put(key: string, data: Buffer): Promise<void> {
    this.chaos()
    const p = abs(key)
    await mkdir(dirname(p), { recursive: true })
    await writeFile(p, data)
  }

  async get(key: string): Promise<Buffer> {
    this.chaos()
    return readFile(abs(key))
  }

  async move(from: string, to: string): Promise<void> {
    this.chaos()
    const src = abs(from)
    const dst = abs(to)
    await mkdir(dirname(dst), { recursive: true })
    await rename(src, dst)
  }

  async delete(key: string): Promise<void> {
    this.chaos()
    try {
      await unlink(abs(key))
    } catch (e) {
      const code = (e as { code?: string }).code
      if (code !== 'ENOENT') throw e
    }
  }

  async exists(key: string): Promise<boolean> {
    this.chaos()
    try {
      await stat(abs(key))
      return true
    } catch {
      return false
    }
  }

  async size(key: string): Promise<number> {
    const s = await stat(abs(key))
    return s.size
  }

  async list(prefix: string): Promise<string[]> {
    assertSafeKey(prefix)
    const root = abs(prefix)
    let entries
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      return []
    }
    const out: string[] = []
    // bounded walk: media layouts are shallow (zone/hash/vN/variant.ext)
    for (const e of entries) {
      const key = `${prefix}/${e.name}`
      if (e.isDirectory()) out.push(...(await this.list(key)))
      else if (e.isFile()) out.push(key)
    }
    return out
  }
}

// ── factory (HMR-safe singleton) ───────────────────────────────────────────

const g = globalThis as unknown as { __bhStorageDriver?: StorageDriver }

export function getStorageDriver(): StorageDriver {
  if (g.__bhStorageDriver) return g.__bhStorageDriver
  const driverName = process.env.MEDIA_STORAGE_DRIVER || 'local'
  if (driverName !== 'local') {
    // Future: 's3' driver (ADR-0006). Until then fail loud, not silent.
    throw new Error(`unknown MEDIA_STORAGE_DRIVER "${driverName}" — only "local" is implemented`)
  }
  g.__bhStorageDriver = new LocalDriver()
  return g.__bhStorageDriver
}

/** Zone for an access class (renditions after successful scan). */
export function zoneForAccessClass(accessClass: string): Zone {
  if (accessClass === 'PUBLIC') return ZONES.filesPublic
  if (accessClass === 'TEMPORARY') return ZONES.filesTemp
  return ZONES.filesPrivate
}

/** Content-addressed rendition key: zone/{hash16}/v{n}/{variant}.{ext} */
export function renditionKey(
  zone: Zone, sha256: string, version: number, variant: string, ext: string,
): string {
  return `${zone}/${sha256.slice(0, 16)}/v${version}/${variant}.${ext}`
}

/** Inbox staging key (raw upload awaiting processing). */
export function inboxKey(fileId: string, version: number, sha256: string): string {
  return `${ZONES.inbox}/${sha256.slice(0, 16)}-v${version}-${fileId}`
}

export function quarantineKey(fileId: string, version: number, sha256: string): string {
  return `${ZONES.quarantine}/${sha256.slice(0, 16)}-v${version}-${fileId}`
}

export function trashKey(sha256: string, version: number, fileId: string, variant: string, ext: string): string {
  return `${ZONES.trash}/${sha256.slice(0, 16)}/v${version}/${fileId}-${variant}.${ext}`
}

export function extForMime(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'application/pdf') return 'pdf'
  return 'bin'
}
