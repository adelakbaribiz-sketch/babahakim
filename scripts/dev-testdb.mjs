#!/usr/bin/env node
// Dev server bound to an ISOLATED test database (never the live one).
// Reads .env.test-server (DATABASE_URL=file:…/test.db), then starts
// `next dev`; process env beats .env, so the live DATABASE_URL is ignored.
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'

const env = { ...process.env }
for (const line of readFileSync('.env.test-server', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2]
}
if (!env.DATABASE_URL || /home\/z\/my-project/.test(env.DATABASE_URL)) {
  console.error('refusing to start: .env.test-server must point DATABASE_URL at a test database')
  process.exit(1)
}
console.log(`[dev-testdb] DATABASE_URL=${env.DATABASE_URL}`)
// server output is mirrored to a file so log-assertion tests can read it
// (BH_QA_SERVER_LOG=<this path> when running the suites)
const logFile = env.BH_TEST_SERVER_LOG || '../testenv/server.log'
const sink = createWriteStream(logFile, { flags: 'w' })
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', env.PORT || '3000'], { env, stdio: ['inherit', 'pipe', 'pipe'] })
for (const stream of [child.stdout, child.stderr]) stream.on('data', (b) => { process.stdout.write(b); sink.write(b) })
child.on('exit', (code) => process.exit(code ?? 0))
