#!/usr/bin/env bun
// Full suite against the ISOLATED test database (never the live one): reads
// .env.test-server — the same file `bun run dev:testdb` uses — so tests and the
// server under test always share one database. Start `bun run dev:testdb` first.
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const env = { ...process.env }
for (const line of readFileSync('.env.test-server', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2]
}
if (!env.DATABASE_URL || /home\/z\/my-project/.test(env.DATABASE_URL)) {
  console.error('refusing: .env.test-server must point DATABASE_URL at a test database')
  process.exit(1)
}
env.BH_QA_SERVER_LOG ??= env.BH_TEST_SERVER_LOG || '../testenv/server.log'
// `bun run test:all` = everything; `bun run test:all src` = unit suites only
const targets = process.argv.slice(2).length ? process.argv.slice(2) : ['src', 'tests']
const r = spawnSync(process.execPath, ['test', ...targets], { env, stdio: 'inherit' })
process.exit(r.status ?? 1)
