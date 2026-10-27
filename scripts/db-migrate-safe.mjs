#!/usr/bin/env bun
// Safe migration runner for BabaHakim SQLite databases (dev box AND container).
//
// Handles the three database states that exist in the wild:
//   a) no file yet (fresh server)       → plain `prisma migrate deploy`
//   b) built with `prisma db push`      → no _prisma_migrations: baseline every
//      migration up to BASELINE_CUTOFF (that schema is already present), then deploy
//   c) migration history present        → reconcile-only migrations whose objects
//      already exist (db-push drift) are marked applied, then deploy
// Whenever something is pending it first writes a consistent VACUUM INTO backup
// next to the database, and afterwards verifies PRAGMA integrity_check and that
// no table lost rows. Nothing pending → no backup, no-op (safe on every boot).
//
// Usage:  bun scripts/db-migrate-safe.mjs            (DATABASE_URL or .env)
//         DATABASE_URL=file:/data/bh.db bun scripts/db-migrate-safe.mjs
import { Database } from 'bun:sqlite'
import { readdirSync, existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

// last migration whose schema a db-push database (pre-2026-10 HEAD) already has
const BASELINE_CUTOFF = '20260920000000_reconcile_db_push_drift'
// migrations that only re-create db-push drift: probe object → mark applied if present
const RECONCILE = { '20260920000000_reconcile_db_push_drift': 'AIPromptTemplate' }
const TABLES = ['User', 'MedicalCase', 'Prescription', 'PrescriptionItem', 'Product', 'Order', 'Ticket', 'QuestionnaireResponse', 'Question']

const root = process.env.BH_APP_ROOT || process.cwd()
const migrationsDir = join(root, 'prisma', 'migrations')
const schemaPath = join(root, 'prisma', 'schema.prisma')
const prismaCli = join(root, 'node_modules', 'prisma', 'build', 'index.js')

const url = process.env.DATABASE_URL || readEnvUrl()
if (!url?.startsWith('file:')) {
  console.error('DATABASE_URL must be a file: URL (SQLite)')
  process.exit(1)
}
const dbPath = resolve(root, url.slice('file:'.length))
const env = { ...process.env, DATABASE_URL: url }

let backup = null
const run = (args) => {
  // prisma CLI through the current runtime (the container ships bun, not node)
  const r = spawnSync(process.execPath, [prismaCli, ...args, '--schema', schemaPath], { env, stdio: 'inherit', cwd: root })
  if (r.status !== 0) {
    console.error(`prisma ${args.join(' ')} failed${backup ? ` — backup: ${backup}` : ''}`)
    process.exit(r.status || 1)
  }
}

// a) fresh database
if (!existsSync(dbPath)) {
  console.log(`[migrate] no database at ${dbPath} — creating from migrations`)
  run(['migrate', 'deploy'])
  process.exit(0)
}

const all = readdirSync(migrationsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()
const inspect = () => {
  const db = new Database(dbPath, { readonly: true })
  const has = (name) => !!db.query("select name from sqlite_master where type='table' and name=?").get(name)
  const history = has('_prisma_migrations')
  const applied = history
    ? new Set(db.query('select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null').all().map((r) => r.migration_name))
    : new Set()
  const out = { history, applied, has }
  return { ...out, close: () => db.close() }
}
const counts = () => {
  const db = new Database(dbPath, { readonly: true })
  const out = {}
  for (const t of TABLES) {
    try { out[t] = db.query(`select count(*) n from "${t}"`).get().n } catch { out[t] = 'n/a' }
  }
  db.close()
  return out
}

const state = inspect()
const toBaseline = state.history ? [] : all.filter((m) => m <= BASELINE_CUTOFF)
const toResolve = state.history
  ? Object.entries(RECONCILE).filter(([m, probe]) => !state.applied.has(m) && state.has(probe)).map(([m]) => m)
  : []
const pending = all.filter((m) => !state.applied.has(m) && !toBaseline.includes(m) && !toResolve.includes(m))
state.close()

if (!toBaseline.length && !toResolve.length && !pending.length) {
  console.log('[migrate] database is up to date — nothing to do')
  process.exit(0)
}

// backup before any write
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
backup = `${dbPath}.pre-migrate-${stamp}.db`
{
  const db = new Database(dbPath)
  db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`)
  db.close()
}
console.log(`[migrate] backup written: ${backup}`)
const before = counts()

for (const m of [...toBaseline, ...toResolve]) {
  console.log(`[migrate] mark applied (schema already present): ${m}`)
  run(['migrate', 'resolve', '--applied', m])
}
run(['migrate', 'deploy'])

const db = new Database(dbPath, { readonly: true })
const integrity = db.query('PRAGMA integrity_check').get()
db.close()
const after = counts()
console.log('[migrate] integrity:', integrity)
console.table(Object.keys(before).map((t) => ({ table: t, before: before[t], after: after[t] })))
const lost = Object.keys(before).filter((t) => typeof before[t] === 'number' && after[t] < before[t])
if (lost.length || Object.values(integrity)[0] !== 'ok') {
  console.error(`[migrate] VERIFY FAILED (${lost.join(', ') || 'integrity'}) — restore from ${backup}`)
  process.exit(2)
}
console.log('[migrate] complete — no rows lost')

function readEnvUrl() {
  try {
    const text = readFileSync(join(root, '.env'), 'utf8')
    return text.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, '')
  } catch { return undefined }
}
