// ── PHASE 08 · Backend Core Unit Tests ────────────────────────────────────
// Cross-cutting infrastructure: error taxonomy, query contract, cache,
// events, jobs, domain policies, envelope. Pure units — no DB, no HTTP.
import { describe, test, expect, beforeEach } from 'bun:test'
import {
  AppError, toAppError, ValidationError, AuthRequiredError, ForbiddenError,
  NotFoundError, ConflictError, BusinessRuleError, RateLimitError, InternalError,
} from '@/server/core/errors'
import { parseListQuery } from '@/server/api/query'
import { errorBody, listMeta } from '@/server/api/envelope'
import { cached, cacheStore } from '@/server/infrastructure/cache'
import { publish, subscribe, Events } from '@/server/infrastructure/events'
import { enqueue, registerJob, deadLetters, queueStats, __internals } from '@/server/infrastructure/jobs'
import {
  computeTotals, assertStockAvailable, assertCartHasItems, SHOP_SHIPPING_COST,
  minAnswersRequired, determineMizaj, emptyScores, assertEnoughAnswers,
  assertOrderPayable, assertNoActivePayment, assertCaseImageUsable, assertQuestionnaireCompleted,
} from '@/server/domain/policies'

// ════════════════════════ ERROR TAXONOMY (ED-94) ═══════════════════════════

describe('error taxonomy', () => {
  test('AppError base carries code/status/details', () => {
    const e = new AppError('CONFLICT', 'x', 409, { a: 1 })
    expect(e.code).toBe('CONFLICT')
    expect(e.httpStatus).toBe(409)
    expect(e.details).toEqual({ a: 1 })
    expect(e instanceof Error).toBe(true)
  })

  test('each subclass maps to its HTTP status', () => {
    expect(new ValidationError().httpStatus).toBe(400)
    expect(new AuthRequiredError().httpStatus).toBe(401)
    expect(new ForbiddenError().httpStatus).toBe(403)
    expect(new NotFoundError().httpStatus).toBe(404)
    expect(new ConflictError().httpStatus).toBe(409)
    expect(new BusinessRuleError('r').httpStatus).toBe(422)
    expect(new RateLimitError().httpStatus).toBe(429)
    expect(new InternalError().httpStatus).toBe(500)
  })

  test('toAppError passes AppError through untouched', () => {
    const orig = new NotFoundError('پرونده')
    expect(toAppError(orig)).toBe(orig)
  })

  test('toAppError maps ZodError (v4 issues) → VALIDATION 400', () => {
    const zodErr = Object.assign(new Error('validation'), {
      name: 'ZodError',
      issues: [{ path: ['phone'], message: 'bad', code: 'invalid_format' }],
    })
    const e = toAppError(zodErr)
    expect(e.code).toBe('VALIDATION')
    expect(e.httpStatus).toBe(400)
    expect((e.details as { issues: unknown[] }).issues).toHaveLength(1)
  })

  test('toAppError maps Prisma P2002 → CONFLICT 409, P2025 → NOT_FOUND 404', () => {
    expect(toAppError({ code: 'P2002', meta: { target: ['sku'] } }).code).toBe('CONFLICT')
    expect(toAppError({ code: 'P2025' }).code).toBe('NOT_FOUND')
  })

  test('toAppError collapses unknown throwables → INTERNAL with details', () => {
    const e = toAppError(new Error('boom'))
    expect(e.code).toBe('INTERNAL')
    expect(e.httpStatus).toBe(500)
    expect(e.message).not.toContain('boom') // never leaked to clients
    expect((e.details as { thrown: { name: string } }).thrown.name).toBe('Error')
  })
})

// ════════════════════════ PAGINATION CONTRACT (ED-100) ═════════════════════

describe('parseListQuery', () => {
  const url = (qs: string) => `http://x/api?${qs}`

  test('defaults: page 1, limit 20, createdAt desc', () => {
    const q = parseListQuery(url(''))
    expect(q.page).toBe(1)
    expect(q.limit).toBe(20)
    expect(q.offset).toBe(0)
    expect(q.sort).toBe('createdAt')
    expect(q.order).toBe('desc')
    expect(q.q).toBe('')
  })

  test('respects page/limit and computes offset', () => {
    const q = parseListQuery(url('page=3&limit=10'))
    expect(q.offset).toBe(20)
  })

  test('clamps garbage and out-of-range values (never throws)', () => {
    const q = parseListQuery(url('page=-5&limit=99999&order=side&sort=evil;drop'))
    expect(q.page).toBe(1)
    expect(q.limit).toBe(100) // maxLimit default
    expect(q.order).toBe('desc')
    expect(q.sort).toBe('createdAt') // whitelist fallback
  })

  test('sortable whitelist + custom defaults', () => {
    const q = parseListQuery(url('sort=total&order=asc'), { sortable: ['total', 'code'], defaultOrder: 'asc' })
    expect(q.sort).toBe('total')
    expect(q.order).toBe('asc')
  })

  test('q is trimmed and capped at 120 chars', () => {
    const q = parseListQuery(url('q=' + 'a'.repeat(200)))
    expect(q.q.length).toBe(120)
  })

  test('listMeta computes pages with min 1', () => {
    expect(listMeta(1, 20, 45)).toEqual({ page: 1, limit: 20, total: 45, pages: 3 })
    expect(listMeta(2, 20, 0).pages).toBe(1)
  })

  test('errorBody keeps `error` first + adds code/requestId', () => {
    const body = errorBody(new NotFoundError('x'), 'req_1') as Record<string, unknown>
    expect(Object.keys(body)[0]).toBe('error')
    expect(body.code).toBe('NOT_FOUND')
    expect(body.requestId).toBe('req_1')
    expect(body.details).toBeUndefined()
  })
})

// ════════════════════════ CACHE (ED-98) ════════════════════════════════════

describe('cache', () => {
  beforeEach(async () => {
    await cacheStore.clearPrefix('') // full clear
  })

  test('set/get round-trip and TTL expiry', async () => {
    await cacheStore.set('k', { v: 1 }, 50)
    expect(await cacheStore.get('k')).toEqual({ v: 1 })
    await new Promise((r) => setTimeout(r, 70))
    expect(await cacheStore.get('k')).toBeUndefined()
  })

  test('cached() loads once (stampede-safe) and caches result', async () => {
    let calls = 0
    const loader = async () => { calls++; return calls }
    expect(await cached('stamp', 1000, loader)).toBe(1)
    expect(await cached('stamp', 1000, loader)).toBe(1) // served from cache
    expect(calls).toBe(1)
  })

  test('cached() never caches loader errors', async () => {
    let calls = 0
    const bad = async () => { calls++; throw new Error('no') }
    await expect(cached('err', 1000, bad)).rejects.toThrow('no')
    calls = 0
    const good = async () => { calls++; return 'ok' }
    expect(await cached('err', 1000, good)).toBe('ok') // key not poisoned
  })

  test('clearPrefix removes only matching keys', async () => {
    await cacheStore.set('catalog:products:1', 'a', 1000)
    await cacheStore.set('catalog:products:2', 'b', 1000)
    await cacheStore.set('dash:admin:1', 'c', 1000)
    const n = await cacheStore.clearPrefix('catalog:products:')
    expect(n).toBe(2)
    expect(await cacheStore.get('dash:admin:1')).toBe('c')
    expect(await cacheStore.get('catalog:products:1')).toBeUndefined()
  })
})

// ════════════════════════ EVENT BUS (ED-99) ════════════════════════════════

describe('event bus', () => {
  test('publish reaches subscribers with envelope shape', async () => {
    const seen: unknown[] = []
    const off = subscribe(Events.OrderCreated, (e) => { seen.push(e) })
    await publish(Events.OrderCreated, { code: 'ORD-1' }, 'req_9')
    off()
    expect(seen).toHaveLength(1)
    const ev = seen[0] as { name: string; payload: unknown; at: string; reqId?: string }
    expect(ev.name).toBe(Events.OrderCreated)
    expect(ev.payload).toEqual({ code: 'ORD-1' })
    expect(ev.reqId).toBe('req_9')
    expect(typeof ev.at).toBe('string')
  })

  test('failing handlers are isolated — publish never throws', async () => {
    const ok: number[] = []
    subscribe('bh.test.x', () => { throw new Error('handler boom') })
    subscribe('bh.test.x', () => { ok.push(1) })
    await expect(publish('bh.test.x', {})).resolves.toBeUndefined()
    expect(ok).toHaveLength(1) // sibling handler still ran
  })

  test('unsubscribe works', async () => {
    let hits = 0
    const off = subscribe('bh.test.off', () => { hits++ })
    await publish('bh.test.off', {})
    off()
    await publish('bh.test.off', {})
    expect(hits).toBe(1)
  })
})

// ════════════════════════ JOB QUEUE (ED-102) ═══════════════════════════════

describe('job queue', () => {
  beforeEach(() => { __internals.reset() })

  test('enqueue → handler runs via drain', async () => {
    const got: string[] = []
    registerJob('bh.t.hello', async (p: { who: string }) => { got.push(p.who) })
    enqueue('bh.t.hello', { who: 'a' })
    await __internals.drain()
    expect(got).toEqual(['a'])
    expect(queueStats().pending).toBe(0)
  })

  test('retry with backoff, then dead-letter after max attempts', async () => {
    let attempts = 0
    registerJob('bh.t.flaky', async () => { attempts++; throw new Error('always fails') })
    enqueue('bh.t.flaky', {}, { maxAttempts: 2, backoffMs: 10 })
    await __internals.drain() // attempt 1 → requeued with backoff
    expect(attempts).toBe(1)
    expect(queueStats().pending).toBe(1)
    await new Promise((r) => setTimeout(r, 30)) // let backoff elapse
    await __internals.drain() // attempt 2 → dead-letter
    expect(attempts).toBe(2)
    expect(deadLetters()).toHaveLength(1)
    expect(deadLetters()[0].type).toBe('bh.t.flaky')
  })

  test('unregistered job types drop to dead-letter (no crash)', async () => {
    enqueue('bh.t.unknown', {})
    await __internals.drain()
    expect(deadLetters()).toHaveLength(1)
  })

  test('enqueue returns a stable job id', () => {
    const id = enqueue('bh.t.id', {})
    expect(id).toMatch(/^job_/)
  })
})

// ════════════════════════ DOMAIN POLICIES ══════════════════════════════════

describe('order policies', () => {
  test('computeTotals: subtotal + fixed shipping = total', () => {
    const t = computeTotals([{ unitPrice: 100_000, quantity: 2 }, { unitPrice: 50_000, quantity: 1 }])
    expect(t.subtotal).toBe(250_000)
    expect(t.shippingCost).toBe(SHOP_SHIPPING_COST)
    expect(t.total).toBe(300_000)
  })

  test('assertStockAvailable throws BusinessRuleError with product context', () => {
    expect(() =>
      assertStockAvailable([{ productId: 'p1', unitPrice: 1, quantity: 3, stock: 2, nameFa: 'قرص', nameEn: 'pill', requiresPrescription: true }]),
    ).toThrow(BusinessRuleError)
    expect(() =>
      assertStockAvailable([{ productId: 'p1', unitPrice: 1, quantity: 2, stock: 2, nameFa: 'قرص', nameEn: 'pill', requiresPrescription: false }]),
    ).not.toThrow()
  })

  test('assertCartHasItems rejects empty carts', () => {
    expect(() => assertCartHasItems(0)).toThrow(ValidationError)
    expect(() => assertCartHasItems(3)).not.toThrow()
  })
})

describe('questionnaire policies', () => {
  test('minAnswersRequired = ceil(60%)', () => {
    expect(minAnswersRequired(15)).toBe(9)
    expect(minAnswersRequired(10)).toBe(6)
    expect(minAnswersRequired(0)).toBe(0)
  })

  test('assertEnoughAnswers enforces the 60% rule', () => {
    expect(() => assertEnoughAnswers(8, 15)).toThrow(ValidationError)
    expect(() => assertEnoughAnswers(9, 15)).not.toThrow()
  })

  test('determineMizaj — balanced and all 8 dominant labels', () => {
    expect(determineMizaj({ HOT: 10, COLD: 10, WET: 10, DRY: 10 }).mizajFa).toBe('معتدل')
    expect(determineMizaj({ HOT: 20, COLD: 5, WET: 5, DRY: 20 }).mizajEn).toBe('Hot & Dry')
    expect(determineMizaj({ HOT: 20, COLD: 5, WET: 20, DRY: 5 }).mizajFa).toBe('گرم و تر')
    expect(determineMizaj({ HOT: 5, COLD: 20, WET: 5, DRY: 20 }).mizajFa).toBe('سرد و خشک')
    expect(determineMizaj({ HOT: 5, COLD: 20, WET: 20, DRY: 5 }).mizajFa).toBe('سرد و تر')
    expect(determineMizaj({ HOT: 20, COLD: 5, WET: 10, DRY: 10 }).mizajFa).toBe('غالباً گرم')
    expect(determineMizaj({ HOT: 5, COLD: 20, WET: 10, DRY: 10 }).mizajFa).toBe('غالباً سرد')
    expect(determineMizaj({ HOT: 10, COLD: 10, WET: 5, DRY: 20 }).mizajFa).toBe('غالباً خشک')
    expect(determineMizaj({ HOT: 10, COLD: 10, WET: 20, DRY: 5 }).mizajFa).toBe('غالباً تر')
  })

  test('determineMizaj summary lists all four scores', () => {
    const { summaryFa } = determineMizaj({ HOT: 1, COLD: 2, WET: 3, DRY: 4 })
    expect(summaryFa).toContain('1')
    expect(summaryFa).toContain('4')
  })

  test('emptyScores starts all dimensions at zero', () => {
    expect(emptyScores()).toEqual({ HOT: 0, COLD: 0, WET: 0, DRY: 0 })
  })
})

describe('case + payment policies', () => {
  test('assertCaseImageUsable: ownership, type, quality', () => {
    const own = (o: Partial<Parameters<typeof assertCaseImageUsable>[0]> = {}) => ({ ownerId: 'u1', type: 'TONGUE', status: 'VALIDATED', ...o }) as Parameters<typeof assertCaseImageUsable>[0]
    expect(() => assertCaseImageUsable(null, 'u1')).toThrow(BusinessRuleError)
    expect(() => assertCaseImageUsable(own({ ownerId: 'u2' }), 'u1')).toThrow(BusinessRuleError)
    expect(() => assertCaseImageUsable(own({ type: 'SKIN' }), 'u1')).toThrow(ValidationError)
    expect(() => assertCaseImageUsable(own({ status: 'REJECTED' }), 'u1')).toThrow(ValidationError)
    expect(() => assertCaseImageUsable(own(), 'u1')).not.toThrow()
  })

  test('assertQuestionnaireCompleted blocks case creation', () => {
    expect(() => assertQuestionnaireCompleted(false)).toThrow(ValidationError)
    expect(() => assertQuestionnaireCompleted(true)).not.toThrow()
  })

  test('assertOrderPayable + assertNoActivePayment', () => {
    expect(() => assertOrderPayable('PAID')).toThrow(BusinessRuleError)
    expect(() => assertOrderPayable('SHIPPED')).toThrow(BusinessRuleError)
    expect(() => assertOrderPayable('PENDING_CONFIRMATION')).not.toThrow()
    expect(() => assertNoActivePayment(true)).toThrow(BusinessRuleError)
    expect(() => assertNoActivePayment(false)).not.toThrow()
  })
})
