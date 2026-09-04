#!/usr/bin/env node
// ── BabaHakim Media Engine Audit (PHASE 10, ED-119) ───────────────────────
// CI gate that keeps the file/media discipline true. Exit 1 on any
// violation; JSON report to scripts/media-audit.json. Mirrors the
// ui-audit/backend-audit gates.
//
// Rules:
//   E1 no route file imports sharp/fs directly (heavy work lives in the
//      worker; controllers stay thin) — media engine modules are exempt
//   E2 size limits / MIME allowlists exist ONLY in media/config.ts
//      (single source ED-107): no literal "* 1024 * 1024" in services/routes
//   E3 signed URLs are built via signMediaUrl (variant+version bound):
//      imageService/caseService must not hand-roll HMAC signatures
//   E4 storage access goes through the driver (no raw fs join on user data
//      outside the driver + the documented legacy read path)
//   E5 upload endpoints respond 202 (async contract ED-114) — no sync
//      storeImage() calls anywhere in src/server
//   E6 media routes wrap handlers in apiRoute() (envelope/versioning)
//   E7 lifecycle enforcement references MEDIA_POLICY lifetimes (no magic
//      numbers outside config)
//   W1 media modules > 400 lines (split engine internals)
//   W2 TODO/PHASE debt markers in media engine
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const results = []
let errors = 0, warnings = 0

function walk(dir, filter = () => true) {
  const out = []
  let entries
  try { entries = readdirSync(dir) } catch { return out }
  for (const name of entries) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p, filter))
    else if (filter(p)) out.push(p)
  }
  return out
}

const rel = (p) => p.replace(ROOT + '/', '')

function fail(file, rule, line, msg) { errors++; results.push({ file: rel(file), rule, line, message: msg, level: 'error' }) }
function warn(file, rule, line, msg) { warnings++; results.push({ file: rel(file), rule, line, message: msg, level: 'warn' }) }

const routeFiles = walk(join(ROOT, 'src/app/api'), (p) => p.endsWith('route.ts'))
const serverFiles = walk(join(ROOT, 'src/server'), (p) => p.endsWith('.ts') && !p.includes('__tests__'))
const libFiles = walk(join(ROOT, 'src/lib'), (p) => p.endsWith('.ts') && !p.includes('__tests__'))

// ── E1: no heavy media imports in routes ──────────────────────────────────
for (const f of routeFiles) {
  const src = readFileSync(f, 'utf8')
  src.split('\n').forEach((line, i) => {
    if (/from ['"]sharp['"]/.test(line)) fail(f, 'E1', i + 1, 'route imports sharp — processing must stay in the worker')
    if (/from ['"]fs(\/promises)?['"]/.test(line)) fail(f, 'E1', i + 1, 'route imports fs — storage access belongs to the driver')
  })
}

// ── E2: single-source limits ───────────────────────────────────────────────
const nonConfigFiles = [...serverFiles, ...routeFiles].filter((f) => !f.endsWith('media/config.ts'))
for (const f of nonConfigFiles) {
  if (f.includes('media/__tests__')) continue
  const src = readFileSync(f, 'utf8')
  src.split('\n').forEach((line, i) => {
    if (/\*\s*1024\s*\*\s*1024/.test(line) && !/ED|legacy|PHASE 0[1-9]/.test(line)) {
      fail(f, 'E2', i + 1, 'hard-coded MB limit — use MEDIA_POLICY (config.ts single source)')
    }
    if (/ALLOWED_MIME\s*=/.test(line) && !f.endsWith('media/config.ts') && !f.endsWith('lib/storage.ts')) {
      fail(f, 'E2', i + 1, 'duplicate MIME allowlist — MEDIA_POLICY is the single source (lib/storage is frozen legacy)')
    }
  })
}

// ── E3: no hand-rolled media signatures ───────────────────────────────────
for (const f of [...serverFiles, ...libFiles]) {
  const src = readFileSync(f, 'utf8')
  src.split('\n').forEach((line, i) => {
    if (/createHmac\(['"]sha256['"]/.test(line) && /fileId|version|variant/.test(line)) {
      fail(f, 'E3', i + 1, 'hand-rolled media signature — use signMediaUrl (variant+version bound, ED-112)')
    }
  })
}

// ── E4: driver-guarded storage keys in the engine ─────────────────────────
const driverSrc = readFileSync(join(ROOT, 'src/server/infrastructure/media/storage-driver.ts'), 'utf8')
if (!/function assertSafeKey/.test(driverSrc) || !/includes\('\.\.'\)/.test(driverSrc)) {
  fail('src/server/infrastructure/media/storage-driver.ts', 'E4', 0, 'driver must structurally reject traversal keys')
}

// ── E5: no sync storeImage from the server layer ───────────────────────────
for (const f of serverFiles) {
  const src = readFileSync(f, 'utf8')
  src.split('\n').forEach((line, i) => {
    if (/\bstoreImage\s*\(/.test(line)) fail(f, 'E5', i + 1, 'sync storeImage call — upload must go through acceptUpload (202 async, ED-114)')
  })
}

// ── E6: media routes use apiRoute ──────────────────────────────────────────
const mediaRoutes = routeFiles.filter((f) => f.includes('/api/v1/files') || f.includes('/api/v1/admin/media') || f.includes('/api/v1/images'))
for (const f of mediaRoutes) {
  const src = readFileSync(f, 'utf8')
  if (!/apiRoute</.test(src) && !/apiRoute\(/.test(src)) fail(f, 'E6', 0, 'media route must wrap handlers in apiRoute()')
}

// ── E7: lifecycle numbers come from MEDIA_POLICY ───────────────────────────
const lifecycleSrc = readFileSync(join(ROOT, 'src/server/infrastructure/media/lifecycle.ts'), 'utf8')
if (!/MEDIA_POLICY\.lifecycle/.test(lifecycleSrc)) {
  fail('src/server/infrastructure/media/lifecycle.ts', 'E7', 0, 'lifecycle must read MEDIA_POLICY.lifecycle (no magic retention numbers)')
}
const bootstrapSrc = readFileSync(join(ROOT, 'src/server/infrastructure/bootstrap.ts'), 'utf8')
if (!/media-process/.test(bootstrapSrc) || !/media-lifecycle/.test(bootstrapSrc)) {
  fail('src/server/infrastructure/bootstrap.ts', 'E7', 0, 'bootstrap must register media-process + media-lifecycle jobs')
}

// ── W1/W2: hygiene ─────────────────────────────────────────────────────────
for (const f of walk(join(ROOT, 'src/server/infrastructure/media'), (p) => p.endsWith('.ts') && !p.includes('__tests__'))) {
  const lines = readFileSync(f, 'utf8').split('\n').length
  if (lines > 400) warn(f, 'W1', 0, `media module is ${lines} lines — consider splitting`)
  const src = readFileSync(f, 'utf8')
  src.split('\n').forEach((line, i) => {
    if (/TODO|FIXME|XXX/.test(line)) warn(f, 'W2', i + 1, 'debt marker in media engine')
  })
}

// ── report ────────────────────────────────────────────────────────────────
const report = { ranAt: new Date().toISOString(), files: routeFiles.length + serverFiles.length + libFiles.length, errors, warnings, results }
writeFileSync(join(ROOT, 'scripts/media-audit.json'), JSON.stringify(report, null, 2))
console.log(`media-audit: ${routeFiles.length} routes, ${serverFiles.length} server files — ${errors} errors, ${warnings} warnings`)
if (results.length) for (const r of results) console.log(`  [${r.level}] ${r.rule} ${r.file}:${r.line} — ${r.message}`)
if (errors > 0) { console.log('MEDIA AUDIT FAILED'); process.exit(1) }
console.log('MEDIA AUDIT PASS ✓')
