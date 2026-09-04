#!/usr/bin/env node
/**
 * BabaHakim UI Consistency Audit — PHASE 07 (ED-90)
 * ---------------------------------------------------------------------------
 * Enforces the design-token contract (Master Branding §27/§39):
 *   E1  no arbitrary Tailwind hex classes anywhere in src/
 *   E2  no raw Tailwind palette classes in the app surface (ui/ vendored
 *       primitives are exempt except hex + stale hsl(var()) patterns)
 *   E3  no raw hex/rgba literals outside the token sources (comments ignored)
 *   E4  no stale `hsl(var(--token))` wrappers (tokens are hex since v4)
 *   E5  no physical-direction utilities in the app surface (RTL rule §24)
 *   E6  token sync: every hex in tokens.ts must exist in globals.css and
 *       the 4 non-negotiable brand hexes must exist in tokens.ts (§39)
 *   E7  WCAG contrast gates for all declared text/chip pairs (§34)
 *   W1  duplicated long className literals (≥ 40 chars, ≥ 3 occurrences)
 *   W2  emoji used as icons in the app surface (icon policy: lucide only)
 *
 * Usage: node scripts/ui-audit.mjs   (or `bun run audit:ui`)
 * Exit code 1 on any E* violation. Report → scripts/ui-audit-report.json
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const REPORT_PATH = join(ROOT, 'scripts', 'ui-audit-report.json')

// ── configuration ──────────────────────────────────────────────────────────
const TOKEN_SOURCES = ['src/app/globals.css', 'src/design-system/tokens.ts', 'src/design-system/index.ts']
// Style-guide views DISPLAY token hex values as living documentation (ED-85) — E3-exempt
const DOC_DISPLAY_VIEWS = ['src/components/app/views/DesignSystemView.tsx', 'src/components/app/views/ds/DsShowcase.tsx']
const VENDORED_UI = `${sep}components${sep}ui${sep}` // shadcn primitives: relaxed rules
const PALETTE = '(?:slate|gray|zinc|stone|neutral|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)'
const RE = {
  hexClass: /\b(?:bg|text|border|ring|fill|stroke|from|via|to|shadow|accent|outline|decoration|caret)-\[#[0-9A-Fa-f]{3,8}(?:\/\d+)?\]/g,
  paletteClass: new RegExp(`\\b(?:bg|text|border|accent|divide|outline|decoration|ring|shadow|from|via|to|fill|stroke|caret)-${PALETTE}-\\d{2,3}\\b`, 'g'),
  hexLiteral: /#[0-9A-Fa-f]{6}\b/g,
  rgbaLiteral: /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+/g,
  staleHsl: /hsl\(var\(/g,
  physicalDir: /\b(?:ml|mr|pl|pr)-(?:\d+|auto|px|full|screen)\b|\b(?:left|right)-(?:\d+|auto|px|full)\b|\btext-(?:left|right)\b/g,
  classNameLiteral: /className="([^"]{40,})"/g,
  emoji: /[\u{1F300}-\u{1FAFF}]/gu, // pictographs only; ✓/✗/⚠ are text glyphs, allowed
}
const COMMENT_PREFIX = /^\s*(?:\/\/|\*|\/\*|\*\/)/

const errors = [], warnings = [], infos = []
const classCounts = new Map()

// ── file walker ────────────────────────────────────────────────────────────
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/\.(tsx?|css)$/.test(name)) out.push(p)
  }
  return out
}

function lineOf(content, index) { return content.slice(0, index).split('\n').length }
function stripComments(content) {
  return content.split('\n').filter((l) => !COMMENT_PREFIX.test(l)).join('\n')
}

// ── E1..E5, W1, W2 — source scan ──────────────────────────────────────────
for (const file of walk(SRC)) {
  const rel = relative(ROOT, file).split(sep).join('/')
  if (TOKEN_SOURCES.includes(rel)) continue
  const isVendored = file.includes(VENDORED_UI)
  const raw = readFileSync(file, 'utf8')
  const code = stripComments(raw)
  const rawNoComments = code // for index math

  const check = (re, severity, msg, useRaw = false) => {
    const hay = useRaw ? raw : code
    let m
    const pattern = new RegExp(re.source, re.flags)
    while ((m = pattern.exec(hay)) !== null) {
      const ln = hay === raw ? lineOf(raw, m.index) : lineOf(code, m.index)
      ;(severity === 'E' ? errors : warnings).push({ file: rel, line: ln, rule: msg, match: m[0] })
    }
  }

  check(RE.hexClass, 'E', 'E1 arbitrary hex Tailwind class')
  check(RE.staleHsl, 'E', 'E4 stale hsl(var(--token)) — tokens are hex (v4)')
  if (!DOC_DISPLAY_VIEWS.includes(rel)) {
    // E3: raw hex literals — comment-stripped; white (#FFFFFF) allowed as base surface (§5)
    let m
    const pattern = new RegExp(RE.hexLiteral.source, 'g')
    while ((m = pattern.exec(code)) !== null) {
      if (m[0].toUpperCase() === '#FFFFFF') continue
      errors.push({ file: rel, line: lineOf(code, m.index), rule: 'E3 raw hex literal outside token sources', match: m[0] })
    }
  }
  check(RE.rgbaLiteral, 'E', 'E3 raw rgba() outside token sources')
  if (!isVendored) {
    check(RE.paletteClass, 'E', 'E2 raw Tailwind palette class — use design tokens')
    check(RE.physicalDir, 'E', 'E5 physical-direction utility — use logical (ms/me/ps/pe/start/end)')
    check(RE.emoji, 'W', 'W2 emoji as icon — lucide icons only')
  }

  // W1 — duplicate className literals
  if (!isVendored) {
    let m
    const pattern = new RegExp(RE.classNameLiteral.source, 'g')
    while ((m = pattern.exec(code)) !== null) {
      const key = m[1]
      classCounts.set(key, (classCounts.get(key) || 0) + 1)
    }
  }
}

for (const [cls, n] of classCounts) {
  if (n >= 3) warnings.push({ rule: 'W1 duplicated className literal', count: n, match: cls.slice(0, 90) + (cls.length > 90 ? '…' : '') })
}

// ── E6 — token sync (globals.css ⇄ tokens.ts) ─────────────────────────────
const css = readFileSync(join(ROOT, 'src/app/globals.css'), 'utf8')
const tokensTs = readFileSync(join(ROOT, 'src/design-system/tokens.ts'), 'utf8')
const cssHexes = new Set((css.match(/#[0-9A-Fa-f]{6}\b/g) || []).map((h) => h.toUpperCase()))
const tsHexes = new Set((tokensTs.match(/#[0-9A-Fa-f]{6}\b/g) || []).map((h) => h.toUpperCase()))
for (const h of tsHexes) if (!cssHexes.has(h)) errors.push({ rule: 'E6 token drift: hex in tokens.ts missing from globals.css', match: h })
const BRAND4 = ['#173F76', '#225BBE', '#57AFE2', '#DEDBDB']
for (const h of BRAND4) if (!tsHexes.has(h)) errors.push({ rule: 'E6 brand color missing in tokens.ts (§39)', match: h })

// ── E7 — WCAG contrast gates (§34) ─────────────────────────────────────────
const lum = (hex) => {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a, b) => { const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x); return (l1 + 0.05) / (l2 + 0.05) }

const TEXT_PAIRS = [ // [fg, bg, label, minRatio]
  ['#0F2A50', '#FFFFFF', 'light: foreground on background', 4.5],
  ['#5B6F91', '#FFFFFF', 'light: muted-foreground on background', 4.5],
  ['#5B6F91', '#F4F3F3', 'light: muted-foreground on muted', 4.5],
  ['#225BBE', '#FFFFFF', 'light: primary link text on background', 4.5],
  ['#173F76', '#E7F1FA', 'light: secondary-foreground on secondary', 4.5],
  ['#D5E1F0', '#173F76', 'light: sidebar-foreground on sidebar', 4.5],
  ['#FFFFFF', '#173F76', 'light: white on brand-dark', 4.5],
  ['#E7EEF8', '#0D1B30', 'dark: foreground on background', 4.5],
  ['#8FA5C2', '#0D1B30', 'dark: muted-foreground on background', 4.5],
  ['#8FA5C2', '#12233C', 'dark: muted-foreground on card', 4.5],
  ['#CFE4F5', '#1A2E4D', 'dark: secondary-foreground on secondary', 4.5],
  ['#CFE4F5', '#0F2440', 'dark: sidebar-foreground on sidebar', 4.5],
  ['#F87171', '#0D1B30', 'dark: destructive on background', 4.5],
  ['#0F2A50', '#57AFE2', 'dark: primary-foreground on primary', 4.5],
  ['#57AFE2', '#0D1B30', 'dark: primary text on background', 4.5],
  ['#4ADE80', '#0D1B30', 'dark: status-success-text', 4.5],
  ['#E8A94D', '#0D1B30', 'dark: status-warning-text', 4.5],
  ['#F87171', '#12233C', 'dark: status-danger-text on card', 4.5],
]
const CHIP_PAIRS = [ // status chips — mode-invariant, ≥ 4.5 for AA small text
  ['#122F5C', '#57AFE2', 'status info chip', 4.5],
  ['#FFFFFF', '#225BBE', 'status progress chip', 4.5],
  ['#FFFFFF', '#157347', 'status success chip', 4.5],
  ['#FFFFFF', '#B45309', 'status warning chip', 4.5],
  ['#FFFFFF', '#B91C1C', 'status danger chip', 4.5],
  ['#FFFFFF', '#3F5070', 'status neutral chip', 4.5],
  ['#FFFFFF', '#173F76', 'status navy chip', 4.5],
  ['#FFFFFF', '#6D28D9', 'status revision chip', 4.5],
  ['#DC2626', '#FFFFFF', 'light: destructive text on background', 4.5],
]
const UI_PAIRS = [ // component boundaries / large text — ≥ 3.0
  ['#173F76', '#57AFE2', 'accent button text (AA-large / UI only — ED-87)', 3.0],
  ['#1D6BB5', '#FFFFFF', 'status-info-text on light bg', 4.5],
  ['#157347', '#FFFFFF', 'status-success-text on light bg', 4.5],
  ['#B45309', '#FFFFFF', 'status-warning-text on light bg', 4.5],
  ['#B91C1C', '#FFFFFF', 'status-danger-text on light bg', 4.5],
]
const contrastResults = []
for (const [fg, bg, label, min] of [...TEXT_PAIRS, ...CHIP_PAIRS, ...UI_PAIRS]) {
  const r = ratio(fg, bg)
  contrastResults.push({ label, fg, bg, ratio: +r.toFixed(2), min, pass: r >= min })
  if (r < min) errors.push({ rule: `E7 contrast ${label}: ${r.toFixed(2)} < ${min}`, match: `${fg} on ${bg}` })
}

// ── report ─────────────────────────────────────────────────────────────────
const report = {
  generatedAt: new Date().toISOString(),
  phase: 'PHASE 07 — UI System consistency audit',
  filesScanned: walk(SRC).length,
  errors: errors.length,
  warnings: warnings.length,
  contrast: { checked: contrastResults.length, failed: contrastResults.filter((c) => !c.pass).length },
  details: { errors, warnings },
  contrastResults,
}
if (!existsSync(join(ROOT, 'scripts'))) mkdirSync(join(ROOT, 'scripts'))
writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2))

// console summary
const fmt = (arr) => arr.slice(0, 40).map((e) => `  ${e.rule}${e.match ? ` · ${e.match}` : ''}${e.file ? ` · ${e.file}:${e.line ?? ''}` : ''}${e.count ? ` ×${e.count}` : ''}`).join('\n')
console.log(`\n BabaHakim UI Consistency Audit — PHASE 07`)
console.log(` files scanned : ${report.filesScanned}`)
console.log(` errors        : ${errors.length}`)
console.log(` warnings      : ${warnings.length}`)
console.log(` contrast pairs: ${contrastResults.length} checked, ${report.contrast.failed} failed`)
if (errors.length) console.log(`\n ERRORS:\n${fmt(errors)}`)
if (warnings.length) console.log(`\n WARNINGS:\n${fmt(warnings)}`)
console.log(`\n report → ${relative(ROOT, REPORT_PATH)}`)
if (errors.length) { console.log('\n ✗ AUDIT FAILED — fix violations above (§27/§39 token contract)'); process.exit(1) }
console.log('\n ✓ AUDIT PASSED — UI is token-consistent (§35 brand consistency)')
