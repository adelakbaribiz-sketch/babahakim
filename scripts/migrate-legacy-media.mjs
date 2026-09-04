// ── PHASE 10: migrate legacy flat MedicalImage rows into the media engine ──
// Moves storage/uploads/{base}-{variant}.jpg files into the classified zone
// (files/private/{sha16}/v1/{variant}.jpg), registers StoredFile + version 1
// + variant rows, and back-fills MedicalImage.storedFileId (+ updated paths
// so legacy consumers keep working).
//
// Idempotent: rows that already carry storedFileId are skipped.
// Run: bun scripts/migrate-legacy-media.mjs
import { PrismaClient } from '@prisma/client'
import { rename, mkdir, stat } from 'fs/promises'
import { createHash } from 'crypto'
import { join, dirname, basename } from 'path'
import { readFileSync } from 'fs'

const db = new PrismaClient()
const STORAGE_ROOT = join(process.cwd(), 'storage')

const VARIANTS = ['original', 'compressed', 'ai', 'thumb']

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

async function exists(p) {
  try { await stat(p); return true } catch { return false }
}

async function main() {
  const legacy = await db.medicalImage.findMany({ where: { storedFileId: null } })
  console.log(`[migrate-legacy-media] ${legacy.length} legacy MedicalImage rows`)

  let migrated = 0, skipped = 0, failed = 0
  for (const img of legacy) {
    try {
      // collect existing variant files
      const paths = {
        original: img.originalPath,
        compressed: img.compressedPath,
        ai: img.aiPath,
        thumb: img.thumbPath,
      }
      const present = {}
      for (const v of VARIANTS) {
        if (paths[v] && (await exists(paths[v]))) present[v] = paths[v]
      }
      if (!present.original) {
        // nothing on disk — register a tombstone FAILED row so it stops reappearing
        const tombstone = await db.storedFile.create({
          data: {
            ownerId: img.ownerId, category: 'MEDICAL_IMAGE', type: img.type,
            accessClass: 'PRIVATE', lifecycleState: 'ACTIVE', status: 'FAILED',
            caseId: img.caseId, currentVersion: 1,
            rejectionReason: 'LEGACY_FILE_MISSING',
            mime: img.mime, sizeBytes: img.sizeOriginal, sha256: img.sha256 || 'legacy-missing',
            fileName: `legacy-${img.id}`,
            versions: {
              create: {
                version: 1, fileName: `legacy-${img.id}`, mime: img.mime,
                sizeBytes: img.sizeOriginal, sha256: img.sha256 || 'legacy-missing',
                storageKey: `trash/legacy-missing-${img.id}`, scanStatus: 'CLEAN', scanEngine: 'legacy-migrated',
              },
            },
          },
        })
        await db.medicalImage.update({
          where: { id: img.id },
          data: { storedFileId: tombstone.id, rejectionReason: img.rejectionReason || 'LEGACY_FILE_MISSING' },
        })
        skipped++
        continue
      }

      const sha = sha256File(present.original)
      const zoneDir = join(STORAGE_ROOT, 'files', 'private', sha.slice(0, 16), 'v1')

      // move files into the classified zone (content-addressed keys)
      const newKeys = {}
      for (const v of Object.keys(present)) {
        const dst = join(zoneDir, `${v}.jpg`)
        await mkdir(dirname(dst), { recursive: true })
        if (dst !== present[v]) {
          try { await rename(present[v], dst) } catch (e) {
            if (e.code !== 'ENOENT') throw e
          }
        }
        newKeys[v] = `files/private/${sha.slice(0, 16)}/v1/${v}.jpg`
      }

      const statusMap = { VALIDATED: 'READY', PROCESSED: 'READY', REJECTED: 'REJECTED', PENDING: 'PENDING' }
      const status = statusMap[img.status] || 'READY'

      const variantRows = []
      for (const v of VARIANTS) {
        if (!newKeys[v]) continue
        const sz = await stat(join(STORAGE_ROOT, newKeys[v]))
        variantRows.push({ variant: v, storageKey: newKeys[v], mime: 'image/jpeg', sizeBytes: sz.size, ready: true })
      }

      const file = await db.storedFile.create({
        data: {
          ownerId: img.ownerId, category: 'MEDICAL_IMAGE', type: img.type,
          accessClass: 'PRIVATE', lifecycleState: 'ACTIVE', status,
          caseId: img.caseId, currentVersion: 1,
          rejectionReason: img.rejectionReason || (status === 'REJECTED' ? 'QUALITY_GATE' : null),
          fileName: basename(present.original),
          mime: img.mime, sizeBytes: img.sizeOriginal, sha256: sha,
          versions: {
            create: {
              version: 1, fileName: basename(present.original), mime: img.mime,
              sizeBytes: img.sizeOriginal, sha256: sha,
              storageKey: newKeys.original, width: img.width, height: img.height,
              scanStatus: 'CLEAN', scanEngine: 'legacy-migrated',
              metadata: JSON.stringify({
                scan: { status: 'CLEAN', engine: 'legacy-migrated', findings: [], scannedAt: new Date().toISOString(), clamAv: 'unavailable' },
                migratedAt: new Date().toISOString(),
                note: 'pre-PHASE-10 upload; magic-byte validated at accept time',
              }),
              variants: {
                create: variantRows,
              },
            },
          },
        },
      })

      await db.medicalImage.update({
        where: { id: img.id },
        data: {
          storedFileId: file.id,
          sha256: sha,
          originalPath: join(STORAGE_ROOT, newKeys.original),
          compressedPath: newKeys.compressed ? join(STORAGE_ROOT, newKeys.compressed) : null,
          aiPath: newKeys.ai ? join(STORAGE_ROOT, newKeys.ai) : null,
          thumbPath: newKeys.thumb ? join(STORAGE_ROOT, newKeys.thumb) : null,
        },
      })
      migrated++
    } catch (e) {
      console.error(`[migrate-legacy-media] row ${img.id} failed:`, e.message)
      failed++
    }
  }

  console.log(`[migrate-legacy-media] done: ${migrated} migrated, ${skipped} tombstoned, ${failed} failed`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => db.$disconnect())
