#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 16 · Frontend Load measurement (MEASUREMENT, not optimization)
//   node scripts/perf-frontend.mjs --tag baseline
// Boots the PRODUCTION standalone server (port 3100, bun auto-loads .env),
// then measures the real first-load payload:
//   • HTML document size + TTFB
//   • every script/stylesheet referenced by the entry HTML
//   • total bytes identity vs gzip/br (Compression measurement)
//   • cache headers on static assets
//   • chunk inventory of .next/static (what lazy chunks exist, their sizes)
// Output: scripts/perf-frontend-<tag>.json
// ─────────────────────────────────────────────────────────────────────────────
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const TAG = args.includes('--tag') ? args[args.indexOf('--tag') + 1] : (args[0] || 'baseline')
const PORT = 3100
const BASE = `http://localhost:${PORT}`
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const kb = (n) => Math.round((n / 1024) * 10) / 10

async function waitReady(timeoutMs = 60_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/liveness`)
      if (res.ok) return true
    } catch { /* not up yet */ }
    await sleep(500)
  }
  return false
}

// ── boot the production server ───────────────────────────────────────────────
const server = spawn('bun', ['.next/standalone/server.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), HOSTNAME: '127.0.0.1', NODE_ENV: 'production' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
const serverLog = []
server.stdout.on('data', (d) => serverLog.push(d.toString()))
server.stderr.on('data', (d) => serverLog.push(d.toString()))

try {
  if (!(await waitReady())) throw new Error('production server failed to start:\n' + serverLog.join('').slice(0, 2000))
  console.log(`production server up on :${PORT}`)

  // ── 1. entry HTML ────────────────────────────────────────────────────────
  const tHtml0 = performance.now()
  const htmlRes = await fetch(`${BASE}/`)
  const html = await htmlRes.text()
  const htmlMs = performance.now() - tHtml0
  const htmlBytes = Buffer.byteLength(html)

  // also measure compressed HTML
  const htmlGz = await fetch(`${BASE}/`, { headers: { 'Accept-Encoding': 'gzip, deflate, br' } })
  const htmlGzBytes = Number(htmlGz.headers.get('content-length') ?? 0)

  // ── 2. referenced assets (script src= + link href=) ──────────────────────
  // Wire-size measurement uses node:http (fetch auto-decompresses, hiding the
  // true transferred bytes — a measurement bug we must not ship).
  const assets = new Set()
  for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) assets.add(m[1])
  for (const m of html.matchAll(/<link[^>]+href="([^"]+)"/g)) assets.add(m[1])
  const assetList = [...assets].filter((a) => a.startsWith('/_next/') || a.startsWith('/'))

  const { wireBytes } = await import('./perf-lib-wire.mjs')
  const identity = { files: [], totalBytes: 0 }
  const gzip = { files: [], totalBytes: 0 }
  let cacheControlStatic = null
  let contentEncoding = null
  for (const a of assetList) {
    const r1 = await fetch(`${BASE}${a}`)
    const b1 = await r1.arrayBuffer()
    identity.totalBytes += b1.byteLength
    identity.files.push({ file: a, bytes: b1.byteLength })
    if (a.startsWith('/_next/static/') && cacheControlStatic === null) {
      cacheControlStatic = r1.headers.get('cache-control')
    }
    // raw wire size (compressed): http.get with Accept-Encoding, count bytes
    const w = await wireBytes(PORT, a, 'gzip, deflate, br')
    gzip.totalBytes += w.bytes
    gzip.files.push({ file: a, bytes: w.bytes, encoding: w.encoding })
    if (contentEncoding === null) contentEncoding = w.encoding
  }

  // ── 3. static inventory (all chunks incl. lazy) ──────────────────────────
  const chunkDir = path.join(ROOT, '.next/static/chunks')
  const chunkFiles = fs.existsSync(chunkDir)
    ? fs.readdirSync(chunkDir).filter((f) => f.endsWith('.js')).map((f) => ({
      file: f, kb: kb(fs.statSync(path.join(chunkDir, f)).size),
    })).sort((a, b) => b.kb - a.kb)
    : []
  const staticTotal = (() => {
    let total = 0
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else total += fs.statSync(p).size
      }
    }
    const st = path.join(ROOT, '.next/static')
    if (fs.existsSync(st)) walk(st)
    return total
  })()

  // ── 4. prod API spot-check (framework floor without dev overhead) ───────
  const apiSpot = {}
  for (const p of ['/api/v1/products', '/liveness']) {
    const t0 = performance.now()
    const r = await fetch(`${BASE}${p}`)
    await r.arrayBuffer()
    apiSpot[p] = { ms: Math.round((performance.now() - t0) * 100) / 100, status: r.status }
  }

  const result = {
    tag: TAG, base: BASE, generatedAt: new Date().toISOString(),
    html: { bytes: htmlBytes, kb: kb(htmlBytes), ms: Math.round(htmlMs), gzipBytes: htmlGzBytes },
    firstLoad: {
      assetCount: assetList.length,
      identityKb: kb(identity.totalBytes),
      gzipKb: kb(gzip.totalBytes),
      compressionRatio: identity.totalBytes > 0
        ? Math.round((1 - gzip.totalBytes / identity.totalBytes) * 1000) / 10 : null,
      files: identity.files.map((f) => ({ file: f.file, kb: kb(f.bytes) })).sort((a, b) => b.kb - a.kb),
    },
    static: {
      totalKb: kb(staticTotal),
      jsChunkCount: chunkFiles.length,
      topChunks: chunkFiles.slice(0, 15),
    },
    headers: { cacheControlStatic, contentEncoding },
    apiSpot,
    prerendered: htmlRes.headers.get('x-nextjs-cache') ?? null,
  }

  const file = path.join(ROOT, 'scripts', `perf-frontend-${TAG}.json`)
  fs.writeFileSync(file, JSON.stringify(result, null, 2))
  console.log(`HTML          ${result.html.kb} KB (${Math.round(htmlMs)} ms)  gzip-headers: ${htmlGzBytes || 'chunked'}`)
  console.log(`first-load JS ${result.firstLoad.identityKb} KB identity → ${result.firstLoad.gzipKb} KB over-the-wire (${result.firstLoad.compressionRatio}% saved)`)
  console.log(`assets        ${result.firstLoad.assetCount} files | static total ${result.static.totalKb} KB | ${result.static.jsChunkCount} JS chunks`)
  console.log(`cache-control ${cacheControlStatic} | content-encoding ${contentEncoding}`)
  console.log(`api spot      ${JSON.stringify(apiSpot)}`)
  console.log(`\nwritten → ${file}`)
} finally {
  server.kill('SIGTERM')
  await sleep(500)
  try { server.kill('SIGKILL') } catch {}
}
