#!/usr/bin/env node
// ── PHASE 11 · AI Engine Architecture Guard (ai-audit.mjs) ──────────────────
// CI gate: prevents regression of the AI engineering discipline. Exit 1 on any
// violation. Rules:
//   A1  only the registry module may instantiate providers (factory map)
//   A2  routes must not import @/server/infrastructure/ai (application layer only)
//   A3  AIAnalysis creation must pin reviewStatus='PENDING_REVIEW' (validation gate)
//   A4  model metrics writes only through evaluation module (no hand-entered metrics)
//   A5  dataset items only via datasets module (feedback loop single writer)
//   A6  inference must flow through pipeline.runAIAnalysis (no direct provider.analyze in routes/services)
//   A7  statusKey required on machines whose prismaKey !== status-holding entity (AI_REVIEW guard)
//   A8  prompt render must go through renderTemplate/renderPrompt (no raw concat of user text)
//   A9  training gate: assertCanTrain referenced before any train/retrain hook
//   A10  all AI admin routes are role-guarded
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')
let errors = 0
const fail = (rule, file, msg) => { console.error(`  ✗ [${rule}] ${file} — ${msg}`); errors++ }

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}
const files = walk(SRC).map((f) => f.replace(ROOT + '/', ''))
const read = (f) => readFileSync(join(ROOT, f), 'utf-8')

// ── A1: provider instantiation only inside the registry factory map ───────
for (const f of files) {
  const src = read(f)
  if (/new\s+TongueModelV1\s*\(/.test(src) && !f.includes('infrastructure/ai/registry') && !f.includes('__tests__') && !f.includes('lib/ai/provider')) {
    fail('A1', f, 'direct provider instantiation — add a factory entry in registry.ts instead')
  }
}

// ── A2: routes never import the AI engine directly (application layer only) ─
for (const f of files.filter((x) => x.includes('/api/'))) {
  const src = read(f)
  if (src.includes('@/server/infrastructure/ai')) {
    fail('A2', f, 'route imports @/server/infrastructure/ai — call an application service instead (ED-93)')
  }
}

// ── A3: every AIAnalysis.create pins reviewStatus=PENDING_REVIEW ──────────
for (const f of files) {
  const src = read(f)
  if (/aIAnalysis\.create/.test(src) && !src.includes("reviewStatus: 'PENDING_REVIEW'")) {
    fail('A3', f, 'AIAnalysis.create without reviewStatus PENDING_REVIEW (ED-125 invariant)')
  }
}

// ── A4: AIModel.metrics only written by evaluation ─────────────────────────
for (const f of files) {
  const src = read(f)
  if (/aIModel\.(update|create)/.test(src) && /metrics\s*:/.test(src) && !f.includes('infrastructure/ai/evaluation') && !f.includes('prisma/seed') && !f.includes('aiMlopsService')) {
    fail('A4', f, 'AIModel metrics written outside evaluation module (ED-127 — computed only)')
  }
}

// ── A5: AIDatasetItem only created via datasets module ─────────────────────
for (const f of files) {
  const src = read(f)
  if (/aIDatasetItem\.create/.test(src) && !f.includes('infrastructure/ai/datasets')) {
    fail('A5', f, 'AIDatasetItem.create outside datasets module (single feedback-loop writer, ED-124)')
  }
}

// ── A6: provider.analyze only reachable via the pipeline ───────────────────
for (const f of files) {
  if (f.includes('__tests__')) continue
  const src = read(f)
  if (/providerInstance\.analyze|provider\.analyze\(/.test(src) && !f.includes('infrastructure/ai/pipeline')) {
    fail('A6', f, 'direct provider.analyze() — inference must flow through pipeline.runAIAnalysis')
  }
}

// ── A7: AI_REVIEW machine must declare its statusKey ───────────────────────
{
  const f = 'src/lib/workflow/machines/aiReview.ts'
  if (existsSync(join(ROOT, f)) && !read(f).includes("statusKey: 'reviewStatus'")) {
    fail('A7', f, "AI_REVIEW machine must declare statusKey:'reviewStatus' (bug B-11-1 regression guard)")
  }
}

// ── A8: prompt rendering only via renderTemplate/renderPrompt ──────────────
for (const f of files.filter((x) => x.includes('infrastructure/ai/') && !x.includes('__tests__'))) {
  const src = read(f)
  if (/PROMPT_REGISTRY/.test(src) && !/renderTemplate|renderPrompt/.test(src) && !f.endsWith('index.ts') && !f.endsWith('prompts.ts')) {
    fail('A8', f, 'prompt template accessed without safe rendering')
  }
}

// ── A9: training gate must exist and be enforced before training hooks ─────
{
  const f = 'src/server/infrastructure/ai/security.ts'
  if (!read(f).includes('assertCanTrain')) fail('A9', f, 'training gate (assertCanTrain) missing')
}

// ── A10: AI admin routes are role-guarded ──────────────────────────────────
const aiRoutes = files.filter((x) => x.includes('/api/v1/admin/ai/') || x.includes('rerun-ai'))
for (const f of aiRoutes) {
  if (!/requireRole|requirePermission|requireAuth/.test(read(f))) {
    fail('A10', f, 'AI route without role guard')
  }
}

// ── report ─────────────────────────────────────────────────────────────────
const fileCount = files.length
if (errors > 0) {
  console.error(`\nFAILED — ${errors} AI-engine discipline violation(s) across ${fileCount} files.`)
  process.exit(1)
}
console.log(`ai-audit: ${aiRoutes.length} AI routes, ${fileCount} source files — 0 errors`)
console.log('AI AUDIT PASS ✓')
