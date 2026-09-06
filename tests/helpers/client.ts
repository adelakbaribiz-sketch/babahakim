// ── PHASE 18 · shared test client ──────────────────────────────────────────
// Cookie-jar HTTP client with the Phase-05 CSRF double-submit contract,
// per-instance fake client IPs (isolated per-IP rate-limit buckets) and a
// seeded-account login helper. Extracted from api-golden-path.test.ts so the
// QA suites (contract / authz / database / load / regression) share ONE
// battle-tested transport instead of each re-implementing it.
export const BASE = 'http://localhost:3000'

export class Client {
  jar = new Map<string, string>()
  csrf = ''
  ip = `10.78.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`

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

  /** login one of the 6 seeded demo accounts (Pass1234) */
  async loginAs(n: number) {
    await this.get('/api/v1/products') // warm-up: CSRF cookie + awake server
    const { res } = await this.post('/api/v1/auth/login', { phone: `0912000000${n}`, password: 'Pass1234' })
    if (res.status !== 200) throw new Error(`loginAs(${n}) failed: ${res.status}`)
    return this
  }
}

// ── cached staff sessions ──────────────────────────────────────────────────
// The login endpoint rate-limits per ACCOUNT (5 / 5min, login:acct). Multiple
// suites in one `bun test` process each logging in the same demo account would
// 429 mid-run — a self-inflicted flake. Session cookies are valid for hours,
// so one login per account per process is both correct and faster.
const staffSessions = new Map<number, Client>()

export async function staff(n: number): Promise<Client> {
  const cached = staffSessions.get(n)
  if (cached) return cached
  const c = await new Client().loginAs(n)
  staffSessions.set(n, c)
  return c
}

export const uid = () => `0919${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 9)}`.slice(0, 11)

/** register a fresh patient and return the logged-in client */
export async function freshPatient() {
  const c = new Client()
  await c.get('/api/v1/products')
  const { res } = await c.post('/api/v1/auth/register', {
    phone: uid(), password: 'Pass1234', firstName: 'کاربر', lastName: 'تست کیفیت', acceptTerms: true,
  })
  if (res.status !== 200 && res.status !== 201) throw new Error(`register failed: ${res.status}`)
  return c
}
