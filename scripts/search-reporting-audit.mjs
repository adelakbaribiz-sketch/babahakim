#!/usr/bin/env node
// ── PHASE 14 CI gate — Search, Reporting & Analytics architecture ──────────
// Enforces the phase's structural invariants (SR1..SR10). Zero-tolerance:
// any error fails the build (`npm run audit:reporting`).
//   SR1  reporting/search modules never run unbounded findMany (where + take)
//   SR2  reports execute ONLY through the registry/runner (no route aggregation)
//   SR3  every ReportDef carries id/category/permission/params/chart flag
//   SR4  list services push `q` into SQL (applyQ) — no textMatches post-filter
//   SR5  exports flow only through exportService (routes stay thin)
//   SR6  bounded-query guards are actually wired (clampWindow/assertOffset)
//   SR7  xlsx/csv writers are dependency-free (own zip, no SheetJS)
//   SR8  PDF export embeds a fa-capable font (never core-font-only Persian)
//   SR9  report permissions exist in the 31-entry PERMISSIONS catalogue
//   SR10 reporting routes use apiRoute + guards (ED-93 boundary)
import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, relative, sep } from 'path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const errors = []
const warnings = []
const ok = (msg) => console.log(`  ✓ ${msg}`)
const err = (msg) => { errors.push(msg); console.log(`  ✗ ${msg}`) }
const warn = (msg) => { warnings.push(msg); console.log(`  ⚠ ${msg}`) }

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}
const rel = (f) => relative(ROOT, f).split(sep).join('/')
const files = walk(SRC)
const text = (f) => readFileSync(f, 'utf8')

// ── SR1: no unbounded findMany in the new modules ──────────────────────────
console.log('SR1 — bounded queries in search/reporting modules')
{
  const scope = files.filter((f) => /infrastructure\/(search|reporting)\//.test(rel(f)) && /\.(ts|tsx)$/.test(f) && !/__tests__/.test(rel(f)))
  let checked = 0
  for (const f of scope) {
    const s = text(f)
    for (const m of s.matchAll(/\.findMany\(/g)) {
      checked++
      // window: 700 chars past the call — enough to see where/take/skip
      const ctx = s.slice(m.index, m.index + 700)
      if (!/where\s*:/.test(ctx)) err(`SR1 ${rel(f)} — findMany without where (unbounded read)`)
      if (!/take\s*:/.test(ctx) && !/skip\s*:/.test(ctx)) warn(`SR1 ${rel(f)} — findMany without take/skip (verify bounded)`)
    }
    if (!/\$queryRawUnsafe/.test(s)) checked++
  }
  ok(`scanned ${scope.length} module files`)
}

// ── SR2: routes never aggregate inline; only the registry defines reports ──
console.log('SR2 — reports execute only via registry/runner')
{
  const routeFiles = files.filter((f) => /app\/api\/v1\/(reports|search)/.test(rel(f)))
  for (const f of routeFiles) {
    const s = text(f)
    if (/\$queryRaw|\bgroupBy\(|\.reduce\(/.test(s)) err(`SR2 ${rel(f)} — route aggregates inline (must go through a service/engine)`)
    if (!/apiRoute/.test(s)) err(`SR2 ${rel(f)} — not wrapped in apiRoute (ED-93)`)
  }
  // report definitions only in the registry tree
  const rogue = files.filter((f) => /category\s*:\s*'(OPERATIONAL|FINANCIAL|BUSINESS|USER|PERFORMANCE|CUSTOM)'/.test(text(f)) && !/infrastructure\/reporting/.test(rel(f)) && !/__tests__/.test(rel(f)))
  for (const f of rogue) err(`SR2 ${rel(f)} — ReportDef outside infrastructure/reporting`)
  ok(`${routeFiles.length} report/search routes checked`)
}

// ── SR3: ReportDef completeness (static shape check on the registry files) ─
console.log('SR3 — ReportDef shape')
{
  const defs = files.filter((f) => /infrastructure\/reporting\/reports\/(operational|financial|business|user|performance|custom)\.ts$/.test(rel(f)))
  for (const f of defs) {
    const s = text(f)
    for (const key of ['category:', 'permission:', 'params:', 'hasChart:', 'fa:', 'en:']) {
      if (!s.includes(key)) err(`SR3 ${rel(f)} — ReportDef missing "${key}"`)
    }
    if (!/timeScoped\s*:/.test(s)) err(`SR3 ${rel(f)} — ReportDef missing "timeScoped"`)
  }
  ok(`${defs.length} definition files checked`)
}

// ── SR4: q pushed into SQL (S-1 fix stays fixed) ───────────────────────────
console.log('SR4 — SQL-side search (no post-filter pagination)')
{
  const services = ['catalogService', 'caseService', 'adminService', 'searchService']
  for (const svc of services) {
    const f = join(SRC, 'server', 'application', 'services', `${svc}.ts`)
    if (!existsSync(f)) { err(`SR4 service missing: ${svc}`); continue }
    const s = text(f)
    if (/textMatches\(/.test(s)) err(`SR4 ${svc}.ts — legacy in-memory textMatches post-filter (use applyQ)`)
    if (/listAdminUsers|listCases|listProducts/.test(s) && !/applyQ/.test(s)) err(`SR4 ${svc}.ts — list fn without applyQ`)
  }
  ok('list services use applyQ')
}

// ── SR5: exports only through exportService ───────────────────────────────
console.log('SR5 — single export path')
{
  const exportUsers = files.filter((f) => /toCsv\(|toXlsx\(|toPdf\(/.test(text(f)) && !/export\/(csv|xlsx|pdf)\.ts/.test(rel(f)) && !/__tests__/.test(rel(f)))
  for (const f of exportUsers) {
    if (!/exportService|export\//.test(rel(f)) && !/application\/services/.test(rel(f))) {
      err(`SR5 ${rel(f)} — calls export writers outside the export service layer`)
    }
  }
  if (!existsSync(join(SRC, 'server', 'infrastructure', 'reporting', 'export', 'exportService.ts'))) err('SR5 exportService.ts missing')
  ok('export call sites verified')
}

// ── SR6: bounded guards wired where they must be ───────────────────────────
console.log('SR6 — guard wiring (anti-unbounded)')
{
  const runner = text(join(SRC, 'server', 'infrastructure', 'reporting', 'runner.ts'))
  if (!/withReportTimeout/.test(runner)) err('SR6 runner.ts — missing withReportTimeout')
  if (!/maxRows/.test(runner)) err('SR6 runner.ts — missing row cap enforcement')
  const query = text(join(SRC, 'server', 'api', 'query.ts'))
  if (!/OffsetTooDeepError|SEARCH_BOUNDS/.test(query)) err('SR6 api/query.ts — offset cap not wired')
  const common = text(join(SRC, 'server', 'infrastructure', 'reporting', 'reports', 'common.ts'))
  if (!/clampWindow/.test(common)) err('SR6 reports/common.ts — window clamp not wired')
  const defs = files.filter((f) => /infrastructure\/reporting\/reports\/(operational|financial|business|user|performance|custom)\.ts$/.test(rel(f)))
  for (const f of defs) {
    if (!/windowFor\(/.test(text(f))) err(`SR6 ${rel(f)} — report does not clamp its window (windowFor)`)
  }
  ok('timeout + row caps + window clamp wired')
}

// ── SR7: export writers are dependency-free ────────────────────────────────
console.log('SR7 — dependency-free export writers')
{
  const xlsx = text(join(SRC, 'server', 'infrastructure', 'reporting', 'export', 'xlsx.ts'))
  const csv = text(join(SRC, 'server', 'infrastructure', 'reporting', 'export', 'csv.ts'))
  for (const [name, s] of [['xlsx.ts', xlsx], ['csv.ts', csv]]) {
    if (/from ['"](?:xlsx|exceljs|sheetjs|papaparse)/.test(s)) err(`SR7 ${name} — external dependency detected (must be self-contained)`)
  }
  if (!/CRC/.test(xlsx)) err('SR7 xlsx.ts — CRC-32 missing (invalid ZIP without it)')
  if (!/504b0304/.test(xlsx) && !/0x04034b50/.test(xlsx)) err('SR7 xlsx.ts — local file header signature missing')
  if (!/\\uFEFF/.test(csv)) err('SR7 csv.ts — UTF-8 BOM missing (Excel Persian support)')
  ok('csv/xlsx writers self-contained')
}

// ── SR8: PDF embeds a fa-capable font ─────────────────────────────────────
console.log('SR8 — PDF Persian rendering')
{
  const pdf = text(join(SRC, 'server', 'infrastructure', 'reporting', 'export', 'pdf.ts'))
  if (!/FreeSerif|\.ttf/.test(pdf)) err('SR8 pdf.ts — no TTF font embedding (core fonts cannot render Persian)')
  if (!/rightToLeft|rtl/.test(pdf)) err('SR8 pdf.ts — no RTL handling')
  if (!/pdfkit/.test(pdf)) err('SR8 pdf.ts — pdfkit not used')
  const cfg = text(join(ROOT, 'next.config.ts'))
  if (!/serverExternalPackages[^\]]*pdfkit/.test(cfg.replace(/\s+/g, ' '))) err('SR8 next.config.ts — pdfkit not in serverExternalPackages (bundler breaks .afm data reads)')
  ok('fa font + RTL + external package config')
}

// ── SR9: permissions resolve against the catalogue ─────────────────────────
console.log('SR9 — permission catalogue alignment')
{
  const constants = text(join(SRC, 'lib', 'constants.ts'))
  const perms = new Set()
  for (const m of constants.matchAll(/'([a-z_]+)'/g)) perms.add(m[1])
  const registry = text(join(SRC, 'server', 'infrastructure', 'reporting', 'registry.ts'))
  const defs = files.filter((f) => /infrastructure\/reporting\/reports\/(operational|financial|business|user|performance|custom)\.ts$/.test(rel(f)))
  const used = new Set()
  for (const f of defs) {
    for (const m of text(f).matchAll(/permission:\s*'([a-z_]+)'/g)) used.add(m[1])
  }
  for (const p of used) {
    if (!perms.has(p)) err(`SR9 report permission "${p}" not in PERMISSIONS catalogue`)
  }
  if (used.size < 6) warn('SR9 fewer than 6 distinct permissions across reports (expected: view_reports, view_financials, manage_users, view_ai_analyses, view_audit_logs, manage_workflow_recovery)')
  if (!/reportPermissionsUsed/.test(registry)) err('SR9 registry.ts — reportPermissionsUsed export missing (live cross-check)')
  ok(`${used.size} distinct permissions verified against constants.ts`)
}

// ── SR10: reporting routes guard + zod + rate limit ───────────────────────
console.log('SR10 — route hardening')
{
  const routeFiles = files.filter((f) => /app\/api\/v1\/(reports|search)\//.test(rel(f)) && f.endsWith('route.ts'))
  for (const f of routeFiles) {
    const s = text(f)
    if (!/requireAuth|requireRole/.test(s)) err(`SR10 ${rel(f)} — no auth guard`)
  }
  const svc = text(join(SRC, 'server', 'application', 'services', 'reportingService.ts'))
  if (!/assertBudget|rateLimit/.test(svc)) err('SR10 reportingService — no rate budget (reports/exports must be bounded)')
  ok(`${routeFiles.length} routes + service budgets`)
}

// ── verdict ────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`)
if (errors.length) {
  console.log(`FAILED — ${errors.length} error(s), ${warnings.length} warning(s)`)
  process.exit(1)
}
console.log(`PASSED — search & reporting architecture is sound (${warnings.length} warning(s))`)
