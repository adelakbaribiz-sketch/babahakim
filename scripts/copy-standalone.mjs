#!/usr/bin/env bun
// Post-build step: Next standalone output needs .next/static and public/ next
// to server.js. Portable replacement for `cp -r` (Bun's Windows shell has no -r).
import { cpSync, existsSync } from 'node:fs'

if (!existsSync('.next/standalone')) {
  console.error('.next/standalone missing — is output: "standalone" set and did `next build` succeed?')
  process.exit(1)
}
cpSync('.next/static', '.next/standalone/.next/static', { recursive: true })
if (existsSync('public')) cpSync('public', '.next/standalone/public', { recursive: true })
console.log('standalone assets copied')
