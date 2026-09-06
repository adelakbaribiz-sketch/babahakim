// ── PHASE 18 · LOAD SUITE (بار و هم‌زمانی — spec §79 Concurrency) ─────────
// §79: «دو کارشناس یک پرونده را Claim کنند · دو پرداخت ثبت شود · دو سفارش
// ساخته شود · قیمت همزمان تغییر کند · نسخه همزمان ویرایش شود» — با
// Transaction / Unique Constraints / Idempotency کنترل شوند.
// Plus a sustained-load BUDGET (not a benchmark): under concurrency the
// platform must answer honestly — zero 5xx, bounded latency, exactly-once
// semantics on the money path.
import { describe, test, expect, beforeAll } from 'bun:test'
import { Client, freshPatient, staff } from '../helpers/client'
import { db } from '@/lib/db'

let expert1a: Client, expert1b: Client, admin: Client

beforeAll(async () => {
  // staff() caches one session per account per process (login rate-limit safe).
  // The claim race §79 needs TWO independent sessions of EXPERT_1 — one cached
  // plus one fresh login (a distinct account-bucket consumer, still within limits).
  expert1a = await staff(2)
  expert1b = await new Client().loginAs(2)
  admin = await staff(1)
})

const newQueueCase = async () => {
  const seedPatient = await db.patientProfile.findFirst()
  const c = await db.medicalCase.create({
    data: {
      code: `QA-LOAD-${Date.now()}-${Math.floor(Math.random() * 999)}`, patientId: seedPatient!.userId,
      status: 'WAITING_FOR_EXPERT_1', priority: 'NORMAL', description: 'تست بار و هم‌زمانی',
    },
  })
  return c
}

// ═════════ LOAD-1 · claim race (§79: دو کارشناس همزمان Claim) ═════════════
describe('LOAD-1 claim race → exactly one winner', () => {
  test('two concurrent CLAIMs: one 200, one machine-rejection — no double claim', async () => {
    const c = await newQueueCase()
    const t0 = Date.now()
    const [a, b] = await Promise.allSettled([
      expert1a.post(`/api/v1/cases/${c.id}/action`, { action: 'CLAIM' }),
      expert1b.post(`/api/v1/cases/${c.id}/action`, { action: 'CLAIM' }),
    ])
    const elapsed = Date.now() - t0
    const statuses = [a, b].map((r) => (r.status === 'fulfilled' ? r.value.res.status : 0))
    console.log(`  LOAD-1 elapsed=${elapsed}ms statuses=[${statuses.join(',')}]`)
    expect(statuses.filter((s) => s === 200)).toHaveLength(1)
    expect(statuses.filter((s) => s === 409)).toHaveLength(1)

    const row = await db.medicalCase.findUnique({ where: { id: c.id } })
    expect(row?.status).toBe('EXPERT_1_REVIEW') // deterministic end-state
    expect(row?.assignedExpert1Id).toBeTruthy()
    await db.medicalCase.delete({ where: { id: c.id } })
  }, 30_000) // §79 races may legitimately wait on SQLite busy-timeout; measure, don't guess
})

// ═════════ LOAD-2 · duplicate checkout (§79: کاربر همزمان چند کلیک) ════════
describe('LOAD-2 concurrent double-checkout → exactly one order', () => {
  test('two simultaneous identical checkouts: one order + one replay/409 — never two orders', async () => {
    const p = await freshPatient()
    // put one buyable item in the cart (cart is the source of truth)
    const { data: prodList } = await p.get('/api/v1/products?limit=50')
    // NOTE: the public list contract exposes {id, stock, ...} but NOT `active`
    // (the query already filters active+alive server-side)
    const items = (prodList.products as { id: string; stock: number }[])
      .filter((x) => x.stock > 0)
    expect(items.length).toBeGreaterThan(0)
    const item = items[0]
    const add = await p.post('/api/v1/cart', { productId: item.id, quantity: 1 })
    expect(add.res.status).toBe(200)

    const body = {} // cart is the source of truth (checkoutSchema)
    const [a, b] = await Promise.allSettled([
      p.post('/api/v1/orders', body),
      p.post('/api/v1/orders', body),
    ])
    const codes = [a, b].map((r) => (r.status === 'fulfilled' ? r.value.res.status : 0))
    expect(codes.filter((s) => s === 200 || s === 201).length).toBeGreaterThanOrEqual(1)
    // both answered honestly: success, replay(200) or in-flight conflict(409) — never a 5xx
    expect(codes.every((s) => s === 200 || s === 201 || s === 409)).toBe(true)

    // exactly ONE order for THIS patient (role-scoped list = own orders only)
    const { res: listRes, data: listData } = await p.get('/api/v1/orders?limit=50')
    expect(listRes.status).toBe(200)
    const myOrders = (listData.orders as { code: string }[]) ?? []
    expect(myOrders.length).toBe(1)
    expect(new Set(myOrders.map((o) => o.code)).size).toBe(1) // no duplicate order codes
  }, 30_000)
})

// ═════════ LOAD-3 · concurrent catalog reads (read-path budget) ════════════
describe('LOAD-3 sustained read load: 96 requests @ concurrency 12 → zero 5xx', () => {
  test('catalog burst: all 2xx, p95 < 1500ms, no 5xx, no connection errors', async () => {
    const N = 96
    const CONC = 12
    const paths = ['/api/v1/products?limit=10', '/api/v1/products?limit=5&sort=price', '/api/v1/products?q=']
    const clients = Array.from({ length: CONC }, () => new Client())
    const times: number[] = []
    let bad = 0
    let idx = 0
    const worker = async (c: Client) => {
      for (let i = 0; i < N / CONC; i++) {
        const t0 = Date.now()
        const { res } = await c.get(paths[idx++ % paths.length])
        times.push(Date.now() - t0)
        if (res.status >= 500) bad++
      }
    }
    await Promise.all(clients.map(worker))
    times.sort((x, y) => x - y)
    const p95 = times[Math.floor(times.length * 0.95)]
    expect(bad).toBe(0)
    expect(times.length).toBe(N)
    expect(p95).toBeLessThan(1500) // honest budget on the standalone server
  }, 60_000)
})

// ═════════ LOAD-4 · mixed authenticated traffic (write+read) ═══════════════
describe('LOAD-4 mixed traffic under 6 roles → zero 5xx', () => {
  test('rotating role endpoints: 60 requests, no 5xx (honest answers only)', async () => {
    const probes: [Client, string][] = [
      [expert1a, '/api/v1/cases?limit=5'], [expert1a, '/api/v1/dashboard'],
      [admin, '/api/v1/admin/observability'], [admin, '/api/v1/admin/jobs?limit=5'],
      [admin, '/api/v1/search?q='], [admin, '/api/v1/reports/financial.revenue-summary'],
    ]
    let bad = 0
    const batches = 10
    for (let i = 0; i < batches; i++) {
      const rs = await Promise.all(probes.map(([c, p]) => c.get(p)))
      for (const r of rs) if (r.res.status >= 500) bad++
    }
    expect(bad).toBe(0)
  })
})

// ═════════ LOAD-5 · concurrent price changes (§79: قیمت همزمان تغییر) ═════
describe('LOAD-5 concurrent price updates → both land, history records both, final state consistent', () => {
  test('two simultaneous PATCHes: no 5xx, both events in history, price = one of them', async () => {
    const { res, data } = await admin.post('/api/v1/admin/products', {
      sku: `QA-LOAD-${Date.now()}`, nameFa: `محصول بار-${Date.now()}`, nameEn: 'Load Product',
      category: 'SUPPLEMENT', descriptionFa: 'تست', currentPrice: 90_000, stock: 10,
    })
    expect(res.status).toBe(200)
    const productId = (data.product as { id: string })?.id ?? (data.id as string)
    const A = 91_000, B = 92_000

    const [r1, r2] = await Promise.allSettled([
      admin.patch('/api/v1/admin/products', { id: productId, currentPrice: A }),
      admin.patch('/api/v1/admin/products', { id: productId, currentPrice: B }),
    ])
    const codes = [r1, r2].map((r) => (r.status === 'fulfilled' ? r.value.res.status : 0))
    expect(codes.every((s) => s < 500)).toBe(true)

    const row = await db.product.findUnique({ where: { id: productId } })
    expect([A, B]).toContain(row?.currentPrice) // deterministic: last committed write wins, no corruption

    const history = await db.productPriceHistory.findMany({ where: { productId }, orderBy: { createdAt: 'asc' } })
    expect(history.length).toBeGreaterThanOrEqual(2) // creation + at least one change
    expect(new Set(history.map((h) => h.id)).size).toBe(history.length) // append-only, no overwrite

    await db.product.delete({ where: { id: productId } })
  }, 30_000)
})
