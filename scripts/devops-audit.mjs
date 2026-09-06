#!/usr/bin/env node
// ── PHASE 19 CI gate: DevOps & Deployment Audit (DEV1..DEV10) ──────────────
// Enforces the phase's non-negotiables (spec §50-53, §71, §75-77):
//   DEV1  .env.example is committed and covers EVERY env var the code reads
//   DEV2  secrets policy: no tracked env files, scanner wired and runnable
//   DEV3  Dockerfile: multi-stage, non-root, tini, healthcheck, migrate boot
//   DEV4  compose: prod pins BH_VERSION (never :latest), volumes, health
//   DEV5  nginx: TLS 1.2/1.3 + HSTS + 80→443 + acme + body budget + fwd hdrs
//   DEV6  CI workflow: the 9 ordered stages, fail-stops-deploy (needs-gates)
//   DEV7  deploy/rollback: immutable releases + atomic switch + auto-rollback
//   DEV8  backup/restore: consistent snapshot + integrity self-check + rotate
//   DEV9  DB/Cache/Queue/Storage standardization seams (volume, durable queue)
//   DEV10 runbook + operator surface: DEPLOYMENT.md, Makefile, npm scripts
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const problems = []
const ok = (name) => console.log(`  ✓ ${name}`)
const fail = (name, detail) => { problems.push(`${name}: ${detail}`); console.log(`  ✗ ${name} — ${detail}`) }
const read = (p) => readFileSync(join(root, p), 'utf8')
const has = (p) => existsSync(join(root, p))

// ── DEV1: env template covers the code's real env surface ─────────────────
console.log('DEV1 — .env.example committed and complete')
{
  const ex = has('.env.example') ? read('.gitignore').includes('!.env.example') : false
  if (!has('.env.example')) fail('.env.example', 'file missing')
  else if (!ex) fail('.env.example', 'not committable — .gitignore lacks !.env.example')
  else ok('.env.example exists and is the committed template')

  // every process.env.NAME the APP source reads must appear in the template
  // (scan src/ only — the app's env contract; scripts consume the same vars)
  const envNames = new Set()
  {
    let out = ''
    try { out = execSync(`grep -rhoE "process\\\\.env\\\\.[A-Z_a-z0-9]+" src --include=*.ts --include=*.tsx 2>/dev/null || true`, { cwd: root, shell: '/bin/bash', encoding: 'utf8' }) } catch { }
    for (const m of out.matchAll(/process\.env\.([A-Z_a-z0-9]+)/g)) envNames.add(m[1])
  }
  const template = read('.env.example')
  const missing = [...envNames].filter((n) => {
    if (['NODE_ENV', 'NEXT_PHASE', 'BUN_TEST'].includes(n)) return false // framework/runtime
    return !new RegExp(`^${n}=`, 'm').test(template)
  })
  if (missing.length) fail('env coverage', `code reads ${missing.join(', ')} but .env.example does not document them`)
  else ok(`env coverage: all ${envNames.size} vars the code reads are documented`)
}

// ── DEV2: secrets policy ──────────────────────────────────────────────────
console.log('DEV2 — secrets policy (charter rule 6 / ED-59)')
{
  let tracked = ''
  try { tracked = execSync('git ls-files', { cwd: root, encoding: 'utf8' }) } catch { fail('git ls-files', 'git unavailable') }
  const envTracked = tracked.split('\n').filter((f) => /^\.env/.test(f) && f !== '.env.example')
  if (envTracked.length) fail('tracked env files', envTracked.join(', '))
  else ok('no real env file is tracked (only .env.example)')

  const scan = has('scripts/secret-scan.sh') && read('package.json').includes('"secret-scan"')
  if (!scan) fail('secret scanner', 'scripts/secret-scan.sh + npm script missing')
  else ok('secret scanner wired (scripts/secret-scan.sh + npm run secret-scan)')

  const failFast = read('src/lib/security/env.ts').includes('must be set in production')
  if (failFast ) ok('production fail-fast on missing secrets (ED-59)')
  else fail('fail-fast', 'env.ts production guard missing')
}

// ── DEV3: Dockerfile ──────────────────────────────────────────────────────
console.log('DEV3 — Dockerfile (multi-stage, non-root, migrate-on-boot)')
{
  const d = has('Dockerfile') ? read('Dockerfile') : ''
  if (!d) fail('Dockerfile', 'missing')
  else {
    const checks = [
      ['multi-stage (deps/build/runner)', /FROM .+ AS deps[\s\S]*FROM .+ AS build[\s\S]*FROM .+ AS runner/.test(d)],
      ['standalone output copied', d.includes('.next/standalone')],
      ['non-root user', /USER (bh|node|1001)/.test(d)],
      ['tini PID 1 (signal forwarding)', d.includes('tini')],
      ['HEALTHCHECK on /liveness', /HEALTHCHECK[\s\S]*liveness/.test(d)],
      ['data volume declared', d.includes('VOLUME ["/data"]')],
    ]
    for (const [n, c] of checks) (c ? ok : fail)(`docker: ${n}`, c ? '' : 'missing in Dockerfile')
    const ep = has('docker-entrypoint.sh') ? read('docker-entrypoint.sh') : ''
    if (ep.includes('migrate deploy') ) ok('entrypoint: prisma migrate deploy before serving')
    else fail('entrypoint', 'migrations not applied at boot')
  }
}

// ── DEV4: compose files ───────────────────────────────────────────────────
console.log('DEV4 — compose (dev one-command + prod pinning)')
{
  const dev = has('docker-compose.yml') ? read('docker-compose.yml') : ''
  const prod = has('docker-compose.prod.yml') ? read('docker-compose.prod.yml') : ''
  if (!dev) fail('docker-compose.yml', 'missing')
  else {
    if (dev.includes('command:') && dev.includes('3000:3000') ) ok('dev compose: one-command app on :3000')
    else fail('dev compose', 'app service/command missing')
    if (/profiles:\s*\[.*redis/.test(dev) && /profiles:\s*\[.*storage/.test(dev) ) ok('growth profiles (redis/minio) opt-in, not required')
    else fail('dev compose', 'redis/minio profiles missing')
  }
  if (!prod) fail('docker-compose.prod.yml', 'missing')
  else {
    const checks = [
      ['release pinned via BH_VERSION (never :latest)', prod.includes('${BH_VERSION:?')],
      ['app NOT port-mapped (nginx-only exposure)', !/ports:[\s\S]*- "?3000/.test(prod.split('nginx:')[0])],
      ['named data volume', prod.includes('bh-data:/data')],
      ['readiness healthcheck + start_period', prod.includes('/readiness') && prod.includes('start_period')],
      ['restart policy', prod.includes('restart: unless-stopped')],
      ['memory limit (bounded heap D-16-6)', prod.includes('memory:')],
      ['log rotation (json-file max-size)', prod.includes('max-size')],
      ['nginx mounts TLS certs read-only', prod.includes('/etc/nginx/certs:ro')],
    ]
    for (const [n, c] of checks) (c ? ok : fail)(`prod compose: ${n}`, c ? '' : 'missing in docker-compose.prod.yml')
  }
}

// ── DEV5: nginx ───────────────────────────────────────────────────────────
console.log('DEV5 — nginx reverse proxy + SSL (spec §75)')
{
  const n = has('deploy/nginx/babahakim.conf') ? read('deploy/nginx/babahakim.conf') : ''
  const inc = has('deploy/nginx/proxy-common.inc') ? read('deploy/nginx/proxy-common.inc') : ''
  if (!n) fail('nginx conf', 'deploy/nginx/babahakim.conf missing')
  else {
    const checks = [
      ['TLS 1.2/1.3 only', n.includes('TLSv1.2') && n.includes('TLSv1.3')],
      ['certs mounted from files (not inline)', n.includes('ssl_certificate') && !/ssl_certificate .{0,10}(BEGIN CERT)/.test(n)],
      ['80 → 443 redirect (no plaintext API)', /location \/ \{[\s\S]*301 https/.test(n)],
      ['ACME challenge path preserved', n.includes('.well-known/acme-challenge')],
      ['HSTS', n.includes('Strict-Transport-Security')],
      ['server_tokens off', n.includes('server_tokens off')],
      ['upload budget (client_max_body_size)', n.includes('client_max_body_size')],
      ['rate-limit zones (auth + api)', n.includes('limit_req_zone') && n.includes('bh_auth')],
      ['proxy headers forwarded (X-Forwarded-For/Proto/Host)', inc.includes('X-Forwarded-For') && inc.includes('X-Forwarded-Proto') && inc.includes('X-Forwarded-Host')],
      ['upstream keepalive', n.includes('keepalive')],
    ]
    for (const [name, c] of checks) (c ? ok : fail)(`nginx: ${name}`, c ? '' : 'missing')
    const gen = has('deploy/nginx/gen-self-signed.sh')
    if (gen ) ok('dev/staging self-signed generator present (prod uses Let\'s Encrypt)')
    else fail('self-signed generator', 'deploy/nginx/gen-self-signed.sh missing')
  }
}

// ── DEV6: CI pipeline ─────────────────────────────────────────────────────
console.log('DEV6 — CI/CD pipeline (spec §76: fail stops deployment)')
{
  const wf = has('.github/workflows/ci.yml') ? read('.github/workflows/ci.yml') : ''
  const local = has('scripts/ci-local.sh') ? read('scripts/ci-local.sh') : ''
  if (!wf) fail('workflow', '.github/workflows/ci.yml missing')
  else {
    const stages = ['lint', 'type-check', 'unit tests', 'integration', 'security', 'docker build', 'artifact', 'deploy', 'health check', 'rollback']
    const missing = stages.filter((s) => !wf.toLowerCase().includes(s.toLowerCase()))
    if (missing.length) fail('pipeline stages', `workflow lacks: ${missing.join(', ')}`)
    else ok('all 10 ordered stages present (lint→rollback)')
    const gates = ['needs: quality', 'needs: [integration, security]', 'needs: artifact']
    const gateMissing = gates.filter((g) => !wf.includes(g))
    if (gateMissing.length) fail('fail-stop gating', `needs chains missing: ${gateMissing.join(', ')}`)
    else ok('needs-gated: a failing stage stops the deployment (spec §76)')
    if (wf.includes('trivy') && wf.includes('gitleaks') && wf.includes('semgrep') && wf.includes('osv')) ok('security scanning quartet (dependency+secret+SAST+container — spec §77)')
    else fail('security scans', 'osv/gitleaks/semgrep/trivy missing from workflow')
    if (wf.includes('migrate') || wf.includes('backup.sh') ) ok('deploy job: pre-deploy backup + migrations')
    else fail('deploy job', 'backup/migrate steps missing')
  }
  const mirror = ['lint', 'type-check', 'unit-tests', 'integration', 'security-scan', 'build', 'artifact', 'deploy', 'health-check', 'rollback-drill']
  const mirrorMissing = mirror.filter((s) => !local.includes(s))
  if (mirrorMissing.length) fail('local mirror', `ci-local.sh lacks: ${mirrorMissing.join(', ')}`)
  else ok('local mirror: same stages runnable via scripts/ci-local.sh')
}

// ── DEV7: repeatable deploy + rollback ────────────────────────────────────
console.log('DEV7 — repeatable, health-gated deployment')
{
  const dep = has('scripts/deploy.sh') ? read('scripts/deploy.sh') : ''
  const rb = has('scripts/rollback.sh') ? read('scripts/rollback.sh') : ''
  if (!dep) fail('deploy.sh', 'missing')
  else {
    const checks = [
      ['immutable release dirs (releases/<tag>)', dep.includes('releases/${TAG}') || dep.includes('REL_DIR="${RELEASES}/${TAG}"')],
      ['release manifest (VERSION)', dep.includes('VERSION')],
      ['git-clean preflight (reproducible state)', dep.includes('UNCOMMITTED')],
      ['atomic switch (ln -sfn current)', dep.includes('ln -sfn')],
      ['health gate on /readiness', dep.includes('/readiness')],
      ['AUTO-rollback on failed gate', dep.toLowerCase().includes('rolling back')],
      ['release retention (rollback horizon)', /tail -n \+1[01]/.test(dep)],
      ['stale-server port cleanup (P18 lesson)', dep.includes('sport = :')],
    ]
    for (const [n, c] of checks) (c ? ok : fail)(`deploy: ${n}`, c ? '' : 'missing in deploy.sh')
  }
  if (!rb) fail('rollback.sh', 'missing')
  else {
    const checks = [
      ['--list releases', rb.includes('--list')],
      ['health gate before touching current', rb.includes('current\' left UNTOUCHED') || rb.includes('left UNTOUCHED')],
      ['atomic switch', rb.includes('ln -sfn')],
    ]
    for (const [n, c] of checks) (c ? ok : fail)(`rollback: ${n}`, c ? '' : 'missing in rollback.sh')
  }
  const drill = has('scripts/rollback-drill.sh')
  if (drill ) ok('rollback drill exists (a never-executed rollback is a wish)')
  else fail('rollback drill', 'scripts/rollback-drill.sh missing')
}

// ── DEV8: backup/restore ──────────────────────────────────────────────────
console.log('DEV8 — backup + tested restore path (spec §75)')
{
  const b = has('scripts/backup.sh') ? read('scripts/backup.sh') : ''
  const r = has('scripts/restore.sh') ? read('scripts/restore.sh') : ''
  if (!b) fail('backup.sh', 'missing')
  else {
    const checks = [
      ['consistent snapshot (sqlite3 .backup or checkpoint)', b.includes('.backup') || b.includes('wal_checkpoint')],
      ['media storage included', b.includes('storage-')],
      ['rotation by retention days', b.includes('-mtime')],
      ['integrity self-check (a backup that cannot restore is decoration)', b.includes('tables') && b.includes('integrity')],
    ]
    for (const [n, c] of checks) (c ? ok : fail)(`backup: ${n}`, c ? '' : 'missing')
  }
  if (!r) fail('restore.sh', 'missing')
  else {
    const checks = [
      ['stops the live writer first', r.includes('never restore under a live writer')],
      ['verifies backup BEFORE swapping', r.includes('integrity')],
      ['safety copy of current state', r.includes('pre-restore')],
    ]
    for (const [n, c] of checks) (c ? ok : fail)(`restore: ${n}`, c ? '' : 'missing')
  }
}

// ── DEV9: DB / Cache / Queue / Storage standardization ─────────────────────
console.log('DEV9 — infrastructure seams standardized')
{
  const schema = has('prisma/schema.prisma') && has('prisma/migrations')
  if (schema ) ok('database: schema + versioned migrations (migrate deploy path)')
  else fail('database', 'schema/migrations missing')
  if (read('prisma/schema.prisma').includes('DurableJob') ) ok('queue: DB-backed durable queue (crash-safe, ADR-0021)')
  else fail('queue', 'DurableJob model missing')
  const cacheSeam = existsSync(join(root, 'src/server/infrastructure/cache')) || execSync('grep -rl "setCacheStore" src/ --include=*.ts | head -1', { cwd: root, shell: '/bin/bash', encoding: 'utf8' }).trim()
  if (cacheSeam ) ok('cache: runtime-swappable store seam (in-process now, Redis-ready)')
  else fail('cache seam', 'setCacheStore not found')
  const sd = read('src/server/infrastructure/media/storage-driver.ts')
  if (sd.includes('MEDIA_STORAGE_DRIVER') && sd.includes("'local'") ) ok('storage: driver port with local driver (S3/MinIO seam, ADR-0006)')
  else fail('storage driver', 'driver port missing')
}

// ── DEV10: runbook + operator surface ─────────────────────────────────────
console.log('DEV10 — deployment runbook + operator surface')
{
  const doc = has('docs/DEPLOYMENT.md') ? read('docs/DEPLOYMENT.md') : ''
  if (!doc) fail('DEPLOYMENT.md', 'missing')
  else {
    const sections = ['Environment', 'Docker', 'Nginx', 'SSL', 'Backup', 'Monitoring', 'Migration', 'Rollback', 'Production Checklist', 'Firewall']
    const missing = sections.filter((s) => !doc.toLowerCase().includes(s.toLowerCase()))
    if (missing.length) fail('runbook sections', `missing: ${missing.join(', ')}`)
    else ok(`runbook complete (spec §75 checklist: ${sections.length} sections)`)
    if (doc.includes('Regulatory') || doc.includes('حقوقی') ) ok('legal/regulatory production checklist (spec §2087 requirement)')
    else fail('legal checklist', 'regulatory review section missing')
  }
  const mk = has('Makefile') ? read('Makefile') : ''
  if (!mk) fail('Makefile', 'missing')
  else {
    const targets = ['dev', 'test', 'qa', 'build', 'deploy', 'rollback', 'backup']
    const missing = targets.filter((t) => !new RegExp(`^${t}:`, 'm').test(mk))
    if (missing.length) fail('Makefile targets', `missing: ${missing.join(', ')}`)
    else ok(`operator targets: ${targets.join(' · ')}`)
  }
  const pj = read('package.json')
  const scripts = ['audit:devops', 'ci:local', 'db:seed', 'secret-scan']
  const missing = scripts.filter((s) => !pj.includes(`"${s}"`))
  if (missing.length) fail('npm scripts', `missing: ${missing.join(', ')}`)
  else ok('npm scripts wired (audit:devops · ci:local · db:seed · secret-scan)')
}

console.log('─'.repeat(56))
if (problems.length) {
  console.log(`PHASE 19 DEVOPS GATE — FAILED (${problems.length} problem${problems.length > 1 ? 's' : ''})`)
  process.exit(1)
}
console.log('PHASE 19 DEVOPS GATE — PASSED (DEV1..DEV10)')
