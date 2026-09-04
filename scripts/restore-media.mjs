// ── PHASE 10: media + database restore (ED-117 runbook component) ──────────
// Restores a backup created by scripts/backup-media.mjs.
//
//   bun scripts/restore-media.mjs --archive backups/media-<ts>.tar.gz --yes
//
// Safety: refuses to run without --yes. Stops nothing itself — stop the dev
// server / workers BEFORE restoring (documented in FILE-MEDIA.md §backup).
// Post-restore steps printed at the end.
import { readFile, stat } from 'fs/promises'
import { createHash } from 'crypto'
import { join } from 'path'
import { execFileSync } from 'child_process'
import { existsSync } from 'fs'

const ROOT = process.cwd()
const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(`--${name}`)
  return i !== -1 ? args[i + 1] : null
}
const archive = flag('archive')
const confirmed = args.includes('--yes')

function fail(msg) {
  console.error(`[restore-media] ${msg}`)
  process.exit(1)
}

if (!archive) fail('usage: bun scripts/restore-media.mjs --archive <path> --yes')
if (!confirmed) fail('refusing to restore without --yes (destructive operation)')
if (!existsSync(archive)) fail(`archive not found: ${archive}`)

async function main() {
  // 1 · integrity check (sha256 of archive recorded in run log; verify readable)
  const bytes = (await stat(archive)).size
  const digest = createHash('sha256').update(await readFile(archive)).digest('hex')
  console.log(`[restore-media] archive: ${archive} (${(bytes / 1024 / 1024).toFixed(2)} MB)`)
  console.log(`[restore-media] sha256=${digest}`)

  // 2 · extract to a staging dir first (never directly over live data)
  const stage = join(ROOT, 'backups', 'restore-stage')
  execFileSync('rm', ['-rf', stage])
  execFileSync('mkdir', ['-p', stage])
  execFileSync('tar', ['-xzf', archive, '-C', stage])

  if (!existsSync(join(stage, 'manifest.json'))) fail('archive is missing manifest.json — not a BabaHakim media backup')

  // 3 · replace storage/ and database
  execFileSync('rm', ['-rf', join(ROOT, 'storage')])
  execFileSync('mv', [join(stage, 'storage'), join(ROOT, 'storage')])
  const dbSrc = join(stage, 'db-custom.db')
  const dbDst = process.env.DATABASE_URL
    ? process.env.DATABASE_URL.replace(/^file:/, '')
    : join(ROOT, 'db', 'custom.db')
  if (existsSync(dbSrc)) {
    execFileSync('mv', [dbSrc, dbDst])
    console.log(`[restore-media] database restored → ${dbDst}`)
  } else {
    console.warn('[restore-media] archive had no database file — storage only')
  }
  execFileSync('rm', ['-rf', stage])

  console.log('[restore-media] done. Post-restore steps:')
  console.log('  1. restart the app/worker processes (they hold the old Prisma client)')
  console.log('  2. verify: GET /api/v1/admin/media/stats (as ADMIN)')
  console.log('  3. verify a rendition: GET /api/v1/files/<id>/content?variant=thumb (owner session)')
}

main().catch((e) => fail(e.message))
