// ── BabaHakim Backend · Media Lifecycle Worker (PHASE 10, ED-117) ───────────
// Retention & expiry enforcement, driven by the recurring `media-lifecycle`
// job (every 5 minutes) and by the admin ops trigger:
//
//   1. inbox TTL      — PENDING/PROCESSING files older than 24h are FAILED
//                       and their staged bytes deleted (worker crash safety)
//   2. TEMPORARY expiry — expired files move to trash/, lifecycleState=DELETED
//   3. trash retention — DELETED files past the 7-day window are physically
//                       purged (keys deleted) and tombstoned PURGED
//
// Every tick writes a system audit row with the aggregate report, so ops can
// verify the engine is actually enforcing retention (charter: auditability).
import { db } from '@/lib/db'
import { childLogger } from '@/server/core/logger'
import { publish, Events } from '@/server/infrastructure/events'
import { MEDIA_POLICY } from './config'
import { getStorageDriver, trashKey, extForMime } from './storage-driver'

const log = childLogger({ svc: 'media-lifecycle' })

export interface LifecycleTickReport {
  ranAt: string
  failedStale: number
  expiredTemporary: number
  purgedDeleted: number
  purgedBytes: number
  errors: string[]
}

/** One bounded lifecycle pass. Safe to run concurrently (idempotent updates). */
export async function runLifecycleTick(opts: { force?: boolean } = {}): Promise<LifecycleTickReport> {
  const driver = getStorageDriver()
  const report: LifecycleTickReport = {
    ranAt: new Date().toISOString(),
    failedStale: 0, expiredTemporary: 0, purgedDeleted: 0, purgedBytes: 0, errors: [],
  }
  const { inboxTtlMs, trashRetentionMs, purgeBatch } = MEDIA_POLICY.lifecycle
  const now = new Date()

  // 1 · inbox TTL — worker-crash safety net
  const staleCutoff = new Date(now.getTime() - inboxTtlMs)
  try {
    const stale = await db.storedFile.findMany({
      where: { status: { in: ['PENDING', 'PROCESSING'] }, createdAt: { lt: staleCutoff } },
      include: { versions: true },
      take: purgeBatch,
    })
    for (const f of stale) {
      for (const v of f.versions) {
        try { await driver.delete(v.storageKey) } catch { /* best-effort */ }
      }
      await db.storedFile.update({
        where: { id: f.id },
        data: { status: 'FAILED', rejectionReason: 'INBOX_TTL_EXPIRED' },
      })
      report.failedStale++
    }
  } catch (e) {
    report.errors.push(`stale: ${(e as Error).message}`)
  }

  // 2 · TEMPORARY expiry → trash
  try {
    const expired = await db.storedFile.findMany({
      where: { accessClass: 'TEMPORARY', lifecycleState: 'ACTIVE', expiresAt: { lt: now } },
      include: { versions: { include: { variants: true } } },
      take: purgeBatch,
    })
    for (const f of expired) {
      for (const v of f.versions) {
        for (const variant of v.variants) {
          if (!variant.ready) continue
          const ext = extForMime(variant.mime)
          const tKey = trashKey(v.sha256, v.version, f.id, variant.variant, ext)
          try {
            await driver.move(variant.storageKey, tKey)
            await db.storedFileVariant.update({ where: { id: variant.id }, data: { storageKey: tKey } })
          } catch (e) {
            report.errors.push(`move ${variant.storageKey}: ${(e as Error).message}`)
          }
        }
      }
      await db.storedFile.update({
        where: { id: f.id },
        data: { lifecycleState: 'DELETED', deletedAt: now },
      })
      report.expiredTemporary++
    }
  } catch (e) {
    report.errors.push(`expire: ${(e as Error).message}`)
  }

  // 3 · trash retention → physical purge
  try {
    const purgeCutoff = new Date(now.getTime() - (opts.force ? 0 : trashRetentionMs))
    const trash = await db.storedFile.findMany({
      where: { lifecycleState: 'DELETED', deletedAt: { lt: purgeCutoff } },
      include: { versions: { include: { variants: true } } },
      take: purgeBatch,
    })
    for (const f of trash) {
      for (const v of f.versions) {
        for (const variant of v.variants) {
          try {
            report.purgedBytes += variant.sizeBytes
            await driver.delete(variant.storageKey)
          } catch { /* ENOENT is fine */ }
        }
      }
      await db.storedFile.update({
        where: { id: f.id },
        data: { lifecycleState: 'PURGED', purgedAt: now },
      })
      report.purgedDeleted++
      await publish(Events.MediaFilePurged, { fileId: f.id, ownerId: f.ownerId })
    }
  } catch (e) {
    report.errors.push(`purge: ${(e as Error).message}`)
  }

  // aggregate audit (system actor) — charter: retention must be verifiable
  try {
    await db.auditLog.create({
      data: {
        userId: null, action: 'MEDIA_LIFECYCLE_TICK', entity: 'StoredFile', entityId: null,
        oldValues: null,
        newValues: JSON.stringify(report),
        ip: 'system', device: 'System', sensitive: false,
      },
    })
  } catch { /* audit best-effort */ }

  log.info('lifecycle tick', { ...report })
  return report
}
