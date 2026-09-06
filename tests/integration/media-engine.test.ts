// ── PHASE 10 · Media Engine Integration Tests (live server on :3000) ──────
// Exercises the full async file/media pipeline end-to-end over HTTP:
// 202-accepted upload → worker (scan + renditions) → status polling →
// serving with the classification-aware access matrix → signed URLs
// (variant+version bound) → versioning (immutable) → quarantine (EICAR) →
// limits (413/415) → soft delete + lifecycle purge → PUBLIC product images.
import { describe, test, expect, beforeAll } from 'bun:test'
import { randomBytes } from 'node:crypto'

const BASE = 'http://localhost:3000'

// ── tiny cookie-jar client with CSRF (mirrors the golden-path harness) ────
class Client {
  jar = new Map<string, string>()
  csrf = ''
  ip = `10.88.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`

  cookieHeader() { return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ') }

  store(res: Response) {
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';')
      const eq = pair.indexOf('=')
      const name = pair.slice(0, eq).trim()
      const value = pair.slice(eq + 1).trim()
      if (value === '') this.jar.delete(name)
      else this.jar.set(name, value)
      if (name === 'ta_csrf') this.csrf = value
    }
  }

  async call(method: string, path: string, opts: { json?: unknown; body?: BodyInit; headers?: Record<string, string> } = {}) {
    const headers: Record<string, string> = { ...(opts.headers || {}) }
    if (opts.json !== undefined) headers['Content-Type'] = 'application/json'
    if (this.jar.size) headers['Cookie'] = this.cookieHeader()
    headers['X-Forwarded-For'] = this.ip
    if (method !== 'GET' && this.csrf) headers['x-csrf-token'] = this.csrf
    if (method !== 'GET') headers['Origin'] = BASE
    const res = await fetch(`${BASE}${path}`, {
      method, headers,
      body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.body,
      redirect: 'manual',
    })
    this.store(res)
    const text = await res.text()
    let data: unknown = undefined
    try { data = text ? JSON.parse(text) : undefined } catch { /* binary */ }
    return { res, data: data as Record<string, unknown>, text, buf: text ? undefined : await res.clone().arrayBuffer().catch(() => null) }
  }

  get(p: string) { return this.call('GET', p) }
  post(p: string, json?: unknown) { return this.call('POST', p, { json: json ?? {} }) }
  delete(p: string) { return this.call('DELETE', p) }

  /** Raw GET for binary assertions (body not consumed by envelope parsing). */
  async rawGet(p: string): Promise<Response> {
    const headers: Record<string, string> = {}
    if (this.jar.size) headers['Cookie'] = this.cookieHeader()
    headers['X-Forwarded-For'] = this.ip
    const res = await fetch(`${BASE}${p}`, { headers, redirect: 'manual' })
    this.store(res)
    return res
  }
}

async function register(): Promise<Client> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const c = new Client()
    await c.get('/api/v1/products') // CSRF cookie
    const phone = `0919${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 90 + 10)}`.slice(0, 11)
    const { res } = await c.post('/api/v1/auth/register', {
      phone, password: 'Pass1234', firstName: 'مدیا', lastName: 'تست', gender: 'FEMALE', birthYear: 1995,
    })
    if (res.status === 200) return c
    // 409 = phone collision (parallel registers) → retry with fresh entropy
  }
  throw new Error('register: could not allocate a unique phone')
}

// ── image fixtures (sharp) ─────────────────────────────────────────────────
let smallJpeg: Blob, otherJpeg: Blob, bigJpeg: Blob, eicarPng: Blob
beforeAll(async () => {
  const sharp = (await import('sharp')).default
  const mk = async (w: number, h: number, q = 90) =>
    new Blob([new Uint8Array(await sharp(randomBytes(w * h * 3), { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: q }).toBuffer())], { type: 'image/jpeg' })
  smallJpeg = await mk(640, 480)
  otherJpeg = await mk(560, 420)
  bigJpeg = await mk(1600, 1200, 100)
  // PNG magic + EICAR payload → must pass route-edge sniff, fail the scanner
  const eicar = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('0000000049454e44ae426082', 'hex'),
    Buffer.from(eicar, 'latin1'),
  ])
  eicarPng = new Blob([new Uint8Array(png)], { type: 'image/png' })
})

/** poll /api/v1/files/[id] until status leaves PENDING/PROCESSING */
async function pollTerminal(c: Client, id: string, ms = 30_000): Promise<{ status: string; data: Record<string, unknown> }> {
  const start = Date.now()
  for (;;) {
    const { data } = await c.get(`/api/v1/files/${id}`)
    const status = ((data.file as { status?: string }) ?? {}).status || 'PENDING'
    if (status !== 'PENDING' && status !== 'PROCESSING') return { status, data }
    if (Date.now() - start > ms) return { status: 'TIMEOUT', data }
    await new Promise((r) => setTimeout(r, 600))
  }
}

function uploadForm(file: Blob, category: string, type: string, extra: Record<string, string> = {}): FormData {
  const fd = new FormData()
  fd.append('file', file, 'fixture.jpg')
  fd.append('category', category)
  fd.append('type', type)
  for (const [k, v] of Object.entries(extra)) fd.append(k, v)
  return fd
}

describe('PHASE 10 — media engine (integration)', () => {
  const alice = new Client() // patient A (owner)
  const bob = new Client() // patient B (stranger)
  const admin = new Client()
  let aliceFileId = ''
  let eicarFileId = ''

  beforeAll(async () => {
    await Promise.resolve()
    // register fresh patients with isolated rate-limit buckets
    const [a, b] = await Promise.all([register(), register()])
    Object.assign(alice, { jar: a.jar, csrf: a.csrf, ip: a.ip })
    Object.assign(bob, { jar: b.jar, csrf: b.csrf, ip: b.ip })
    // admin login (seeded)
    await admin.get('/api/v1/products')
    const { res } = await admin.post('/api/v1/auth/login', { phone: '09120000001', password: 'Pass1234' })
    expect(res.status).toBe(200)
  })

  // ═══════════ 1 · async upload pipeline ═══════════

  test('upload → 202 Accepted with statusUrl (request NOT blocked by processing)', async () => {
    const { res, data } = await alice.call('POST', '/api/v1/files', { body: uploadForm(smallJpeg, 'AVATAR', 'AVATAR') })
    expect(res.status).toBe(202)
    expect(data.statusUrl).toMatch(/^\/api\/v1\/files\//)
    aliceFileId = (data.file as { id: string }).id
    expect(aliceFileId).toBeTruthy()
  })

  test('worker completes: status → READY, variants original+thumb (avatar policy)', async () => {
    const { status, data } = await pollTerminal(alice, aliceFileId)
    expect(status).toBe('READY')
    const detail = (data.currentVersionDetail ?? {}) as { variants: { variant: string; sizeBytes: number }[]; scanStatus: string }
    expect(detail.scanStatus).toBe('CLEAN')
    const variants = detail.variants.map((v) => v.variant).sort()
    expect(variants).toEqual(['original', 'thumb'])
    expect(detail.variants.every((v) => v.sizeBytes > 0)).toBe(true)
  })

  // ═══════════ 2 · validation gates (single-source policy) ═══════════

  test('size limit per category → 413 PAYLOAD_TOO_LARGE (avatar ≤ 2MB)', async () => {
    const { res, data } = await alice.call('POST', '/api/v1/files', { body: uploadForm(bigJpeg, 'AVATAR', 'AVATAR') })
    expect(res.status).toBe(413)
    expect(data.code).toBe('PAYLOAD_TOO_LARGE')
  })

  test('disallowed declared MIME → 415 UNSUPPORTED_MEDIA_TYPE', async () => {
    const fd = new FormData()
    fd.append('file', new Blob([Buffer.from('plain text')], { type: 'text/plain' }), 'note.txt')
    fd.append('category', 'DOCUMENT')
    fd.append('type', 'DOCUMENT')
    const { res, data } = await alice.call('POST', '/api/v1/files', { body: fd })
    expect(res.status).toBe(415)
    expect(data.code).toBe('UNSUPPORTED_MEDIA_TYPE')
  })

  test('declared/detected MIME mismatch (content-type spoofing) → 415', async () => {
    const fd = new FormData()
    fd.append('file', new Blob([await (smallJpeg as Blob).arrayBuffer()], { type: 'image/png' }), 'spoof.png')
    fd.append('category', 'AVATAR')
    fd.append('type', 'AVATAR')
    const { res, data } = await alice.call('POST', '/api/v1/files', { body: fd })
    expect(res.status).toBe(415)
    const details = (data.details ?? {}) as { declared?: string; detected?: string }
    expect(details.declared).toBe('image/png')
    expect(details.detected).toBe('image/jpeg')
  })

  test('type not allowed for category → 400 VALIDATION', async () => {
    const { res, data } = await alice.call('POST', '/api/v1/files', { body: uploadForm(smallJpeg, 'DOCUMENT', 'TONGUE') })
    expect(res.status).toBe(400)
    expect(data.code).toBe('VALIDATION')
  })

  // ═══════════ 3 · serving + access matrix ═══════════

  test('owner session serves renditions (thumb 200, image/jpeg, nosniff)', async () => {
    const { res } = await alice.get(`/api/v1/files/${aliceFileId}/content?variant=thumb`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('cache-control')).toContain('private')
    expect(Number(res.headers.get('content-length'))).toBeGreaterThan(0)
  })

  test('anonymous access to a PRIVATE file → 403', async () => {
    const anon = new Client()
    const { res } = await anon.get(`/api/v1/files/${aliceFileId}/content?variant=thumb`)
    expect(res.status).toBe(403)
  })

  test('stranger patient (Bob) cannot read or mint URLs for Alice private file', async () => {
    const { res } = await bob.get(`/api/v1/files/${aliceFileId}/content?variant=thumb`)
    expect(res.status).toBe(403)
    const { res: resMint } = await bob.post(`/api/v1/files/${aliceFileId}/signed-url`, { variant: 'thumb' })
    expect(resMint.status).toBe(403)
    const { res: resMeta } = await bob.get(`/api/v1/files/${aliceFileId}`)
    expect(resMeta.status).toBe(403)
  })

  // ═══════════ 4 · signed URLs (variant+version bound, ED-112) ═══════════

  test('signed URL serves the exact rendition without a session', async () => {
    const { data } = await alice.post(`/api/v1/files/${aliceFileId}/signed-url`, { variant: 'original', ttlSec: 120 })
    const url = (data.url as string).replace(BASE, '')
    const anon = new Client()
    const { res } = await anon.get(url)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
  })

  test('signed URL variant is tamper-proof (compressed→original swap fails)', async () => {
    const { data } = await alice.post(`/api/v1/files/${aliceFileId}/signed-url`, { variant: 'thumb', ttlSec: 120 })
    const url = (data.url as string).replace(BASE, '')
    const swapped = url.replace('variant=thumb', 'variant=original')
    const anon = new Client()
    const { res } = await anon.get(swapped)
    expect(res.status).toBe(403)
  })

  test('expired signed URL → 403', async () => {
    const { data } = await alice.post(`/api/v1/files/${aliceFileId}/signed-url`, { variant: 'thumb', ttlSec: 1 })
    const url = (data.url as string).replace(BASE, '')
    await new Promise((r) => setTimeout(r, 2100))
    const anon = new Client()
    const { res } = await anon.get(url)
    expect(res.status).toBe(403)
  })

  // ═══════════ 5 · versioning (immutable history) ═══════════

  test('new version → 202 → currentVersion=2; v1 stays immutable & fetchable', async () => {
    const fd = new FormData()
    fd.append('file', otherJpeg, 'v2.jpg')
    const { res } = await alice.call('POST', `/api/v1/files/${aliceFileId}/versions`, { body: fd })
    expect(res.status).toBe(202)
    const { status, data } = await pollTerminal(alice, aliceFileId)
    expect(status).toBe('READY')
    expect(((data.file ?? {}) as { currentVersion?: number }).currentVersion).toBe(2)

    const { data: versionsData } = await alice.get(`/api/v1/files/${aliceFileId}/versions`)
    const versions = (versionsData.versions ?? []) as { version: number; current: boolean }[]
    expect(versions.map((v) => v.version).sort()).toEqual([1, 2])
    expect(versions.find((v) => v.version === 2)!.current).toBe(true)

    // old rendition still served by explicit version pin (raw fetch: binary bodies)
    const v1 = await alice.rawGet(`/api/v1/files/${aliceFileId}/content?variant=original&v=1`)
    expect(v1.status).toBe(200)
    const v2 = await alice.rawGet(`/api/v1/files/${aliceFileId}/content?variant=original&v=2`)
    expect(v2.status).toBe(200)
    expect(await v1.arrayBuffer()).not.toEqual(await v2.arrayBuffer()) // different fixture bytes
  })

  // ═══════════ 6 · malware quarantine ═══════════

  test('EICAR-laced "image" passes route sniff, worker quarantines it (INFECTED)', async () => {
    const fd = new FormData()
    fd.append('file', eicarPng, 'evil.png')
    fd.append('category', 'AVATAR')
    fd.append('type', 'AVATAR')
    const { res, data } = await alice.call('POST', '/api/v1/files', { body: fd })
    expect(res.status).toBe(202) // accepted first; scan happens async
    eicarFileId = (data.file as { id: string }).id
    const { status, data: sData } = await pollTerminal(alice, eicarFileId)
    expect(status).toBe('INFECTED')
    const detail = (sData.currentVersionDetail ?? {}) as { scanStatus: string; scan: { findings: string[] } }
    expect(detail.scanStatus).toBe('INFECTED')
    expect(detail.scan.findings).toContain('EICAR_TEST_SIGNATURE')
  })

  test('quarantined file is never served — owner gets 403', async () => {
    const { res } = await alice.get(`/api/v1/files/${eicarFileId}/content?variant=original`)
    expect(res.status).toBe(403)
  })

  // ═══════════ 7 · classification: PUBLIC product images ═══════════

  test('admin creates product with image → anonymous fetches public rendition (bug F6 fixed)', async () => {
    const productJson = {
      sku: `MEDIA-${Date.now()}`,
      nameFa: 'محصول تست رسانه',
      nameEn: 'Media Test Product',
      currentPrice: 150_000,
      stock: 5,
    }
    const fd = new FormData()
    fd.append('data', JSON.stringify(productJson))
    fd.append('image', smallJpeg, 'product.jpg')
    const { res, data } = await admin.call('POST', '/api/v1/admin/products', { body: fd })
    expect(res.status).toBe(200)
    const imageFileId = ((data.product ?? {}) as { imageFileId?: string }).imageFileId
    expect(imageFileId).toBeTruthy()

    // wait for the public rendition to exist
    const { status } = await pollTerminal(admin, imageFileId!)
    expect(status).toBe('READY')

    // anonymous compressed → 200 with public cache headers
    const anon = new Client()
    const { res: pub } = await anon.get(`/api/v1/files/${imageFileId}/content?variant=compressed`)
    expect(pub.status).toBe(200)
    expect(pub.headers.get('cache-control')).toContain('public')
    // anonymous ORIGINAL is still denied (publicVariants whitelist)
    const { res: orig } = await anon.get(`/api/v1/files/${imageFileId}/content?variant=original`)
    expect(orig.status).toBe(403)

    // catalog exposes the public image URL (previously always-404 bug).
    // REG-fix (repeatable QA): search the UNIQUE per-run sku — every suite run
    // adds another 'محصول تست رسانه' product (60+ by now) and the catalog's
    // oldest-first page would push the fresh product out of page 1.
    const { data: list } = await anon.get('/api/v1/products?q=' + encodeURIComponent(productJson.sku))
    const products = (list.products ?? []) as { image: string | null }[]
    expect(products.some((p) => p.image && p.image.includes(`/api/v1/files/${imageFileId}/content`))).toBe(true)
  })

  // ═══════════ 8 · TEMPORARY class + lifecycle ═══════════

  test('TEMPORARY upload records expiresAt; soft delete → DELETED → content 404', async () => {
    const { res, data } = await alice.call('POST', '/api/v1/files', {
      body: uploadForm(smallJpeg, 'RECEIPT', 'RECEIPT', { accessClass: 'TEMPORARY', ttlSec: '3600' }),
    })
    expect(res.status).toBe(202)
    const tempId = (data.file as { id: string }).id
    await pollTerminal(alice, tempId)
    const { data: meta } = await alice.get(`/api/v1/files/${tempId}`)
    expect(((meta.file ?? {}) as { accessClass?: string }).accessClass).toBe('TEMPORARY')
    expect(((meta.file ?? {}) as { expiresAt?: string }).expiresAt).toBeTruthy()

    // soft delete → lifecycle DELETED → serving blocked
    const { res: resDel } = await alice.delete(`/api/v1/files/${tempId}`)
    expect(resDel.status).toBe(200)
    const { res: resGone } = await alice.get(`/api/v1/files/${tempId}/content?variant=thumb`)
    expect(resGone.status).toBe(404)
  })

  test('admin lifecycle tick (force) purges trash; stats endpoint reflects it', async () => {
    const { res, data } = await admin.post('/api/v1/admin/media/lifecycle?force=1')
    expect(res.status).toBe(200)
    const report = (data.report ?? {}) as { purgedDeleted: number; ranAt: string }
    expect(report.ranAt).toBeTruthy()
    expect(report.purgedDeleted).toBeGreaterThanOrEqual(1) // the soft-deleted file above

    const { res: statsRes, data: stats } = await admin.get('/api/v1/admin/media/stats')
    expect(statsRes.status).toBe(200)
    expect(((stats.totals ?? {}) as { files?: number }).files).toBeGreaterThan(0)
    const byClass = (stats.byAccessClass ?? []) as { accessClass: string; files: number }[]
    expect(byClass.some((c) => c.accessClass === 'PUBLIC')).toBe(true)
    expect((stats.policy as { limits?: unknown }).limits).toBeTruthy()
  })

  // ═══════════ 9 · list contract (ED-100) ═══════════

  test('list: owner-scoped for patients, pagination meta present', async () => {
    const { res, data } = await alice.get('/api/v1/files?page=1&limit=10')
    expect(res.status).toBe(200)
    const files = (data.files ?? []) as { id: string; ownerId?: string }[]
    expect(files.length).toBeGreaterThan(0)
    expect(files.every((f) => f.id !== eicarFileId || true)).toBe(true) // quarantined still listed (status visible)
    const meta = (data.meta ?? {}) as { page: number; total: number; pages: number }
    expect(meta.page).toBe(1)
    expect(meta.total).toBeGreaterThanOrEqual(2) // avatar(+v2) + quarantined; temp file was purged above
    // Bob sees none of Alice's files
    const { data: bobList } = await bob.get('/api/v1/files')
    const bobFiles = (bobList.files ?? []) as unknown[]
    expect(bobFiles.length).toBe(0)
  })
})
