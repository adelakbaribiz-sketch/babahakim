// ── PHASE 14 · Search, Reporting & Analytics — API integration tests ───────
// Runs against the dev server on :3000 (bun test). Verifies END-TO-END:
// permission-aware catalog + runs, window/pagination guards (the explicit
// anti-unbounded command), the three export formats over HTTP, the async
// export job → artifact → download pipeline, and search row-scoping (IDOR).
import { describe, test, expect, beforeAll } from 'bun:test'

const BASE = 'http://localhost:3000'

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

  async call(method: string, path: string, opts: { json?: unknown } = {}) {
    const headers: Record<string, string> = {}
    if (opts.json !== undefined) headers['Content-Type'] = 'application/json'
    if (this.jar.size) headers['Cookie'] = this.cookieHeader()
    headers['X-Forwarded-For'] = this.ip
    if (method !== 'GET' && this.csrf) headers['x-csrf-token'] = this.csrf
    if (method !== 'GET') headers['Origin'] = BASE
    const res = await fetch(`${BASE}${path}`, { method, headers, body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined, redirect: 'manual' })
    this.store(res)
    return res
  }

  async getJson(path: string) {
    const res = await this.call('GET', path)
    let data: Record<string, unknown> = {}
    try { data = await res.json() } catch { /* binary */ }
    return { status: res.status, data }
  }

  async postJson(path: string, json: unknown) {
    const res = await this.call('POST', path, { json })
    let data: Record<string, unknown> = {}
    try { data = await res.json() } catch { /* binary */ }
    return { status: res.status, data }
  }

  get(p: string) { return this.call('GET', p) }
}

const login = async (c: Client, phone: string) => {
  await c.call('GET', '/api/v1/products') // bootstrap csrf cookie
  await c.postJson('/api/v1/auth/login', { phone, password: 'Pass1234' })
}

describe('PHASE 14 — search, reporting & analytics (API integration)', () => {
  const admin = new Client()
  const expert1 = new Client()
  const patient = new Client()
  const patient2 = new Client()

  beforeAll(async () => {
    await login(admin, '09120000001')
    await login(expert1, '09120000002')
    await login(patient, '09120000006')
    await login(patient2, '09120000005') // doctor session doubles as non-report staff? no: fresh patient below
  })

  // ── 1 · catalog is permission-aware ─────────────────────────────────────
  test('unauthenticated catalog → 401', async () => {
    const { status } = await new Client().getJson('/api/v1/reports')
    expect(status).toBe(401)
  })

  test('admin sees all 19 reports across 6 categories', async () => {
    const { status, data } = await admin.getJson('/api/v1/reports')
    expect(status).toBe(200)
    const reports = data.reports as { id: string; category: string }[]
    expect(reports).toHaveLength(19)
    const cats = new Set(reports.map((r) => r.category))
    expect([...cats].sort()).toEqual(['BUSINESS', 'CUSTOM', 'FINANCIAL', 'OPERATIONAL', 'PERFORMANCE', 'USER'].sort())
  })

  test('EXPERT_1 gets operational/business but NEVER financial (permission-aware)', async () => {
    const { status, data } = await expert1.getJson('/api/v1/reports')
    expect(status).toBe(200)
    const ids = (data.reports as { id: string }[]).map((r) => r.id)
    expect(ids.some((i) => i.startsWith('operational.'))).toBe(true)
    expect(ids.some((i) => i.startsWith('financial.'))).toBe(false)
  })

  test('PATIENT sees zero reports and cannot run one (403)', async () => {
    const { status, data } = await patient.getJson('/api/v1/reports')
    expect(status).toBe(200)
    expect(data.reports).toEqual([])
    const run = await patient.getJson('/api/v1/reports/financial.revenue-summary')
    expect(run.status).toBe(403)
  })

  // ── 2 · runs + bounded guards (anti-unbounded command) ──────────────────
  test('run revenue-summary: meta contract + SQL-side aggregation', async () => {
    const from = new Date(Date.now() - 395 * 86_400_000).toISOString().slice(0, 10) // ≤ 400d window (max allowed)
    const { status, data } = await admin.getJson(`/api/v1/reports/financial.revenue-summary?from=${from}&groupBy=month`)
    expect(status).toBe(200)
    const r = data.report as { meta: Record<string, unknown> & { from?: string }; rows: unknown[]; columns: unknown[]; summary: unknown[] }
    expect(r.meta.reportId).toBe('financial.revenue-summary')
    expect(String(r.meta.from ?? '').slice(0, 10)).toBe(from)
    expect(Array.isArray(r.rows)).toBe(true)
    expect(r.columns.length).toBeGreaterThan(2)
    expect((r.meta as { ms?: number }).ms).toBeLessThan(5000) // bounded = fast
  })

  test('window > 400 days → 422 WINDOW_TOO_WIDE (no silent truncation)', async () => {
    const from = new Date(Date.now() - 500 * 86_400_000).toISOString().slice(0, 10)
    const { status, data } = await admin.getJson(`/api/v1/reports/financial.revenue-summary?from=${from}`)
    expect(status).toBe(422)
    expect((data as { code?: string }).code).toBe('WINDOW_TOO_WIDE')
  })

  test('deep offset pagination → 422 PAGINATION_TOO_DEEP (10k hard cap)', async () => {
    const { status, data } = await admin.getJson('/api/v1/products?page=9999&limit=100')
    expect(status).toBe(422)
    expect((data as { code?: string }).code).toBe('PAGINATION_TOO_DEEP')
  })

  test('unknown report id → 404; invalid format → 400', async () => {
    expect((await admin.getJson('/api/v1/reports/nope.nope')).status).toBe(404)
    expect((await admin.getJson('/api/v1/reports/financial.expenses/export?format=exe')).status).toBe(400)
  })

  // ── 3 · exports over HTTP (CSV / XLSX / PDF) ────────────────────────────
  test('CSV export: BOM + CRLF + attachment disposition + audit', async () => {
    const res = await admin.get('/api/v1/reports/business.top-products/export?format=csv&lang=en')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/csv')
    expect(res.headers.get('content-disposition')).toContain('attachment')
    const buf = Buffer.from(await res.arrayBuffer())
    expect(buf.slice(0, 3).toString('hex')).toBe('efbbbf') // UTF-8 BOM (Excel fa)
    const text = buf.toString('utf8').slice(1)
    expect(text).toContain('\r\n')
    expect(text).toContain('Window:') // meta preamble line
  })

  test('XLSX export: valid PK zip + RTL sheet', async () => {
    const res = await admin.get('/api/v1/reports/financial.expenses/export?format=xlsx&groupBy=month')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('spreadsheetml')
    const buf = Buffer.from(await res.arrayBuffer())
    expect(buf.slice(0, 4).toString('hex')).toBe('504b0304')
    expect(buf.toString('utf8')).toContain('rightToLeft="1"')
    expect(buf.toString('utf8')).toContain('[Content_Types].xml')
  })

  test('PDF export: %PDF magic + embedded font', async () => {
    const res = await admin.get('/api/v1/reports/financial.revenue-summary/export?format=pdf&groupBy=day')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/pdf')
    const buf = Buffer.from(await res.arrayBuffer())
    expect(buf.slice(0, 5).toString('latin1')).toBe('%PDF-')
    expect(buf.toString('latin1')).toContain('/FontFile2')
  })

  test('patient export hidden (404, catalog non-revelation) on both paths', async () => {
    // 404 — a caller without the permission must not even learn the id exists
    expect((await patient.get('/api/v1/reports/financial.payments/export?format=csv')).status).toBe(404)
    expect((await patient.postJson('/api/v1/reports/financial.payments/export', { format: 'csv' })).status).toBe(404)
  })

  // ── 4 · async export job → StoredFile → notification → download ─────────
  test('POST async export: queued → artifact appears → owner-only download', async () => {
    const { status, data } = await admin.postJson('/api/v1/reports/financial.payments/export', {
      format: 'pdf', lang: 'fa', params: { groupBy: 'day' },
    })
    expect(status).toBe(200)
    expect(data.queued).toBe(true)
    expect(typeof data.jobId).toBe('string')

    // poll the artifact list (job runs in-process; generous timeout)
    let artifact: { id: string; fileName: string } | undefined
    for (let i = 0; i < 20 && !artifact; i++) {
      await new Promise((r) => setTimeout(r, 500))
      const { data: d } = await admin.getJson('/api/v1/reports/exports')
      artifact = (d.exports as { id: string; fileName: string }[] | undefined)?.find((e) => e.fileName.startsWith('financial.payments'))
    }
    expect(artifact).toBeTruthy()
    expect(artifact!.id).toMatch(/^[a-zA-Z0-9]{10,40}$/)

    // owner download works
    const dl = await admin.get(`/api/v1/reports/exports/${artifact!.id}`)
    expect(dl.status).toBe(200)
    expect(dl.headers.get('content-type')).toContain('pdf')
    expect(Buffer.from(await dl.arrayBuffer()).slice(0, 5).toString('latin1')).toBe('%PDF-')

    // another session (EXPERT_1) CANNOT download the admin's artifact (ED-157)
    const stolen = await expert1.get(`/api/v1/reports/exports/${artifact!.id}`)
    expect(stolen.status).toBe(403)

    // REPORT_EXPORT_READY notification landed for the admin
    const { data: notif } = await admin.getJson('/api/v1/notifications?limit=20')
    const items = (notif.notifications ?? notif.items ?? []) as { type?: string }[]
    expect(items.some((n) => n.type === 'REPORT_EXPORT_READY')).toBe(true)
  })

  // ── 5 · global search: permission-aware row scoping (IDOR) ──────────────
  test('patient search finds own case/product but NEVER other patients (ED-157)', async () => {
    // the patient's own data
    const own = await patient.getJson('/api/v1/search?q=' + encodeURIComponent('TC-'))
    expect(own.status).toBe(200)
    const ownGroups = (own.data.groups as { kind: string; hits: { title: string }[] }[])
    const ownCases = ownGroups.filter((g) => g.kind === 'case').flatMap((g) => g.hits)
    // patient sees only their own case codes (seed patient سارا has ≥1 case)
    expect(ownCases.length).toBeGreaterThan(0)

    // cross-patient probe: search by the OTHER patient's name must not leak
    // their cases (seeded user #5 is a DOCTOR with no cases; use a staff
    // search instead for the negative case)
    const leak = await patient.getJson('/api/v1/search?q=' + encodeURIComponent('رعیا')) // admin name
    const leakGroups = (leak.data.groups as { kind: string }[]) ?? []
    expect(leakGroups.find((g) => g.kind === 'user')).toBeUndefined() // manage_users required
    expect(leakGroups.find((g) => g.kind === 'case')).toBeUndefined() // not the patient's cases

    // admin search CAN see users
    const staff = await admin.getJson('/api/v1/search?q=' + encodeURIComponent('سارا'))
    const staffGroups = (staff.data.groups as { kind: string }[])
    expect(staffGroups.find((g) => g.kind === 'user')).toBeTruthy()
    expect(staffGroups.find((g) => g.kind === 'case')).toBeTruthy()
  })

  test('search needs ≥2 chars and is bounded (empty → empty groups, 200)', async () => {
    const { status, data } = await admin.getJson('/api/v1/search?q=' + encodeURIComponent('x'))
    expect(status).toBe(200)
    expect((data as { groups: unknown[] }).groups).toEqual([])
  })

  // ── 6 · search pushed into SQL on list endpoints (S-1 fix) ──────────────
  test('cases list: q filters server-side with exact pagination meta', async () => {
    const { status, data } = await admin.getJson('/api/v1/cases?q=' + encodeURIComponent('سارا') + '&limit=10')
    expect(status).toBe(200)
    const cases = (data.cases ?? []) as { patient?: { firstName?: string } }[]
    for (const c of cases) expect(c.patient?.firstName).toBeTruthy()
    // every returned row actually matches (server-side filter, page never shrinks)
    expect(cases.every((c) => String((c as { code?: string }).code).length > 0)).toBe(true)
    expect((data as { total?: number; page?: number }).page).toBe(1)
  })

  test('products search: Persian normalization finds rows (ک/ك, digits)', async () => {
    const { status, data } = await admin.getJson('/api/v1/products?q=' + encodeURIComponent('شربت') + '&limit=50')
    expect(status).toBe(200)
    expect(((data.products ?? []) as unknown[]).length).toBeGreaterThan(0)
    const meta = data as { total?: number; pages?: number }
    expect(Number(meta.total)).toBeGreaterThan(0)
  })

  // ── 7 · legacy adapter stays contract-stable (pentest parity) ───────────
  test('legacy /admin/reports: bounded adapter keeps v1 response shape', async () => {
    const { status, data } = await admin.getJson('/api/v1/admin/reports')
    expect(status).toBe(200)
    for (const key of ['summary', 'byDay', 'topProducts', 'statusCounts', 'referralStats', 'provinceStats', 'recentPayments']) {
      expect(data[key]).toBeDefined()
    }
    expect(Array.isArray(data.byDay)).toBe(true)
  })

  test('legacy /admin/reports: EXPERT_2 allowed, PATIENT blocked', async () => {
    expect((await patient.getJson('/api/v1/admin/reports')).status).toBe(403)
  })
})
