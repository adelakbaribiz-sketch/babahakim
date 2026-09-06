// ── PHASE 16 · Performance Engineering — API integration tests ─────────────
// Runs against the dev server on :3000 (bun test). Verifies END-TO-END:
//   • identity cache (ED-183): repeated /me hits stop re-querying User
//   • cache invalidation SECURITY contract: admin deactivation lands on the
//     very next request — invalidation, not TTL, is the guard
//   • dashboard batching equivalence (ED-184): groupBy stats == direct counts
//   • SQLite tuning (ED-182): journal_mode == wal on the live DB file
//   • index inventory (ED-181): the measured hot-path indexes exist in SQLite
import { describe, test, expect, beforeAll } from 'bun:test'
import { PrismaClient } from '@prisma/client'

const BASE = 'http://localhost:3000'
const db = new PrismaClient()

class Client {
  jar = new Map<string, string>()
  csrf = ''
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
    if (method !== 'GET' && this.csrf) headers['x-csrf-token'] = this.csrf
    if (method !== 'GET') headers['Origin'] = BASE
    const res = await fetch(`${BASE}${path}`, { method, headers, body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined, redirect: 'manual' })
    this.store(res)
    return res
  }
  async getJson(path: string) {
    const res = await this.call('GET', path)
    let data: Record<string, unknown> = {}
    try { data = await res.json() } catch { /* non-json */ }
    return { status: res.status, data }
  }
  async postJson(path: string, json: unknown) {
    const res = await this.call('POST', path, { json })
    let data: Record<string, unknown> = {}
    try { data = await res.json() } catch { /* non-json */ }
    return { status: res.status, data }
  }
  async patchJson(path: string, json: unknown) {
    const res = await this.call('PATCH', path, { json })
    return res
  }
}

const login = async (c: Client, phone: string) => {
  await c.call('GET', '/api/v1/products')
  await c.postJson('/api/v1/auth/login', { phone, password: 'Pass1234' })
}

let admin: Client
let patient: Client
let patientRow: { id: string; isActive: boolean }

beforeAll(async () => {
  admin = new Client()
  await login(admin, '09120000001')
  patient = new Client()
  await login(patient, '09120000006')
  patientRow = await db.user.findUniqueOrThrow({ where: { phone: '09120000006' }, select: { id: true, isActive: true } })
})

describe('PHASE 16 — identity cache (ED-183)', () => {
  test('repeated requests stop re-querying the User table (getAuth cache)', async () => {
    // /me is a poor probe: me() itself fetches the full profile row (a
    // legitimate data query). Use an endpoint whose only User lookup was
    // getAuth's identity check — before ED-183 every call re-read the row.
    await patient.getJson('/api/v1/notifications?limit=1') // warm (may already be cached — fine)
    const before = await userQueryCount()
    for (let i = 0; i < 5; i++) {
      const r = await patient.getJson('/api/v1/notifications?limit=1')
      expect(r.status).toBe(200)
    }
    const delta = (await userQueryCount()) - before
    // pre-ED-183 this was 5 identity lookups; with the cache it is ≤2
    // (≤2 absorbs an unrelated background User lookup in the same window)
    expect(delta).toBeLessThanOrEqual(2)
  })

  test('admin deactivation lands on the NEXT request (invalidation, not TTL)', async () => {
    const me1 = await patient.getJson('/api/v1/auth/me')
    expect(me1.status).toBe(200)

    // deactivate through the admin API (which must invalidate the cache)
    const res = await admin.patchJson('/api/v1/admin/users', { id: patientRow.id, isActive: false })
    expect(res.status).toBe(200)

    const me2 = await patient.getJson('/api/v1/auth/me')
    expect(me2.status).toBe(401) // immediate — never a stale 200

    // restore for the rest of the suite
    const back = await admin.patchJson('/api/v1/admin/users', { id: patientRow.id, isActive: true })
    expect(back.status).toBe(200)
    const me3 = await patient.getJson('/api/v1/auth/me')
    expect(me3.status).toBe(200)
  })
})

describe('PHASE 16 — dashboard batching equivalence (ED-184)', () => {
  // PHASE 18 (test-quality fix): dash:staff:shared is a 15s TTL cache with NO
  // invalidation path (by design — ED-184). The old assertion compared a
  // possibly-stale CACHED block against fresh direct counts, which passed only
  // while suites registered few users. With the PHASE 18 suites registering
  // several patients per run, the stale-cache window broke the test through no
  // fault of the batched queries. The equivalence now verifies the QUERY
  // LOGIC: on mismatch, wait out the TTL so the cache rebuilds, then re-compare.
  async function staffEquivalence(): Promise<{ ok: boolean; detail?: string; r?: ReturnType<typeof admin.getJson> extends Promise<infer R> ? R : never }> {
    const r = await admin.getJson('/api/v1/dashboard')
    if (r.status !== 200) return { ok: false, detail: `dashboard ${r.status}` }
    const stats = r.data.stats as Record<string, number>
    const [totalCases, waiting1, waiting2, waitingDoc, paidOrders, totalPatients] = await Promise.all([
      db.medicalCase.count(),
      db.medicalCase.count({ where: { status: 'WAITING_FOR_EXPERT_1' } }),
      db.medicalCase.count({ where: { status: 'WAITING_FOR_EXPERT_2' } }),
      db.medicalCase.count({ where: { status: 'WAITING_FOR_DOCTOR' } }),
      db.order.count({ where: { status: 'PAID' } }),
      db.user.count({ where: { role: 'PATIENT' } }),
    ])
    const checks: [unknown, unknown, string][] = [
      [stats.totalCases, totalCases, 'totalCases'],
      [stats.pendingExpert1, waiting1, 'pendingExpert1'],
      [stats.pendingExpert2, waiting2, 'pendingExpert2'],
      [stats.pendingDoctor, waitingDoc, 'pendingDoctor'],
      [stats.paidOrders, paidOrders, 'paidOrders'],
      [stats.totalPatients, totalPatients, 'totalPatients'],
    ]
    for (const [got, want, name] of checks) {
      if (got !== want) return { ok: false, detail: `${name}: api=${got} db=${want}`, r }
    }
    return { ok: true, r }
  }

  test('staff stats (groupBy) equal direct counts (cache-aware)', async () => {
    let res = await staffEquivalence()
    if (!res.ok) {
      // a stale dash:staff:shared entry — let the 15s TTL expire and rebuild
      await new Promise((resolve) => setTimeout(resolve, 16_000))
      res = await staffEquivalence()
    }
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error(res.detail)
    // shape contract: queue + recentEvents still present (ED-184 refactor)
    expect(Array.isArray((res.r?.data as { queue?: unknown }).queue)).toBe(true)
    expect(Array.isArray((res.r?.data as { recentEvents?: unknown }).recentEvents)).toBe(true)
    const stats = (res.r!.data as { stats: Record<string, number> }).stats
    expect(stats.unreadSelf).toBeGreaterThanOrEqual(0)
  }, 45_000)

  test('patient stats (batched groupBy) equal direct counts', async () => {
    const r = await patient.getJson('/api/v1/dashboard')
    expect(r.status).toBe(200)
    const stats = r.data.stats as Record<string, number>
    const userId = patientRow.id
    const [totalCases, activeCases, totalOrders] = await Promise.all([
      db.medicalCase.count({ where: { patientId: userId } }),
      db.medicalCase.count({ where: { patientId: userId, status: { notIn: ['CLOSED', 'CANCELLED'] } } }),
      db.order.count({ where: { userId } }),
    ])
    expect(stats.totalCases).toBe(totalCases)
    expect(stats.activeCases).toBe(activeCases)
    expect(stats.totalOrders).toBe(totalOrders)
  })
})

describe('PHASE 16 — SQLite tuning + index inventory (ED-181/182)', () => {
  test('journal_mode is WAL on the live database', async () => {
    const rows = await db.$queryRaw<{ journal_mode: string }[]>`PRAGMA journal_mode`
    expect(rows[0]?.journal_mode).toBe('wal')
  })

  test('measured hot-path indexes exist in SQLite', async () => {
    const names = await db.$queryRaw<{ name: string }[]>`
      SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'`
    const have = new Set(names.map((r) => r.name))
    const required = [
      'MedicalCase_patientId_createdAt_idx', 'MedicalCase_status_createdAt_idx', 'MedicalCase_createdAt_idx',
      'Order_userId_createdAt_idx', 'Order_status_createdAt_idx', 'Order_createdAt_idx',
      'Payment_status_createdAt_idx', 'Payment_orderId_idx',
      'Ticket_userId_updatedAt_idx', 'TicketMessage_ticketId_createdAt_idx',
      'CaseEvent_caseId_createdAt_idx', 'CaseEvent_createdAt_idx',
      'AIAnalysis_caseId_idx', 'MedicalImage_caseId_createdAt_idx',
      'Invoice_orderId_idx', 'OrderItem_orderId_idx',
      'Notification_userId_read_createdAt_idx', 'FollowUp_status_idx', 'FollowUp_patientId_dueDate_idx',
      'AuditLog_createdAt_idx', 'AuditLog_userId_createdAt_idx', 'AuditLog_action_createdAt_idx',
      'SMSLog_sentAt_idx', 'QuestionnaireResponse_userId_createdAt_idx',
      'Diagnosis_caseId_idx', 'Prescription_caseId_createdAt_idx', 'FinancialTransaction_type_createdAt_idx',
    ]
    for (const name of required) {
      expect(have.has(name)).toBe(true)
    }
  })
})

// ── helpers ────────────────────────────────────────────────────────────────
async function userQueryCount(): Promise<number> {
  const res = await admin.getJson('/api/v1/admin/observability')
  const counters = ((res.data as { metrics?: { counters?: Record<string, number> } }).metrics?.counters ?? {}) as Record<string, number>
  let total = 0
  for (const [k, v] of Object.entries(counters)) {
    if (k.includes('db_queries_total') && k.includes('User')) total += v
  }
  return total
}
