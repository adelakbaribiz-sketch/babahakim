#!/usr/bin/env node
// ── BabaHakim Backend Architecture Audit (PHASE 08, ED-105) ───────────────
// CI gate that keeps controllers THIN. Mirrors scripts/ui-audit.mjs for the
// backend: exit 1 on any violation, JSON report to scripts/backend-audit.json.
//
// Rules (route files under src/app/api/**):
//   E1 routes import only from allowed modules (no @/lib/db, no @/server/infrastructure)
//   E2 no notify() calls in routes (events only)
//   E3 no workflow executeTransition/applyTransition in routes
//   E4 no business-code minting (genCode) or business JSON.stringify in routes
//   E5 mutating methods parse their body with zod (parseBody/safeParse/parse)
//   E6 handlers are built with apiRoute() (central envelope/logging/versioning)
//   E7 auth is enforced via guards (requireAuth/requireRole/requirePermission)
//   E8 list endpoints use parseListQuery (pagination contract)
//   W1 route file > 80 lines (controller should be thin)
//   W2 TODO/PHASE debt markers
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const API_DIR = join(ROOT, 'src/app/api')

const results = []
let errors = 0, warnings = 0

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (name === 'route.ts') out.push(p)
  }
  return out
}

const ALLOWED_IMPORTS = [
  '@/server/api/handler', '@/server/api/guards', '@/server/api/query', '@/server/api/envelope', '@/server/api/schemas',
  '@/server/application/dto', '@/server/application/services',
  '@/server/core/errors', 'next/server', 'zod',
]

function fail(file, rule, line, msg) {
  errors++
  results.push({ file: rel(file), rule, line, message: msg, level: 'error' })
}
function warn(file, rule, line, msg) {
  warnings++
  results.push({ file: rel(file), rule, line, message: msg, level: 'warn' })
}
const rel = (f) => f.replace(ROOT + '/', '')

for (const file of walk(API_DIR)) {
  const src = readFileSync(file, 'utf8')
  const lines = src.split('\n')
  const linesOf = (re) => lines.map((l, i) => (re.test(l) ? i + 1 : 0)).filter(Boolean)

  // E1 — import discipline
  const importRe = /from\s+['"]([^'"]+)['"]/g
  let m
  while ((m = importRe.exec(src))) {
    const spec = m[1]
    if (spec.startsWith('@/lib/') || spec.startsWith('@/server/infrastructure') || spec.startsWith('@/server/domain')) {
      // permitted shared-kernel exceptions are NONE for routes post-refactor
      fail(file, 'E1', null, `route imports forbidden module: ${spec}`)
    } else if (spec.startsWith('@/server/') && !ALLOWED_IMPORTS.some((a) => spec === a || spec.startsWith(a + '/'))) {
      fail(file, 'E1', null, `route imports non-API-layer module: ${spec}`)
    }
  }

  // E2 — no notify in routes
  for (const ln of linesOf(/\bnotify\s*\(/)) fail(file, 'E2', ln, 'routes must publish events, not call notify()')

  // E3 — no workflow engine in routes
  for (const ln of linesOf(/executeTransition|applyTransition/)) fail(file, 'E3', ln, 'workflow transitions belong in application services')

  // E4 — no business code minting / business serialization in routes
  for (const ln of linesOf(/\bgenCode\s*\(/)) fail(file, 'E4', ln, 'business codes are minted in the application layer')
  for (const ln of linesOf(/JSON\.stringify/)) fail(file, 'E4', ln, 'business snapshots are serialized in the application layer')

  // E6 — handlers wrapped in apiRoute
  const exportedHandlers = lines.filter((l) => /^export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)/.test(l))
  if (exportedHandlers.length > 0) fail(file, 'E6', null, `exported raw handler function(s) — must be wrapped with apiRoute(): ${exportedHandlers.length}`)
  if (!/apiRoute\s*[<(]/.test(src)) fail(file, 'E6', null, 'no apiRoute() usage found in route file')

  // E5 — mutating methods zod-parse (endpoints whose body is by-design empty are exempt)
  const BODYLESS = file.includes('auth/refresh') || file.includes('auth/logout') || file.includes('zarinpal')
  const hasMutating = /^export\s+(const|let)\s+(POST|PUT|PATCH|DELETE)\s*=/m.test(src)
  const hasParse = /parseBody\s*\(|\.safeParse\s*\(|\.parse\s*\(/.test(src)
  if (hasMutating && !hasParse && !BODYLESS) fail(file, 'E5', null, 'mutating handler does not zod-parse its input (parseBody)')

  // E7 — guards (auth endpoints ARE the auth flow; image files authorize in-service)
  const AUTH_FLOW = file.includes('/auth/') || file.includes('zarinpal') || file.endsWith(join('api/v1/products/route.ts')) || file.includes('images/[id]/file') || file.includes('files/[id]/content') // PHASE 10: public/signed renditions authorize in-service
  const hasGuard = /requireAuth|requireRole|requirePermission/.test(src)
  if (!AUTH_FLOW && !hasGuard) fail(file, 'E7', null, 'no authorization guard in route')

  // E8 — list endpoints paginate (warnings only)
  // Whitelist: singleton/aggregate/bounded read models (dashboard, profile, cart,
  // consents, exports, active questionnaire, reports, capped backoffice lists).
  const SINGLETONS = [
    'admin/ai-models', 'admin/deletion-requests', 'admin/diseases', 'admin/prices',
    'admin/products', 'admin/reports', 'admin/sms-log', 'auth/me', 'cart', 'dashboard',
    'patients/profile', 'privacy/consents', 'privacy/deletion-request', 'privacy/export',
    'questionnaires/active', 'questionnaires/history', 'followups',
    'admin/media/stats', // PHASE 10: aggregate read model, not a collection
  ]
  const isSingleton = SINGLETONS.some((s) => file.includes(s))
  const isListEndpoint = /^export\s+const\s+GET\s*=\s*apiRoute/m.test(src) && !/parseListQuery/.test(src) && !/\[id\]/.test(file)
  if (isListEndpoint && !isSingleton && !file.includes('zarinpal')) {
    warn(file, 'E8', null, 'GET collection without parseListQuery — verify non-list semantics')
  }

  // W1 — file size
  const n = lines.length
  if (n > 80) warn(file, 'W1', null, `route file is ${n} lines — controllers should stay thin (<80)`)

  // W2 — debt markers
  for (const ln of linesOf(/TODO|FIXME|PHASE-\d+ debt/i)) warn(file, 'W2', ln, 'debt marker present')
}

// summary
const report = {
  tool: 'backend-audit', generatedAt: new Date().toISOString(),
  files: walk(API_DIR).length, errors, warnings, results,
}
writeFileSync(join(ROOT, 'scripts/backend-audit.json'), JSON.stringify(report, null, 2))

console.log(`Backend architecture audit — ${report.files} route files`)
console.log(`  E-errors: ${errors}   W-warnings: ${warnings}`)
for (const r of results) {
  const icon = r.level === 'error' ? '✗' : '⚠'
  console.log(`  ${icon} [${r.rule}] ${r.file}${r.line ? ':' + r.line : ''} — ${r.message}`)
}
if (errors > 0) {
  console.log('\nFAILED — controllers must stay thin (ED-93/105). Fix violations above.')
  process.exit(1)
}
console.log('\nPASSED — zero architectural violations.')
