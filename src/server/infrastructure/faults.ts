// ── BabaHakim Backend · Fault Injection / Chaos Core (PHASE 17, ED-187) ────
// Deterministic failure-scenario engine for the reliability test suite.
// Named faults simulate INFRASTRUCTURE failures at internal seams so the
// eleven commanded failure scenarios can be tested end-to-end against the
// real running server (Database Down, Redis/Cache Down, Worker Down,
// Storage Failure, …) without deleting files or killing processes.
//
//   db:down        every DB operation throws a Prisma-shaped P1001 error
//                  (injected through the lib/db.ts globalThis seam — the
//                  lib module stays free of @/server imports, ED-137b)
//   storage:down   every storage-driver op throws an EIO-coded error
//   worker:down    the job worker loop stops (self-heals via ensureWorker)
//   cache:down     the cache layer throws (degrade-to-loader must hold)
//
// Double guard (audit REL1) — production can NEVER inject:
//   1. chaosEnabled() must be true: a test runner (BUN_TEST / NODE_ENV=test)
//      OR an explicit BH_CHAOS=1 opt-in (dev/drill only).
//   2. The /admin/chaos API additionally requires ADMIN auth + CSRF + audit.
import { AppError, ForbiddenError } from '@/server/core/errors'
import { childLogger } from '@/server/core/logger'

const log = childLogger({ svc: 'chaos' })

export const FAULT_DB_DOWN = 'db:down'
export const FAULT_STORAGE_DOWN = 'storage:down'
export const FAULT_WORKER_DOWN = 'worker:down'
export const FAULT_CACHE_DOWN = 'cache:down'
export const FAULT_NAMES = [FAULT_DB_DOWN, FAULT_STORAGE_DOWN, FAULT_WORKER_DOWN, FAULT_CACHE_DOWN] as const

/** Arm-conditions for fault injection (checked per call, never cached). */
export function chaosEnabled(): boolean {
  return (
    process.env.BH_CHAOS === '1' ||
    process.env.NODE_ENV === 'test' ||
    process.env.BUN_TEST === '1'
  )
}

const g = globalThis as unknown as { __bhChaosFaults?: Set<string> }
const active = g.__bhChaosFaults ?? new Set<string>()
g.__bhChaosFaults = active

// PHASE 17: faults are TIME-BOXED — every activation schedules its own
// deactivation (default 30s). A drill can never be forgotten armed, and the
// reliability tests can ride the auto-expiry instead of needing an
// authenticated deactivate call DURING a db outage (auth needs the db).
const DEFAULT_TTL_MS = 30_000
const timers = new Map<string, ReturnType<typeof setTimeout>>()

/** Safe probe — always returns false when chaos cannot be armed. */
export function faultActive(name: string): boolean {
  if (!chaosEnabled()) return false
  return active.has(name)
}

export function activeFaults(): string[] {
  if (!chaosEnabled()) return []
  return [...active]
}

function assertValid(name: string): void {
  if (!(FAULT_NAMES as readonly string[]).includes(name)) {
    throw new AppError('VALIDATION' as never, `fault نامعتبر است: ${name}`, 400, { allowed: FAULT_NAMES })
  }
}

/**
 * Arm a fault. Refuses to run outside test/chaos mode — a hard error, not a
 * silent no-op (a drill that silently does nothing is worse than no drill).
 * The fault self-clears after ttlMs (time-boxed blast radius).
 */
export async function activateFault(name: string, ttlMs = DEFAULT_TTL_MS): Promise<void> {
  assertValid(name)
  if (!chaosEnabled()) {
    throw new ForbiddenError('تزریق خطا فقط در محیط تست/دریل فعال است')
  }
  active.add(name)
  // (re)schedule the self-clear
  const prev = timers.get(name)
  if (prev) clearTimeout(prev)
  const t = setTimeout(() => { void deactivateFault(name) }, Math.max(500, ttlMs))
  ;(t as unknown as { unref?: () => void }).unref?.()
  timers.set(name, t)
  // side effects per fault (lazy imports keep this module light):
  if (name === FAULT_DB_DOWN) {
    const { setDbFaultHook } = await import('@/lib/db')
    setDbFaultHook(() => {
      // double-check INSIDE the hook: an expired/never-armed fault must
      // never break a real query (defense in depth against stale hooks)
      if (!faultActive(FAULT_DB_DOWN)) return
      // Prisma-shaped initialization failure — exactly what a dead database
      // looks like to Prisma (P1001: can't reach database server)
      const err = new Error('P1001: injected db fault (chaos) — database unreachable') as Error & { code?: string }
      err.code = 'P1001'
      throw err
    })
  }
  if (name === FAULT_WORKER_DOWN) {
    const jobs = await import('@/server/infrastructure/jobs')
    jobs.__internals.stopWorker()
  }
  if (name === FAULT_CACHE_DOWN) {
    // swap in a store that fails like a dead Redis (EIO on every op)
    const { setCacheStore } = await import('@/server/infrastructure/cache')
    setCacheStore({
      get: async () => { throw new Error('EIO: cache layer down (chaos)') },
      set: async () => { throw new Error('EIO: cache layer down (chaos)') },
      del: async () => { throw new Error('EIO: cache layer down (chaos)') },
      clearPrefix: async () => { throw new Error('EIO: cache layer down (chaos)') },
    })
  }
  log.warn('CHAOS fault ARMED', { fault: name })
}

export async function deactivateFault(name: string): Promise<void> {
  assertValid(name)
  const was = active.delete(name)
  const t = timers.get(name)
  if (t) { clearTimeout(t); timers.delete(name) }
  if (name === FAULT_DB_DOWN) {
    const { setDbFaultHook } = await import('@/lib/db')
    setDbFaultHook(null)
  }
  if (name === FAULT_WORKER_DOWN) {
    // revive the worker loop immediately on deactivate (self-heal path is
    // the recurring schedulers calling ensureWorker, this is the fast path)
    const jobs = await import('@/server/infrastructure/jobs')
    jobs.ensureWorker()
  }
  if (name === FAULT_CACHE_DOWN) {
    const { resetCacheStore } = await import('@/server/infrastructure/cache')
    resetCacheStore()
  }
  if (was) log.warn('CHAOS fault CLEARED', { fault: name })
}

export async function clearFaults(): Promise<void> {
  for (const name of [...active]) await deactivateFault(name)
}
