// ── PHASE 17 · Reliability Engineering — UNIT tests ───────────────────────
// Covers the pure/infrastructure layer of every implemented pattern:
//   • infra-failure taxonomy (db/storage → 503 SERVICE_UNAVAILABLE + dep)
//   • chaos core (arm/clear, refusal outside test env, fault probes)
//   • cache graceful degradation (failing store never breaks `cached()`)
//   • idempotency key derivation (canonical JSON stability)
//   • durable job queue: write-through rows, per-job TIMEOUT, retry→DLQ,
//     DB-outage fallback to memory, stale-claim crash RECOVERY, replay
//   • withTransaction atomicity (partial-failure rollback)
// End-to-end failure scenarios (FS-1..FS-11) live in
// tests/integration/reliability.test.ts against the live server.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { db } from '@/lib/db'
import { toAppError, ServiceUnavailableError } from '@/server/core/errors'
import { chaosEnabled, faultActive, activateFault, deactivateFault, clearFaults, FAULT_DB_DOWN, FAULT_STORAGE_DOWN } from '@/server/infrastructure/faults'
import { setCacheStore, resetCacheStore, cached } from '@/server/infrastructure/cache'
import { canonicalJson, deriveKey, isIdempotencyProtected, purgeIdempotencyRecords } from '@/server/infrastructure/idempotency'
import { enqueue, registerJob, deadLetters, queueStats, __internals, runJobRecovery, refreshMirrorFromDb, setJobTimeoutFor, setDeadLetterHook } from '@/server/infrastructure/jobs'
import { withTransaction } from '@/server/infrastructure/uow'

// ═══════════════ Infra-failure taxonomy (ED-188) ═══════════════════════════

describe('SERVICE_UNAVAILABLE taxonomy', () => {
  test('Prisma P1001 (db unreachable) → 503 + dependency db', () => {
    const e = Object.assign(new Error('P1001: cant reach database'), { code: 'P1001' })
    const err = toAppError(e)
    expect(err.code).toBe('SERVICE_UNAVAILABLE')
    expect(err.httpStatus).toBe(503)
    expect((err.details as { dependency: string }).dependency).toBe('db')
    expect((err.details as { retryAfterSec: number }).retryAfterSec).toBe(5)
  })

  test('Prisma P2024 (operation timeout) → 503 db', () => {
    const e = Object.assign(new Error('P2024: timed out'), { code: 'P2024' })
    expect(toAppError(e).httpStatus).toBe(503)
  })

  test('raw SQLITE_CANTOPEN message → 503 db', () => {
    const err = toAppError(new Error('SQLite error: unable to open database file (SQLITE_CANTOPEN)'))
    expect(err.code).toBe('SERVICE_UNAVAILABLE')
  })

  test('fs EIO (storage) → 503 + dependency storage', () => {
    const e = Object.assign(new Error('EIO: i/o error'), { code: 'EIO' })
    const err = toAppError(e)
    expect(err.httpStatus).toBe(503)
    expect((err.details as { dependency: string }).dependency).toBe('storage')
  })

  test('fs ENOSPC (disk full) → 503 storage', () => {
    const e = Object.assign(new Error('ENOSPC: no space left'), { code: 'ENOSPC' })
    expect(toAppError(e).code).toBe('SERVICE_UNAVAILABLE')
  })

  test('ordinary bugs still map to INTERNAL 500 (not masked as outages)', () => {
    expect(toAppError(new Error('TypeError: x is not a function')).code).toBe('INTERNAL')
    expect(toAppError(new Error('SQLITE syntax near FROM')).code).toBe('INTERNAL') // query bug ≠ outage
  })

  test('ServiceUnavailableError default Persian messages per dependency', () => {
    expect(new ServiceUnavailableError('db').message).toContain('پایگاه داده')
    expect(new ServiceUnavailableError('storage').message).toContain('ذخیره‌سازی')
  })
})

// ═══════════════ Chaos core (ED-187) ═══════════════════════════════════════

describe('fault injection core', () => {
  afterEach(async () => { await clearFaults() })

  test('armed inside a test runner', () => {
    expect(chaosEnabled()).toBe(true)
  })

  test('activate/deactivate toggles faultActive', async () => {
    expect(faultActive(FAULT_DB_DOWN)).toBe(false)
    await activateFault(FAULT_DB_DOWN)
    expect(faultActive(FAULT_DB_DOWN)).toBe(true)
    await deactivateFault(FAULT_DB_DOWN)
    expect(faultActive(FAULT_DB_DOWN)).toBe(false)
  })

  test('db:down actually breaks db ops with a Prisma-shaped P1001', async () => {
    await activateFault(FAULT_DB_DOWN)
    let thrown: unknown
    try { await db.user.count() } catch (e) { thrown = e }
    expect((thrown as { code?: string })?.code).toBe('P1001')
    expect(toAppError(thrown).httpStatus).toBe(503)
    await deactivateFault(FAULT_DB_DOWN)
    expect(await db.user.count()).toBeGreaterThan(0) // restored
  })

  test('invalid fault name → 400, never arms', async () => {
    let code = ''
    try { await activateFault('nuclear:meltdown') } catch (e) { code = (e as { code?: string })?.code ?? '' }
    expect(code).toBe('VALIDATION')
  })

  test('REFUSES to arm when chaos mode is off (production guard, REL1)', async () => {
    const saved = { BUN_TEST: process.env.BUN_TEST, NODE_ENV: process.env.NODE_ENV, BH_CHAOS: process.env.BH_CHAOS }
    const set = (k: string, v: string | undefined) => { (process.env as Record<string, string | undefined>)[k] = v }
    set('BUN_TEST', undefined)
    set('NODE_ENV', 'production')
    set('BH_CHAOS', undefined)
    try {
      let code = ''
      try { await activateFault(FAULT_STORAGE_DOWN) } catch (e) { code = (e as { code?: string })?.code ?? '' }
      expect(code).toBe('FORBIDDEN')
      expect(faultActive(FAULT_STORAGE_DOWN)).toBe(false)
    } finally {
      set('BUN_TEST', saved.BUN_TEST)
      set('NODE_ENV', saved.NODE_ENV)
      set('BH_CHAOS', saved.BH_CHAOS)
    }
  })
})

// ═══════════════ Cache graceful degradation (ED-189) ═══════════════════════

describe('cache layer failure → degrade to loader', () => {
  afterEach(() => resetCacheStore())

  test('a failing store (Redis-down shape) never breaks reads', async () => {
    const boom = async () => { throw new Error('EIO: cache down') }
    setCacheStore({ get: boom, set: boom, del: boom, clearPrefix: boom })
    const value = await cached('unit:cache-down:key', 60_000, async () => ({ v: 42 }))
    expect(value).toEqual({ v: 42 }) // loader served — request survived
  })

  test('swappable store is honored when healthy', async () => {
    let reads = 0
    const backing = new Map<string, unknown>()
    setCacheStore({
      get: async (k: string) => { reads++; return backing.get(k) },
      set: async (k: string, v: unknown) => { backing.set(k, v) },
      del: async (k: string) => { backing.delete(k) },
      clearPrefix: async () => 0,
    })
    await cached('unit:cache-ok:key', 60_000, async () => 'fresh')
    const second = await cached('unit:cache-ok:key', 60_000, async () => 'loader-again')
    expect(second).toBe('fresh') // served from swapped store
    expect(reads).toBe(2)
  })
})

// ═══════════════ Idempotency key derivation (ED-191) ═══════════════════════

describe('idempotency derivation', () => {
  test('canonicalJson is key-order independent at every depth', () => {
    expect(canonicalJson({ a: 1, b: { y: 2, x: [3, { z: 1, w: 2 }] } }))
      .toBe(canonicalJson({ b: { x: [3, { w: 2, z: 1 }], y: 2 }, a: 1 }))
  })

  test('same logical body → same key; different body → different key', () => {
    const k1 = deriveKey('u1', 'POST /x', canonicalJson({ orderId: 'a', note: 'سلام' }))
    const k2 = deriveKey('u1', 'POST /x', canonicalJson({ note: 'سلام', orderId: 'a' }))
    const k3 = deriveKey('u1', 'POST /x', canonicalJson({ orderId: 'b', note: 'سلام' }))
    expect(k1).toBe(k2)
    expect(k1).not.toBe(k3)
    expect(k1).toHaveLength(48)
  })

  test('protection registry covers the money/mutation routes', () => {
    expect(isIdempotencyProtected('POST', '/api/v1/orders')).toBe(true)
    expect(isIdempotencyProtected('POST', '/api/v1/payments')).toBe(true)
    expect(isIdempotencyProtected('POST', '/api/v1/cases')).toBe(true)
    expect(isIdempotencyProtected('GET', '/api/v1/orders')).toBe(false)
    expect(isIdempotencyProtected('POST', '/api/v1/cart')).toBe(false)
  })

  test('expired records are purged (TTL contract)', async () => {
    const route = 'unit-test://expired'
    await db.idempotencyRecord.create({ data: { key: 'k-exp', route, userId: 'u-unit', status: 'DONE', expiresAt: new Date(Date.now() - 1000) } })
    await db.idempotencyRecord.create({ data: { key: 'k-live', route, userId: 'u-unit', status: 'DONE', expiresAt: new Date(Date.now() + 3600_000) } })
    const purged = await purgeIdempotencyRecords()
    expect(purged).toBeGreaterThanOrEqual(1)
    expect(await db.idempotencyRecord.count({ where: { route } })).toBe(1) // only live survives
    await db.idempotencyRecord.deleteMany({ where: { route } })
  })
})

// ═══════════════ Durable job queue (ED-190) ════════════════════════════════

describe('durable job queue', () => {
  beforeEach(async () => { await __internals.reset() })

  test('enqueue persists a PENDING DurableJob row (write-through)', async () => {
    registerJob('bh.d.persist', async () => { /* ok */ })
    enqueue('bh.d.persist', { n: 1 })
    await __internals.drain()
    const row = await db.durableJob.findFirst({ where: { type: 'bh.d.persist' } })
    expect(row).not.toBeNull()
    expect(row!.status).toBe('DONE')
    expect(row!.ownerPid).toBe(process.pid)
  })

  test('per-job TIMEOUT: a hung handler fails, retries, then dead-letters', async () => {
    setJobTimeoutFor('bh.d.hang', 30) // clamped to the 100ms floor by design
    let attempts = 0
    registerJob('bh.d.hang', async () => { attempts++; await new Promise((r) => setTimeout(r, 250)) })
    enqueue('bh.d.hang', {}, { maxAttempts: 2, backoffMs: 10 })
    await __internals.drain() // attempt 1 → timeout → requeue
    expect(attempts).toBe(1)
    expect(queueStats().pending).toBe(1)
    await new Promise((r) => setTimeout(r, 40))
    await __internals.drain() // attempt 2 → timeout → DEAD
    expect(attempts).toBe(2)
    const dead = deadLetters().find((j) => j.type === 'bh.d.hang')
    expect(dead).toBeDefined()
    const row = await db.durableJob.findFirst({ where: { type: 'bh.d.hang' } })
    expect(row!.status).toBe('DEAD')
    expect(row!.lastError).toContain('timed out after 100ms') // 30 clamped to floor
  })

  test('DB outage → queue DEGRADES to memory and the job still runs', async () => {
    await activateFault(FAULT_DB_DOWN)
    const ran: string[] = []
    registerJob('bh.d.degraded', async () => { ran.push('done') })
    const id = enqueue('bh.d.degraded', {}) // db create throws → memory fallback
    await __internals.drain()
    expect(ran).toEqual(['done']) // the queue survived the outage
    await deactivateFault(FAULT_DB_DOWN)
    // db back: the degraded job was never persisted (by design — best-effort)
    expect(await db.durableJob.findFirst({ where: { id } })).toBeNull()
  })

  test('stale RUNNING claim → recovered to PENDING → executed (crash recovery)', async () => {
    registerJob('bh.d.recover', async () => { /* ok */ })
    const id = `job_stale_${Date.now().toString(36)}`
    await db.durableJob.create({
      data: {
        id, type: 'bh.d.recover', payload: '{}', status: 'RUNNING',
        attempts: 1, maxAttempts: 3, backoffMs: 10,
        claimedAt: new Date(Date.now() - 10 * 60_000), ownerPid: 12345, // a "dead" worker
      },
    })
    const res = await runJobRecovery()
    expect(res.requeued).toBeGreaterThanOrEqual(1)
    const afterRecover = await db.durableJob.findUnique({ where: { id } })
    expect(afterRecover!.status).toBe('PENDING')
    expect(afterRecover!.ownerPid).toBeNull() // handed off — any worker may claim
    await __internals.drain() // claim via the unowned path
    const done = await db.durableJob.findUnique({ where: { id } })
    expect(done!.status).toBe('DONE')
  })

  test('dead-letter hook receives the job (DLQ side effects fire)', async () => {
    const seen: string[] = []
    setDeadLetterHook(async (job) => { seen.push(`${job.type}:${job.attempts}`) })
    registerJob('bh.d.hooked', async () => { throw new Error('boom') })
    enqueue('bh.d.hooked', {}, { maxAttempts: 1, backoffMs: 10 })
    await __internals.drain()
    expect(seen).toEqual(['bh.d.hooked:1'])
    setDeadLetterHook(async () => { /* restore no-op */ })
  })

  test('mirror refresh rebuilds stats from DB truth', async () => {
    await db.durableJob.create({ data: { id: `job_m1_${Date.now().toString(36)}`, type: 'bh.d.mirror', payload: '{}', status: 'DEAD', attempts: 2, maxAttempts: 2, lastError: 'x' } })
    await refreshMirrorFromDb()
    expect(queueStats().dead).toBeGreaterThanOrEqual(1)
    expect(deadLetters().some((j) => j.type === 'bh.d.mirror')).toBe(true)
    await db.durableJob.deleteMany({ where: { type: 'bh.d.mirror' } })
    await refreshMirrorFromDb()
  })
})

// ═══════════════ Partial failure: transaction atomicity ════════════════════

describe('withTransaction atomicity (partial-failure rollback)', () => {
  test('a failure mid-transaction rolls back EVERY write', async () => {
    const route = 'unit-test://tx-rollback'
    const before = await db.idempotencyRecord.count({ where: { route } })
    let thrown: unknown
    try {
      await withTransaction(async (tx) => {
        await tx.idempotencyRecord.create({ data: { key: 'k1', route, userId: 'u-unit', status: 'RUNNING', expiresAt: new Date(Date.now() + 3600_000) } })
        await tx.idempotencyRecord.create({ data: { key: 'k2', route, userId: 'u-unit', status: 'RUNNING', expiresAt: new Date(Date.now() + 3600_000) } })
        throw new Error('mid-transaction failure')
      })
    } catch (e) { thrown = e }
    expect((thrown as Error).message).toBe('mid-transaction failure')
    const after = await db.idempotencyRecord.count({ where: { route } })
    expect(after).toBe(before) // nothing leaked — checkout-style atomicity holds
    await db.idempotencyRecord.deleteMany({ where: { route } })
  })
})
