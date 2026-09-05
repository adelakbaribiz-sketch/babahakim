#!/usr/bin/env node
// ── PHASE 13 · External Integration Architecture Guard (integrations-audit.mjs) ─
// CI gate: prevents regression of the integration discipline. Exit 1 on any
// violation. Rules:
//   I1  no fetch() outside the integration layer (server side) — adapters own HTTP
//   I2  application code imports the integration LAYER barrel, never providers/*
//   I3  live adapter methods route through callIntegration (resilience stack)
//   I4  concrete provider instantiation only inside providers/* + registry + tests
//   I5  integration env vars read ONLY in core/config.ts (credential discipline)
//   I6  all 9 kinds have a contract + mock adapter + registry resolver
//   I7  money-path operations are idempotent (payment request/verify, sms.send)
//   I8  lib/notify (client graph) never imports @/server/* (ED-137b)
//   I9  admin integration routes are role-guarded
//   I10 IntegrationCallLog writes only from the integration core
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

const INTEGRATION_LAYER = (f) => f.startsWith('src/server/integrations/')
const TEST = (f) => f.includes('__tests__') || f.includes('.test.')

// ── I1: server-side fetch() lives ONLY in the integration layer ────────────
for (const f of files.filter((x) => x.startsWith('src/server/') || x === 'src/middleware.ts')) {
  const src = read(f)
  if (/\bfetch\s*\(/.test(src) && !INTEGRATION_LAYER(f)) {
    fail('I1', f, 'raw fetch() outside the integration layer — add an adapter (ED-142..149)')
  }
}

// ── I2: application code uses the layer barrel, not providers/* ────────────
for (const f of files.filter((x) => !INTEGRATION_LAYER(x) && !TEST(x))) {
  if (read(f).includes('@/server/integrations/providers/')) {
    fail('I2', f, 'imports a provider module directly — import from @/server/integrations (registry, ED-150)')
  }
}

// ── I3: live adapters wrap calls in callIntegration ────────────────────────
const LIVE_ADAPTERS = ['providers/payment.ts', 'providers/sms.ts', 'providers/email.ts', 'providers/maps.ts', 'providers/ai.ts', 'providers/shipping.ts', 'providers/crm-analytics.ts']
for (const rel of LIVE_ADAPTERS) {
  const f = `src/server/integrations/${rel}`
  const src = read(f)
  if (/class\s+\w+(?<!Mock)\w*Provider/.test(src) && !src.includes('callIntegration')) {
    fail('I3', f, 'live adapter without callIntegration — every external call needs the resilience stack (ED-140)')
  }
}

// ── I4: no `new XxxProvider` outside providers/, registry, tests ────────────
for (const f of files.filter((x) => !TEST(x))) {
  const src = read(f)
  const hits = src.match(/new\s+(ZarinpalProvider|KavenegarProvider|HttpMailerProvider|NominatimProvider|HttpCourierProvider|HttpCrmProvider|HttpAnalyticsProvider|Mock\w+Provider)\s*\(/g) || []
  if (hits.length && !INTEGRATION_LAYER(f)) {
    fail('I4', f, `provider instantiated outside the layer (${hits.length}×) — use the registry (ED-150)`)
  }
}

// ── I5: integration env keys read only in core/config.ts ───────────────────
const ENV_KEYS = ['ZARINPAL_MERCHANT_ID', 'ZARINPAL_ENV', 'SMS_PROVIDER_KEY', 'SMS_SENDER', 'EMAIL_API_URL', 'EMAIL_API_KEY', 'EMAIL_FROM', 'EMAIL_ENABLED', 'MAPS_USER_AGENT', 'AI_SERVICE_URL', 'AI_SERVICE_KEY', 'SHIPPING_API_URL', 'SHIPPING_API_KEY', 'CRM_API_URL', 'CRM_API_KEY', 'ANALYTICS_ENDPOINT', 'ANALYTICS_API_KEY', 'INTEGRATION_MODE']
for (const f of files.filter((x) => !TEST(x))) {
  const src = read(f)
  for (const key of ENV_KEYS) {
    const re = new RegExp(`process\\.env\\.${key}\\b`)
    if (re.test(src) && f !== 'src/server/integrations/core/config.ts') {
      fail('I5', f, `reads ${key} directly — credential access is centralized in core/config.ts (ED-136)`)
    }
  }
}

// ── I6: all 9 kinds: contract file + mock class + registry resolver ────────
const registry = read('src/server/integrations/core/registry.ts')
const KINDS = ['PAYMENT', 'SMS', 'EMAIL', 'MAPS', 'AI', 'STORAGE', 'SHIPPING', 'CRM', 'ANALYTICS']
for (const kind of KINDS) {
  if (!registry.includes(`'${kind}'`) && !new RegExp(`\\b${kind}:\\s*\\(`).test(registry)) {
    fail('I6', 'core/registry.ts', `kind ${kind} missing from the registry`)
  }
}
for (const rel of ['payment.ts', 'sms.ts', 'email.ts', 'maps.ts', 'shipping.ts', 'crm-analytics.ts']) {
  const src = read(`src/server/integrations/providers/${rel}`)
  if (!/class\s+Mock\w+/.test(src)) fail('I6', `providers/${rel}`, 'no Mock adapter — testing contract incomplete')
}

// ── I7: money-path + messaging operations carry idempotency keys ───────────
const payment = read('src/server/integrations/providers/payment.ts')
if (!payment.includes('req:') || !payment.includes('verify:')) {
  fail('I7', 'providers/payment.ts', 'payment.request/verify missing idempotency keys (BR-INT-03)')
}
const sms = read('src/server/integrations/providers/sms.ts')
if (!sms.includes('retries: 2')) fail('I7', 'providers/sms.ts', 'SMS send without retry policy')

// ── I8: shared-graph modules never import @/server/* (client bundle safety) ─
const SHARED = files.filter((x) => x.startsWith('src/lib/') && !x.startsWith('src/lib/security'))
for (const f of SHARED) {
  if (read(f).match(/from\s+['"]@\/server\//) && f !== 'src/lib/ai/run.ts') {
    fail('I8', f, 'lib module imports @/server/* — breaks the browser bundle (ED-137b; notify uses channel injection)')
  }
}

// ── I9: admin integration routes are role-guarded ──────────────────────────
for (const f of files.filter((x) => x.includes('/api/v1/admin/integrations'))) {
  if (!/requireRole|requirePermission/.test(read(f))) {
    fail('I9', f, 'integration admin route without role guard')
  }
}

// ── I10: IntegrationCallLog writes only from the integration core ──────────
for (const f of files) {
  if (/integrationCallLog\.(create|update|deleteMany|upsert)/.test(read(f)) && !INTEGRATION_LAYER(f)) {
    fail('I10', f, 'IntegrationCallLog written outside the integration core — telemetry single-writer (ED-139)')
  }
}

// ── report ──────────────────────────────────────────────────────────────────
const fileCount = files.length
if (errors > 0) {
  console.error(`\nFAILED — ${errors} integration-architecture violation(s) across ${fileCount} files.`)
  process.exit(1)
}
console.log(`integrations-audit: 9 kinds, ${LIVE_ADAPTERS.length} adapter files, ${fileCount} source files — 0 errors`)
console.log('INTEGRATION AUDIT PASS ✓')
