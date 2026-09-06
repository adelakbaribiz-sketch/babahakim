// ── BabaHakim Backend · Background Jobs (PHASE 08 ED-102 → PHASE 17 ED-190) ─
// DURABLE job queue: every enqueue is a DurableJob row, so a process crash
// can no longer lose pending work (AI analyses, notifications, exports).
//   PENDING → RUNNING (atomic claim) → DONE | back-to-PENDING (retry+backoff) | DEAD (DLQ)
//
// Reliability contracts (PHASE 17):
//   • per-job TIMEOUT (Promise.race, per-type overrides) — a hung handler
//     can no longer occupy a claim forever
//   • crash RECOVERY: stale RUNNING claims (>5min) requeue on boot and every
//     5 minutes (runJobRecovery) — the "Recovery" pattern of the phase command
//   • DLQ is durable: DEAD rows survive restarts; admins list/replay via
//     /api/v1/admin/jobs (replay resets to PENDING)
//   • claim ownership (ownerPid): a worker only claims unowned jobs or its
//     own — the dev server and the test runner never steal each other's rows;
//     orphaned owners are nulled by recovery (handoff)
//   • graceful degradation: if the DB write fails (outage), the job falls
//     back to the in-memory queue and still runs — the queue degrades, it
//     does not die
//   • worker tick is error-isolated (one bad tick can never kill the loop)
//
// Backward-compatible public API (v1 contract, 441 tests depend on it):
//   registerJob / enqueue / scheduleRecurring / deadLetters / queueStats /
//   queueHealth / setDeadLetterHook / __internals.{drain,reset}
import { db } from '@/lib/db'
import { childLogger } from '@/server/core/logger'
import { inc, observe, gauge, METRIC_NAMES } from '@/server/core/metrics'
import { currentTrace, enterTrace, enterJobTrace, type TraceContext } from '@/server/core/trace'

const log = childLogger({ svc: 'job-queue' })

export interface Job<P = unknown> {
  id: string
  type: string
  payload: P
  attempts: number
  maxAttempts: number
  nextRunAt: number
  backoffMs: number
  createdAt: number
  /** PHASE 15 (ED-169): trace continuation — corrId/traceId captured at
   *  enqueue time so the job's logs/metrics carry the originating action. */
  meta?: { corrId: string; traceId: string }
}

export type JobHandler = (payload: any, job: Job) => Promise<void>
export type DeadLetterHook = (job: Job, error: unknown) => Promise<void> | void

const WORKER_INTERVAL = 1000
const CLAIM_BATCH = 10
const STALE_RUNNING_MS = 5 * 60_000 // claim older than this = crashed worker
const ORPHAN_PENDING_MS = 2 * 60_000 // unclaimed-by-owner for this = orphaned

// PHASE 17: per-job timeout — a job handler that hangs (network black hole,
// infinite loop) must not hold a claim forever. Race-based, per-type overrides.
const DEFAULT_JOB_TIMEOUT = 120_000
const JOB_TIMEOUTS: Record<string, number> = {
  'media-process': 300_000,
  'report-export': 300_000,
  'ai-evaluation': 300_000,
  'ai-analysis': 120_000,
  'ai-monitor': 120_000,
}
function jobTimeoutFor(type: string): number {
  return JOB_TIMEOUTS[type] ?? DEFAULT_JOB_TIMEOUT
}

/** Override a job type's timeout (ops knob + test hook, PHASE 17). */
export function setJobTimeoutFor(type: string, ms: number): void {
  JOB_TIMEOUTS[type] = Math.max(100, ms)
}

const g = globalThis as unknown as {
  __bhJobs?: {
    queue: Job[] // in-memory fallback queue (DB outage) + pre-v2 compat
    dead: Job[] // in-memory dead letters
    handlers: Map<string, JobHandler>
    timer?: ReturnType<typeof setInterval>
    lastJobAt?: number
    mirror?: { pending: number; running: number; dead: number }
    deadMirror?: Job[]
    pendingWrites?: Promise<void>[]
  }
}
const state = g.__bhJobs ?? {
  queue: [] as Job[], dead: [] as Job[], handlers: new Map<string, JobHandler>(),
  mirror: { pending: 0, running: 0, dead: 0 }, deadMirror: [] as Job[],
  pendingWrites: [] as Promise<void>[],
}
state.mirror ??= { pending: 0, running: 0, dead: 0 }
state.deadMirror ??= []
state.pendingWrites ??= []
g.__bhJobs = state
const mirror = state.mirror
const deadMirror = state.deadMirror
const pendingWrites = state.pendingWrites

let jobSeq = 0

function isTestContext(): boolean {
  return process.env.BUN_TEST === '1' || process.env.NODE_ENV === 'test' || process.env.BH_CHAOS === '1'
}

export function registerJob(type: string, handler: (payload: any, job: Job) => Promise<void>): void {
  state.handlers.set(type, handler)
}

export function enqueue<P>(type: string, payload: P, opts: { delayMs?: number; maxAttempts?: number; backoffMs?: number } = {}): string {
  const id = `job_${Date.now().toString(36)}_${++jobSeq}`
  const meta = (() => {
    const trace = currentTrace()
    return trace ? { corrId: trace.corrId, traceId: trace.traceId } : undefined
  })()
  // write-through durability (async, but drain() awaits pendingWrites first
  // so the v1 test contract "enqueue → drain" stays deterministic)
  const write = (async () => {
    try {
      await db.durableJob.create({
        data: {
          id, type,
          payload: JSON.stringify(payload ?? null),
          status: 'PENDING',
          attempts: 0,
          maxAttempts: opts.maxAttempts ?? 3,
          backoffMs: opts.backoffMs ?? 2000,
          nextRunAt: new Date(Date.now() + (opts.delayMs ?? 0)),
          corrId: meta?.corrId ?? null,
          traceId: meta?.traceId ?? null,
          ownerPid: process.pid,
        },
      })
      mirror.pending += 1
    } catch (e) {
      // GRACEFUL DEGRADATION: DB unavailable → run in-memory instead.
      // The queue keeps working during an outage (best-effort durability).
      state.queue.push({
        id, type, payload,
        attempts: 0, maxAttempts: opts.maxAttempts ?? 3,
        nextRunAt: Date.now() + (opts.delayMs ?? 0),
        backoffMs: opts.backoffMs ?? 2000, createdAt: Date.now(),
        ...(meta ? { meta } : {}),
      } as Job)
      log.error('queue DEGRADED — job kept in memory (db unavailable)', { type, id, error: e instanceof Error ? e.message : String(e) })
    }
  })()
  pendingWrites.push(write)
  // self-cleaning — the array only holds IN-FLIGHT writes (bounded, no leak)
  void write.finally(() => {
    const i = pendingWrites.indexOf(write)
    if (i >= 0) pendingWrites.splice(i, 1)
  })
  inc(METRIC_NAMES.queueJobs, { type, status: 'enqueued' })
  log.debug('job enqueued', { type, id, delayMs: opts.delayMs ?? 0 })
  ensureWorker()
  return id
}

/** Recurring internal job (e.g. follow-up bucket scan every 5 minutes). */
export function scheduleRecurring(type: string, intervalMs: number, payload: unknown = {}): void {
  if (state.handlers.has(`recurring:${type}`)) return
  const tick = () => {
    if (state.handlers.has(type)) enqueue(type, payload).toString()
  }
  registerJob(`recurring:${type}`, async () => { /* marker only */ })
  const timer = setInterval(tick, intervalMs)
  ;(timer as unknown as { unref?: () => void }).unref?.()
  tick()
}

export function deadLetters(): Job[] { return [...state.dead, ...deadMirror] }

export function queueStats() {
  return {
    pending: state.queue.length + mirror.pending,
    dead: state.dead.length + mirror.dead,
    types: [...state.handlers.keys()],
  }
}

/** PHASE 15: queue gauges + worker liveness for health/readiness (ED-175). */
export function queueHealth() {
  gauge('queue_depth', undefined, state.queue.length + mirror.pending)
  gauge('queue_dead', undefined, state.dead.length + mirror.dead)
  return {
    pending: state.queue.length + mirror.pending,
    dead: state.dead.length + mirror.dead,
    handlerCount: state.handlers.size,
    workerAlive: state.timer !== undefined,
    lastJobAt: state.lastJobAt ?? null,
  }
}

let deadHook: DeadLetterHook | null = null
export function setDeadLetterHook(hook: DeadLetterHook): void { deadHook = hook }

// ── worker loop ────────────────────────────────────────────────────────────

async function fireDeadHook(job: Job, error: unknown): Promise<void> {
  try { await deadHook?.(job, error) } catch { /* hook failures must not loop */ }
}

/** Memory-queue job execution (v1 path — now the DB-outage fallback). */
async function runMemoryJob(job: Job): Promise<void> {
  const handler = state.handlers.get(job.type)
  if (!handler) {
    log.warn('job has no handler — dropped to dead-letter', { type: job.type, id: job.id })
    state.dead.push(job)
    return
  }
  job.attempts += 1
  const started = Date.now()
  state.lastJobAt = Date.now()
  await runWithTrace(job, async () => {
    try {
      await withTimeout(handler(job.payload, job), jobTimeoutFor(job.type), job)
      inc(METRIC_NAMES.queueJobs, { type: job.type, status: 'done' })
      observe(METRIC_NAMES.queueLatency, { type: job.type }, Date.now() - started)
      log.debug('job done', { type: job.type, id: job.id, ms: Date.now() - started, attempt: job.attempts })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      inc(METRIC_NAMES.queueJobs, { type: job.type, status: 'failed' })
      observe(METRIC_NAMES.queueLatency, { type: job.type }, Date.now() - started)
      log.warn('job failed', { type: job.type, id: job.id, attempt: job.attempts, error: message })
      if (job.attempts >= job.maxAttempts) {
        state.dead.push(job)
        inc(METRIC_NAMES.queueJobs, { type: job.type, status: 'dead' })
        log.error('job dead-lettered', { type: job.type, id: job.id, attempts: job.attempts })
        await fireDeadHook(job, e)
      } else {
        job.nextRunAt = Date.now() + job.backoffMs * job.attempts // linear backoff
        state.queue.push(job)
      }
    }
  })
}

async function runWithTrace(job: Job, fn: () => Promise<void>): Promise<void> {
  const jobTrace: TraceContext = job.meta
    ? enterJobTrace(job.meta, job)
    : {
        reqId: job.id, corrId: `corr_job_${job.id}`,
        traceId: job.id.replace(/[^0-9a-f]/g, '').padEnd(32, '0').slice(0, 32),
        spanId: job.id.slice(-16).replace(/[^0-9a-f]/g, '0').padEnd(16, '0'),
        route: `job:${job.type}`,
      }
  await enterTrace(jobTrace, fn)
}

async function withTimeout(p: Promise<void>, ms: number, job: { type: string; id: string }): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`job timed out after ${ms}ms`)), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

type JobRow = { id: string; type: string; payload: string; status: string; attempts: number; maxAttempts: number; backoffMs: number; nextRunAt: Date; claimedAt: Date | null; lastError: string | null; corrId: string | null; traceId: string | null }

function rowToJob(row: JobRow): Job {
  let payload: unknown
  try { payload = JSON.parse(row.payload) } catch { payload = null }
  return {
    id: row.id, type: row.type, payload,
    attempts: row.attempts, maxAttempts: row.maxAttempts,
    nextRunAt: row.nextRunAt.getTime(), backoffMs: row.backoffMs,
    createdAt: row.nextRunAt.getTime(),
    ...(row.corrId && row.traceId ? { meta: { corrId: row.corrId, traceId: row.traceId } } : {}),
  }
}

/** Claim ONE due job atomically (status flip PENDING→RUNNING). Returns null
 *  when nothing is claimable (unowned or owned-by-me only, ED-190). */
async function claimNextDue(): Promise<JobRow | null> {
  const now = new Date()
  const due = await db.durableJob.findMany({
    where: { status: 'PENDING', nextRunAt: { lte: now }, OR: [{ ownerPid: null }, { ownerPid: process.pid }] },
    orderBy: { nextRunAt: 'asc' }, take: 1,
  })
  const candidate = due[0]
  if (!candidate) return null
  const claimed = await db.durableJob.updateMany({
    where: { id: candidate.id, status: 'PENDING', nextRunAt: { lte: now } },
    data: { status: 'RUNNING', claimedAt: new Date(), attempts: { increment: 1 }, ownerPid: process.pid },
  })
  if (claimed.count !== 1) return null // raced with another worker — skip
  mirror.pending = Math.max(0, mirror.pending - 1)
  mirror.running += 1
  const row = await db.durableJob.findUnique({ where: { id: candidate.id } })
  return row ? (row as unknown as JobRow) : null
}

/** Execute a claimed DB job to completion (DONE / retry / DEAD). */
async function runDbJob(row: JobRow): Promise<void> {
  const job = rowToJob(row)
  const handler = state.handlers.get(job.type)
  if (!handler) {
    log.warn('job has no handler — dead-lettered', { type: job.type, id: job.id })
    await db.durableJob.update({ where: { id: job.id }, data: { status: 'DEAD', lastError: 'no handler registered', finishedAt: new Date() } }).catch(() => { /* best-effort */ })
    mirror.running = Math.max(0, mirror.running - 1)
    mirror.dead += 1
    deadMirror.unshift(job)
    trimDeadMirror()
    inc(METRIC_NAMES.queueJobs, { type: job.type, status: 'dead' })
    await fireDeadHook(job, new Error('no handler registered'))
    return
  }
  const started = Date.now()
  state.lastJobAt = Date.now()
  await runWithTrace(job, async () => {
    try {
      await withTimeout(handler(job.payload, job), jobTimeoutFor(job.type), job)
      await db.durableJob.update({ where: { id: job.id }, data: { status: 'DONE', finishedAt: new Date(), lastError: null } })
      mirror.running = Math.max(0, mirror.running - 1)
      inc(METRIC_NAMES.queueJobs, { type: job.type, status: 'done' })
      observe(METRIC_NAMES.queueLatency, { type: job.type }, Date.now() - started)
      log.debug('job done', { type: job.type, id: job.id, ms: Date.now() - started, attempt: job.attempts })
    } catch (e) {
      const message = (e instanceof Error ? e.message : String(e)).slice(0, 500)
      inc(METRIC_NAMES.queueJobs, { type: job.type, status: 'failed' })
      observe(METRIC_NAMES.queueLatency, { type: job.type }, Date.now() - started)
      log.warn('job failed', { type: job.type, id: job.id, attempt: job.attempts, error: message })
      mirror.running = Math.max(0, mirror.running - 1)
      if (job.attempts >= job.maxAttempts) {
        await db.durableJob.update({ where: { id: job.id }, data: { status: 'DEAD', lastError: message, finishedAt: new Date() } }).catch(() => { /* best-effort */ })
        mirror.dead += 1
        deadMirror.unshift(job)
        trimDeadMirror()
        inc(METRIC_NAMES.queueJobs, { type: job.type, status: 'dead' })
        log.error('job dead-lettered', { type: job.type, id: job.id, attempts: job.attempts })
        await fireDeadHook(job, e)
      } else {
        const nextRunAt = new Date(Date.now() + job.backoffMs * job.attempts) // linear backoff
        await db.durableJob.update({ where: { id: job.id }, data: { status: 'PENDING', claimedAt: null, ownerPid: process.pid, nextRunAt, lastError: message } }).catch(() => { /* best-effort */ })
        mirror.pending += 1
      }
    }
  })
}

function trimDeadMirror(): void {
  if (deadMirror.length > 100) deadMirror.length = 100
}

// test hooks
export const __internals = {
  drain: async () => {
    // v1 contract: process every currently-due job (memory + durable).
    // pendingWrites are awaited FIRST so enqueue→drain stays deterministic.
    await Promise.all(pendingWrites.splice(0).map((p) => p.catch(() => {})))
    for (let i = 0; i < state.queue.length; i++) {
      const job = state.queue[i]
      if (job.nextRunAt <= Date.now()) {
        state.queue.splice(i--, 1)
        await runMemoryJob(job)
      }
    }
    // durable claims are skipped when the DB itself is unavailable (the
    // degraded-queue contract: memory jobs still drain during an outage)
    try {
      let guard = 0
      while (guard++ < 500) {
        const row = await claimNextDue()
        if (!row) break
        await runDbJob(row)
      }
    } catch (e) {
      log.warn('drain: durable claims skipped (db unavailable)', { error: e instanceof Error ? e.message : String(e) })
    }
  },
  reset: async () => {
    // test-only: wipe in-memory state + durable rows (guarded — never runs
    // in a production process; REL5 audit checks the guard exists).
    // Returns the purge promise so tests that immediately create rows can
    // await determinism; fire-and-forget callers keep v1 sync semantics.
    if (!isTestContext()) {
      log.warn('jobs reset called outside test context — ignored')
      return
    }
    state.queue.length = 0
    state.dead.length = 0
    deadMirror.length = 0
    mirror.pending = 0
    mirror.running = 0
    mirror.dead = 0
    pendingWrites.length = 0
    await db.durableJob.deleteMany({}).catch(() => { /* best-effort */ })
  },
  stopWorker: () => {
    // PHASE 17 (worker:down drill): halt the loop. Self-heal paths: the next
    // enqueue (recurring schedulers fire ≤30s) or deactivateFault → ensureWorker.
    if (state.timer) {
      clearInterval(state.timer)
      state.timer = undefined
    }
  },
}

// ── PHASE 17: crash recovery + retention ───────────────────────────────────

/** Requeue jobs orphaned by a crashed worker. Boot + every 5 minutes. */
export async function runJobRecovery(): Promise<{ requeued: number; orphaned: number }> {
  const staleCut = new Date(Date.now() - STALE_RUNNING_MS)
  const orphanCut = new Date(Date.now() - ORPHAN_PENDING_MS)
  const r1 = await db.durableJob.updateMany({
    where: { status: 'RUNNING', claimedAt: { lt: staleCut } },
    data: { status: 'PENDING', claimedAt: null, ownerPid: null, lastError: 'recovered: stale claim (worker crash?)' },
  })
  const r2 = await db.durableJob.updateMany({
    where: { status: 'PENDING', updatedAt: { lt: orphanCut }, NOT: [{ ownerPid: process.pid }] },
    data: { ownerPid: null },
  })
  if (r1.count > 0 || r2.count > 0) {
    log.warn('job recovery', { requeued: r1.count, orphaned: r2.count })
  }
  await refreshMirrorFromDb()
  return { requeued: r1.count, orphaned: r2.count }
}

/** Rebuild the liveness mirrors from DB truth (boot + recovery). */
export async function refreshMirrorFromDb(): Promise<void> {
  try {
    const groups = await db.durableJob.groupBy({ by: ['status'], _count: { _all: true } })
    mirror.pending = 0
    mirror.running = 0
    mirror.dead = 0
    for (const grp of groups) {
      const n = grp._count._all
      if (grp.status === 'PENDING') mirror.pending = n
      else if (grp.status === 'RUNNING') mirror.running = n
      else if (grp.status === 'DEAD') mirror.dead = n
    }
    const deads = await db.durableJob.findMany({ where: { status: 'DEAD' }, orderBy: { updatedAt: 'desc' }, take: 100 })
    deadMirror.length = 0
    for (const row of deads) deadMirror.push(rowToJob(row as unknown as JobRow))
  } catch {
    // db unavailable — mirrors stay at their last known values (degraded)
  }
}

/** Hard-purge finished job history (operational data, ED-172). */
export async function purgeJobHistory(): Promise<{ done: number; dead: number }> {
  const doneCut = new Date(Date.now() - 7 * 24 * 3600_000)
  const deadCut = new Date(Date.now() - 30 * 24 * 3600_000)
  const a = await db.durableJob.deleteMany({ where: { status: 'DONE', finishedAt: { lt: doneCut } } })
  const b = await db.durableJob.deleteMany({ where: { status: 'DEAD', updatedAt: { lt: deadCut } } })
  return { done: a.count, dead: b.count }
}

export function ensureWorker(): void {
  if (state.timer) return
  if (process.env.NEXT_PHASE === 'build') return
  state.timer = setInterval(async () => {
    try {
      await tick()
    } catch (e) {
      // error isolation: a failed tick (db hiccup, handler bug) must never
      // kill the worker loop — PHASE 17 "Worker Down" self-healing
      log.error('worker tick failed (isolated)', { error: e instanceof Error ? e.message : String(e) })
    }
  }, WORKER_INTERVAL)
  ;(state.timer as unknown as { unref?: () => void }).unref?.()
}

async function tick(): Promise<void> {
  // memory fallback queue first (due jobs only)
  for (let i = 0; i < state.queue.length; i++) {
    const job = state.queue[i]
    if (job.nextRunAt <= Date.now()) {
      state.queue.splice(i--, 1)
      await runMemoryJob(job)
    }
  }
  // durable queue: claim + run a bounded batch per tick. The DB poll is
  // SKIPPED while idle (mirror has no pending jobs and no recent handoff) to
  // keep the idle query load near zero (PHASE 16 discipline); a slow 5s
  // cross-check still picks up unowned rows handed off by recovery.
  const now = Date.now()
  if (mirror.pending > 0 || now >= nextCrossCheckAt) {
    nextCrossCheckAt = now + 5_000
    for (let n = 0; n < CLAIM_BATCH; n++) {
      const row = await claimNextDue()
      if (!row) break
      await runDbJob(row)
    }
  }
  queueHealth() // gauges stay current
}

let nextCrossCheckAt = 0
