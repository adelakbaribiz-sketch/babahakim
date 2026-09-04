#!/usr/bin/env node
// ── BabaHakim Frontend Architecture Gate (PHASE 09, ED-114) ────────────────
// CI gate enforcing the PHASE 09 standards. Exits 1 on any violation.
// Rules E1..E7 are the audit findings converted to permanent guards:
//   E1  no document.getElementById in components (F21)
//   E2  no lang2() DOM-read helper (F04)
//   E3  client graph must stay Prisma-free: constants imports workflow/pure,
//       pure.ts imports no server-only modules (F03 — verified bundle leak)
//   E4  no swallowed .catch(() => {}) in view components (F04)
//   E5  router/pages 1:1 with the ROUTES registry (F01/F24)
//   E6  view-level authz single source: page.tsx must gate via canViewRoute
//   E7  code splitting: recharts views must be lazy (next/dynamic) (F02)
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const errors = []
const warnings = []
const err = (code, msg) => errors.push(`${code} · ${msg}`)
const warn = (code, msg) => warnings.push(`${code} · ${msg}`)

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules' || name === '.next') continue
      walk(p, acc)
    } else if (/\.(tsx?|jsx?)$/.test(name)) acc.push(p)
  }
  return acc
}

/** Strip line/block comments so the gate never matches its own rule text. */
function codeOnly(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const APP = join(ROOT, 'src/components/app')
const files = walk(APP)

// E1 — imperative DOM reads (F21)
for (const f of files) {
  const s = codeOnly(readFileSync(f, 'utf8'))
  if (s.includes('document.getElementById')) err('E1', `document.getElementById in ${f.replace(ROOT + '/', '')}`)
}

// E2 — lang2 helper (F04)
for (const f of files) {
  const s = codeOnly(readFileSync(f, 'utf8'))
  if (/\blang2\(/.test(s)) err('E2', `lang2() helper in ${f.replace(ROOT + '/', '')} — use t()/lang from useApp()`)
}

// E3 — client graph Prisma-free (F03)
const constants = codeOnly(readFileSync(join(ROOT, 'src/lib/constants.ts'), 'utf8'))
if (constants.includes("from '@/lib/workflow/engine'")) err('E3', 'constants.ts imports workflow/engine — the client graph reaches @/lib/db')
if (!constants.includes("from '@/lib/workflow/pure'")) err('E3', 'constants.ts must import resolveTransition from workflow/pure')
const pure = codeOnly(readFileSync(join(ROOT, 'src/lib/workflow/pure.ts'), 'utf8'))
for (const banned of ["from '@/lib/db'", "from '@/server/", "from 'next/server'"]) {
  if (pure.includes(banned)) err('E3', `workflow/pure.ts imports server-only module (${banned})`)
}
// contexts/app.tsx must import the api-client, not duplicate fetch/CSRF
const ctx = codeOnly(readFileSync(join(ROOT, 'src/contexts/app.tsx'), 'utf8'))
if (!ctx.includes("api-client")) err('E3', 'contexts/app.tsx must delegate HTTP to src/lib/api-client.ts (F08)')

// E4 — swallowed query errors in views (F04)
for (const f of files) {
  const s = codeOnly(readFileSync(f, 'utf8'))
  if (/\.catch\(\(\) => \{\}\)/.test(s)) err('E4', `swallowed .catch(() => {}) in ${f.replace(ROOT + '/', '')} — surface with ErrorState/retry`)
}

// E5/E6 — route registry is the single source (F01/F11/F24)
const page = codeOnly(readFileSync(join(ROOT, 'src/app/page.tsx'), 'utf8'))
const routes = codeOnly(readFileSync(join(ROOT, 'src/components/app/routes.ts'), 'utf8'))
if (!page.includes('canViewRoute')) err('E6', 'page.tsx router must gate views through canViewRoute()')
if (!page.includes('ForbiddenView') || !page.includes('NotFoundView')) err('E6', 'page.tsx must render 403/404 system views')
if (!routes.includes('permission')) err('E5', 'routes.ts must declare per-view permissions')
// nav must filter through the same gate
const shell = codeOnly(readFileSync(join(ROOT, 'src/components/app/AppShell.tsx'), 'utf8'))
if (!shell.includes('canViewRoute')) err('E6', 'AppShell nav must filter items through canViewRoute() — same gate as the router')

// E7 — code splitting (F02)
if (!page.includes("dynamic(")) err('E7', 'page.tsx must lazy-load heavy views via next/dynamic (recharts/DS/workspace)')
if (!page.includes("admin/AdminViews2")) err('E7', 'AdminViews2 (recharts) chunk must be referenced')
for (const f of files) {
  const s = readFileSync(f, 'utf8')
  if (f.endsWith('PatientViews.tsx') && s.includes("from '../CaseWorkspace'")) err('E7', 'CaseWorkspace must stay a lazy chunk — remove eager import from PatientViews')
  if (f.endsWith('StaffViews.tsx') && s.includes("from '../CaseWorkspace'")) err('E7', 'CaseWorkspace must stay a lazy chunk — remove eager import/re-export from StaffViews')
}

// report
const line = '─'.repeat(64)
console.log(line)
console.log(`FRONTEND AUDIT — ${files.length} files scanned (src/components/app + core libs)`)
console.log(line)
if (warnings.length) { console.log(' WARNINGS:'); warnings.forEach((w) => console.log('  ' + w)) }
if (errors.length) {
  console.log(' ERRORS:');
  errors.forEach((e) => console.log('  ' + e))
  console.log(`\n ✗ FAILED — ${errors.length} violation(s)`)
  process.exit(1)
}
console.log(`\n ✓ PASSED — architecture standards enforced (E1..E7)`)
