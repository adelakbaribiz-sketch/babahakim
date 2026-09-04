// ── PHASE 08 · API Integration Tests (golden path, live server) ───────────
// Runs against the dev server on :3000 (bun test). Exercises the full
// layered backend end-to-end: register → questionnaire → upload (quality
// gate) → case → async AI job → 18-action workflow → payment cascade →
// shop checkout (transactional) → headers/envelope/pagination contracts.
import { describe, test, expect, beforeAll } from 'bun:test'
import { randomBytes } from 'node:crypto'

const BASE = 'http://localhost:3000'

// ── tiny cookie-jar client with CSRF (Phase 05 double-submit) ─────────────
class Client {
  jar = new Map<string, string>()
  csrf = ''
  ip = `10.77.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`

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
    // unique fake client IP → per-IP rate-limit buckets stay isolated per Client
    // (mirrors the Phase-05 pentest convention; XFF is trusted only behind the proxy)
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
    try { data = text ? JSON.parse(text) : undefined } catch { /* binary/attachment */ }
    return { res, data: data as Record<string, unknown>, text }
  }

  get(p: string) { return this.call('GET', p) }
  post(p: string, json?: unknown) { return this.call('POST', p, { json: json ?? {} }) }
  patch(p: string, json?: unknown) { return this.call('PATCH', p, { json: json ?? {} }) }
  put(p: string, json?: unknown) { return this.call('PUT', p, { json: json ?? {} }) }
  delete(p: string) { return this.call('DELETE', p) }
}

// ── a sharp-enough random-noise JPEG (passes the quality gate by design) ──
let tongueJpeg: Blob
beforeAll(async () => {
  const sharp = (await import('sharp')).default
  const buf = await sharp(randomBytes(640 * 480 * 3), { raw: { width: 640, height: 480, channels: 3 } })
    .jpeg({ quality: 90 })
    .toBuffer()
  tongueJpeg = new Blob([buf], { type: 'image/jpeg' })
})

const seedUser = (n: number) => ({ phone: `0912000000${n}`, password: 'Pass1234' })
const uid = () => `0919${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 9)}`.slice(0, 11)

// helpers shared inside the suite
let patientImageId = ''
const caseView = (d: Record<string, unknown>) => (d.case ?? {}) as Record<string, unknown>

describe('PHASE 08 — layered backend golden path (integration)', () => {
  const patient = new Client()
  const expert1 = new Client()
  const expert2 = new Client()
  const doctor = new Client()
  const operator = new Client()
  let caseId = ''

  beforeAll(async () => {
    // warm-up: obtain CSRF cookie + wake the server
    await patient.get('/api/v1/products')
    // staff logins (seeded demo accounts)
    for (const [c, n] of [[expert1, 2], [expert2, 3], [doctor, 5], [operator, 4]] as [Client, number][]) {
      await c.get('/api/v1/products')
      const { res } = await c.post('/api/v1/auth/login', seedUser(n))
      expect(res.status).toBe(200)
    }
  })

  // ═══════════ 1 · transport contracts (envelope/headers/versioning) ═════════

  test('error envelope: 401 carries error+code+requestId + version headers', async () => {
    const anon = new Client()
    const { res, data } = await anon.get('/api/v1/cases')
    expect(res.status).toBe(401)
    expect(data.code).toBe('AUTH_REQUIRED')
    expect(data.error).toBeTruthy()
    expect(String(data.requestId)).toMatch(/^req_/)
    expect(res.headers.get('x-api-version')).toBe('v1')
    expect(res.headers.get('x-request-id')).toMatch(/^req_/)
  })

  test('validation envelope: bad phone → 400 with field-level issues', async () => {
    const c = new Client()
    await c.get('/api/v1/products')
    const { res, data } = await c.post('/api/v1/auth/login', { phone: '12345', password: 'x' })
    expect(res.status).toBe(400)
    expect(data.code).toBe('VALIDATION')
    const issues = (data.details as { issues: { path: string }[] }).issues
    expect(issues.some((i) => i.path === 'phone')).toBe(true)
  })

  test('pagination contract on products (?page=&limit=&sort=&order=)', async () => {
    const { res, data } = await patient.get('/api/v1/products?page=1&limit=4&sort=createdAt&order=asc')
    expect(res.status).toBe(200)
    expect(data.page).toBe(1)
    expect(data.limit).toBe(4)
    expect(Number(data.total)).toBeGreaterThan(0)
    expect(Number(data.pages)).toBeGreaterThan(0)
    expect((data.products as unknown[]).length).toBeLessThanOrEqual(4)
    // invalid sort falls back safely (whitelist), never 500
    const r2 = await patient.get('/api/v1/products?sort=;drop&order=weird')
    expect(r2.res.status).toBe(200)
  })

  // ═══════════ 2 · registration & questionnaire ═════════════════════════════

  test('patient self-registration (consent recorded, session issued)', async () => {
    const phone = uid()
    const { res, data } = await patient.post('/api/v1/auth/register', {
      phone, password: 'Pass1234x', firstName: 'محمدرضا', lastName: 'تستی', acceptTerms: true,
    })
    expect(res.status).toBe(200)
    expect((data.user as { role: string }).role).toBe('PATIENT')
    expect(patient.jar.get('ta_access')).toBeTruthy()
  })

  test('questionnaire submit → mizaj result (pure policy scoring)', async () => {
    const { data: active } = await patient.get('/api/v1/questionnaires/active')
    const q = active.questionnaire as { questions: { id: string; options: { id: string }[] }[] }
    expect(q).toBeTruthy()
    const answers = q.questions.map((qq) => ({ questionId: qq.id, optionId: qq.options[0].id }))
    const { res, data } = await patient.post('/api/v1/questionnaires/submit', { answers })
    expect(res.status).toBe(200)
    expect((data.response as { mizajFa: string }).mizajFa).toBeTruthy()
  })

  // ═══════════ 3 · image pipeline (quality gate + multipart) ════════════════

  test('tongue upload passes quality gate (VALIDATED)', async () => {
    const form = new FormData()
    form.append('file', tongueJpeg, 'tongue.jpg')
    form.append('type', 'TONGUE')
    const { res, data } = await patient.call('POST', '/api/v1/images/upload', { body: form })
    expect(res.status).toBe(200)
    expect(data.qualityOk).toBe(true)
    expect((data.image as { status: string }).status).toBe('VALIDATED')
    const img = data.image as { id: string; width: number }
    expect(img.width).toBeGreaterThanOrEqual(480)
    patientImageId = img.id
  })

  // ═══════════ 4 · case creation (atomic + async AI job) ════════════════════

  test('case creation → queued for Expert 1 (transactional)', async () => {
    const { res, data } = await patient.post('/api/v1/cases', {
      description: 'خشکی دهان صبحگاهی و زبان پرپوش',
      imageId: patientImageId,
      priority: 'NORMAL',
    })
    expect(res.status).toBe(200)
    const c = data.case as { id: string; code: string; status: string }
    expect(c.status).toBe('WAITING_FOR_EXPERT_1')
    caseId = c.id
  })

  test('AI analysis runs ASYNC (background job, ED-102) and lands on the case', async () => {
    let analyses: unknown[] = []
    for (let i = 0; i < 40 && analyses.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 500))
      const { data } = await patient.get(`/api/v1/cases/${caseId}`)
      analyses = caseView(data).aiAnalyses as unknown[]
    }
    expect(analyses.length).toBeGreaterThan(0)
  }, 30_000)

  test('validation: case without description → 400 VALIDATION', async () => {
    const { res, data } = await patient.post('/api/v1/cases', { imageId: patientImageId })
    expect(res.status).toBe(400)
    expect(data.code).toBe('VALIDATION')
  })

  // ═══════════ 5 · 18-action workflow (engine-guarded via services) ═══════

  test('CLAIM + SUBMIT_ASSESSMENT (Expert 1, AI-review loop)', async () => {
    const claim = await expert1.post(`/api/v1/cases/${caseId}/action`, { action: 'CLAIM' })
    expect(claim.res.status).toBe(200)
    const assess = await expert1.post(`/api/v1/cases/${caseId}/action`, {
      action: 'SUBMIT_ASSESSMENT',
      summary: 'غالب گرم و خشک؛ پوشش زبان افزایش یافته',
      diseases: [],
      aiAgreement: 'MODIFIED',
      aiComment: 'با کمی تفاوت',
    })
    expect(assess.res.status).toBe(200)
  })

  test('USER_APPROVE (patient gate G1)', async () => {
    const { res } = await patient.post(`/api/v1/cases/${caseId}/action`, { action: 'USER_APPROVE' })
    expect(res.status).toBe(200)
  })

  test('SUBMIT_PRESCRIPTION (version 1) then EXPERT2_REVIEW (pricing)', async () => {
    const pres = await expert1.post(`/api/v1/cases/${caseId}/action`, {
      action: 'SUBMIT_PRESCRIPTION',
      notes: 'رژیم غذایی اصلاح شود',
      items: [{ drugName: 'شربت سنبل‌الطیب', dosage: '۵ میلی‌لیتر', frequency: '۲ بار در روز', duration: '۷ روز' }],
    })
    expect(pres.res.status).toBe(200)

    const { data: detail } = await expert2.get(`/api/v1/cases/${caseId}`)
    const prescriptions = caseView(detail).prescriptions as { id: string; items: { id: string }[] }[]
    const p = prescriptions[0]
    const review = await expert2.post(`/api/v1/cases/${caseId}/action`, {
      action: 'EXPERT2_REVIEW',
      notes: 'کالا موجود است',
      items: p.items.map((it) => ({ id: it.id, available: true, missing: false, unitPrice: 160000 })),
    })
    expect(review.res.status).toBe(200)
  })

  test('DOCTOR_APPROVE (final medical gate G2)', async () => {
    const { res } = await doctor.post(`/api/v1/cases/${caseId}/action`, {
      action: 'DOCTOR_APPROVE', comment: 'تأیید می‌شود', followUpDays: 21,
    })
    expect(res.status).toBe(200)
  })

  test('CREATE_PROFORMA → order+invoice atomic (guard-first, idempotent)', async () => {
    const { res, data } = await operator.post(`/api/v1/cases/${caseId}/action`, {
      action: 'CREATE_PROFORMA', shippingCost: 50000,
    })
    expect(res.status).toBe(200)
    expect((data.order as { code: string }).code).toMatch(/^ORD-/)
    expect((data.invoice as { code: string }).code).toMatch(/^INV-/)
    const dup = await operator.post(`/api/v1/cases/${caseId}/action`, { action: 'CREATE_PROFORMA' })
    expect(dup.res.status).toBe(409)
  })

  test('CONFIRM_PROFORMA → ZARINPAL gateway → callback cascade → PAID', async () => {
    const confirm = await patient.post(`/api/v1/cases/${caseId}/action`, { action: 'CONFIRM_PROFORMA' })
    expect(confirm.res.status).toBe(200)

    // resolve the order id created by the proforma step
    const { data: detail } = await patient.get(`/api/v1/cases/${caseId}`)
    const orders = caseView(detail).orders as { id: string; status: string }[]
    const order = orders.find((o) => o.status === 'PENDING_CONFIRMATION' || o.status === 'PAYMENT_PENDING') || orders[0]
    expect(order).toBeTruthy()

    const start = await patient.post('/api/v1/payments', { orderId: order.id, method: 'ZARINPAL' })
    expect(start.res.status).toBe(200)
    const gatewayUrl = start.data.gatewayUrl as string
    expect(gatewayUrl).toContain('authority=')

    const cb1 = await patient.get(gatewayUrl)
    expect(cb1.res.status).toBe(200)
    const cb2 = await patient.get(gatewayUrl)
    expect(cb2.data.alreadyPaid).toBe(true)

    const { data: after } = await patient.get(`/api/v1/cases/${caseId}`)
    const paid = (caseView(after).orders as { status: string }[]).some((o) => o.status === 'PAID')
    expect(paid).toBe(true)
  })

  test('START_SHIPPING → MARK_DELIVERED → SCHEDULE_FOLLOWUP → COMPLETE_FOLLOWUP → CLOSED', async () => {
    const ship = await operator.post(`/api/v1/cases/${caseId}/action`, {
      action: 'START_SHIPPING', method: 'MOTORCYCLE', driverName: 'رضا', driverPhone: '09120000011', trackingCode: 'TRK-901',
    })
    expect(ship.res.status).toBe(200)
    const deliver = await operator.post(`/api/v1/cases/${caseId}/action`, { action: 'MARK_DELIVERED' })
    expect(deliver.res.status).toBe(200)
    const follow = await expert1.post(`/api/v1/cases/${caseId}/action`, { action: 'SCHEDULE_FOLLOWUP', days: 21 })
    expect(follow.res.status).toBe(200)
    const done = await expert1.post(`/api/v1/cases/${caseId}/action`, { action: 'COMPLETE_FOLLOWUP', note: 'بهبود کامل' })
    expect(done.res.status).toBe(200)

    const { data: detail } = await patient.get(`/api/v1/cases/${caseId}`)
    expect((caseView(detail) as unknown as { status: string }).status).toBe('CLOSED')
  })

  // ═══════════ 6 · shop checkout (transactional, stock-guarded) ═════════════

  test('shop: cart → atomic checkout (stock+cart in-tx) → card-to-card → operator verify', async () => {
    const { data: products } = await patient.get('/api/v1/products?limit=5')
    const items = products.products as { id: string; stock: number; price: number; nameFa: string }[]
    const available = items.find((p) => p.stock >= 2)
    expect(available).toBeTruthy()

    const add = await patient.post('/api/v1/cart', { productId: available!.id, quantity: 2 })
    expect(add.res.status).toBe(200)

    const checkout = await patient.post('/api/v1/orders')
    expect(checkout.res.status).toBe(200)
    const order = checkout.data.order as { id: string; code: string; total: number }
    const invoice = checkout.data.invoice as { code: string }
    expect(order.code).toMatch(/^ORD-/)
    expect(invoice.code).toMatch(/^INV-/)
    expect(order.total).toBe(available!.price * 2 + 50_000) // domain policy math

    // cart emptied atomically with the order
    const cart = await patient.get('/api/v1/cart')
    expect((cart.data.items as unknown[]).length).toBe(0)

    // stock decremented inside the same transaction
    const { data: after } = await patient.get('/api/v1/products?limit=60')
    const prod = (after.products as { id: string; stock: number }[]).find((p) => p.id === available!.id)
    expect(prod!.stock).toBe(available!.stock - 2)

    // card-to-card payment + receipt + operator verification
    const pay = await patient.post('/api/v1/payments', { orderId: order.id, method: 'CARD_TO_CARD' })
    expect(pay.res.status).toBe(200)
    const payment = pay.data.payment as { id: string }
    const receipt = await patient.post(`/api/v1/payments/${payment.id}/receipt`, { trackingCode: 'TRX-77', note: 'واریز شد' })
    expect(receipt.res.status).toBe(200)
    const verify = await operator.post(`/api/v1/payments/${payment.id}/verify`, { decision: 'APPROVE', note: 'تأیید رسید' })
    expect(verify.res.status).toBe(200)
    const dup = await operator.post(`/api/v1/payments/${payment.id}/verify`, { decision: 'APPROVE' })
    expect(dup.res.status).toBe(409)
  })

  // ═══════════ 7 · authorization & observability ════════════════════════════

  test('authorization: patient blocked from admin endpoints (403)', async () => {
    const { res } = await patient.get('/api/v1/admin/users')
    expect(res.status).toBe(403)
  })

  test('structured request logging emitted (logger → dev.log)', async () => {
    await patient.get('/api/v1/notifications')
    const { readFileSync } = await import('node:fs')
    const tail = readFileSync('/home/z/my-project/dev.log', 'utf8').slice(-30000)
    expect(tail).toContain('"svc":"babahakim-api"')
    expect(tail).toMatch(/"msg":"request"/)
  })
})
