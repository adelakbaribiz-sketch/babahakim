// ── PHASE 10: media + database backup (ED-117 runbook component) ───────────
// Creates backups/media-<timestamp>.tar.gz containing:
//   storage/            (all zones: inbox, files/{public,private,temp},
//                        quarantine, trash, legacy uploads)
//   db/custom.db        (SQLite snapshot after a WAL checkpoint)
//   manifest.json       (counts, bytes, sha256 of the archive itself)
// Prunes archives older than MEDIA_BACKUP_RETENTION_DAYS (default 14).
//
// Run: bun scripts/backup-media.mjs      (or: npm run backup:media)
// Schedule in production via cron, e.g. daily 03:30:
//   30 3 * * * cd /srv/babahakim && bun scripts/backup-media.mjs
import { PrismaClient } from '@prisma/client'
import { createHash } from 'crypto'
import { readdir, stat, mkdir, unlink, copyFile, writeFile, readFile } from 'fs/promises'
import { join } from 'path'
import { execFileSync } from 'child_process'
import { existsSync } from 'fs'

const db = new PrismaClient()
const ROOT = process.cwd()
const STORAGE = join(ROOT, 'storage')
const DB_FILE = process.env.DATABASE_URL
  ? process.env.DATABASE_URL.replace(/^file:/, '')
  : join(ROOT, 'db', 'custom.db')
const BACKUPS = join(ROOT, 'backups')
const RETENTION_DAYS = Number(process.env.MEDIA_BACKUP_RETENTION_DAYS || 14)

async function countTree(dir) {
  let files = 0, bytes = 0
  async function walk(d) {
    let entries
    try { entries = await readdir(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = join(d, e.name)
      if (e.isDirectory()) await walk(p)
      else if (e.isFile()) {
        files++
        bytes += (await stat(p)).size
      }
    }
  }
  await walk(dir)
  return { files, bytes }
}

async function main() {
  if (!existsSync(STORAGE)) {
    console.error('[backup-media] storage/ not found — nothing to back up')
    process.exit(1)
  }
  await mkdir(BACKUPS, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const name = `media-${ts}`
  const stageDir = join(BACKUPS, `${name}-stage`)
  await mkdir(join(stageDir, 'storage'), { recursive: true })

  // 1 · SQLite snapshot (checkpoint WAL first so the copy is complete)
  await db.$executeRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE);').catch(() => {})
  const dbCopy = join(stageDir, 'db-custom.db')
  await copyFile(DB_FILE, dbCopy).catch((e) => {
    console.warn(`[backup-media] db copy skipped: ${e.message}`)
  })

  // 2 · storage tree → stage (copy, not move: backup must not mutate source)
  execFileSync('cp', ['-r', STORAGE, join(stageDir, 'storage')], { stdio: 'inherit' })

  // 3 · manifest
  const storageStats = await countTree(STORAGE)
  const manifest = {
    createdAt: new Date().toISOString(),
    storage: storageStats,
    database: existsSync(dbCopy) ? (await stat(dbCopy)).size : null,
    retentionDays: RETENTION_DAYS,
    zones: ['inbox', 'files/public', 'files/private', 'files/temp', 'quarantine', 'trash', 'uploads (legacy)'],
  }
  await writeFile(join(stageDir, 'manifest.json'), JSON.stringify(manifest, null, 2))

  // 4 · archive
  const archive = join(BACKUPS, `${name}.tar.gz`)
  execFileSync('tar', ['-czf', archive, '-C', stageDir, 'storage', 'db-custom.db', 'manifest.json'], { stdio: 'inherit' })
  execFileSync('rm', ['-rf', stageDir])

  const digest = createHash('sha256').update(await readFile(archive)).digest('hex')
  console.log(`[backup-media] wrote ${archive}`)
  console.log(`[backup-media] sha256=${digest}`)
  console.log(`[backup-media] storage: ${storageStats.files} files, ${(storageStats.bytes / 1024 / 1024).toFixed(2)} MB`)

  // 5 · retention prune
  const cutoff = Date.now() - RETENTION_DAYS * 86_400_000
  for (const f of await readdir(BACKUPS)) {
    if (!f.startsWith('media-') || !f.endsWith('.tar.gz')) continue
    const p = join(BACKUPS, f)
    if ((await stat(p)).mtimeMs < cutoff) {
      await unlink(p)
      console.log(`[backup-media] pruned old archive ${f}`)
    }
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => db.$disconnect())
