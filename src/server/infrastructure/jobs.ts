// ── BabaHakim Backend · Background Jobs (PHASE 08, ED-102) ────────────────
// In-process job queue: enqueue with attempts/backoff/delay, a ticking
// worker, dead-letter capture. The JobQueue port mirrors BullMQ semantics
// so swapping to Redis+BullMQ (deployment phase) is a config change, not a
// rewrite. Long work (AI analysis, notification fan-out, follow-up scans)
// leaves the request path — responses stay fast.
//
// Worker discipline:
//   - single timer guarded by globalThis (HMR-safe)
//   - never starts during `next build` (NEXT_PHASE=build)
//   - timers unref'd so they never hold the process open
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

const g = globalThis as unknown as {
  __bhJobs?: { queue: Job[]; dead: Job[]; handlers: Map<string, JobHandler>; timer?: ReturnType<typeof setInterval>; lastJobAt?: number }
}
const state = g.__bhJobs ?? { queue: [] as Job[], dead: [] as Job[], handlers: new Map<string, JobHandler>() }
g.__bhJobs = state

let jobSeq = 0

export function registerJob(type: string, handler: (payload: any, job: Job) => Promise<void>): void {
  state.handlers.set(type, handler)
}

export function enqueue<P>(type: string, payload: P, opts: { delayMs?: number; maxAttempts?: number; backoffMs?: number } = {}): string {
  const id = `job_${Date.now().toString(36)}_${++jobSeq}`
  const job: Job<P> = {
    id, type, payload,
    attempts: 0,
    maxAttempts: opts.maxAttempts ?? 3,
    nextRunAt: Date.now() + (opts.delayMs ?? 0),
    backoffMs: opts.backoffMs ?? 2000,
    createdAt: Date.now(),
  }
  // trace continuation: a job inherits the enqueuing request's correlation
  const trace = currentTrace()
  if (trace) (job as Job).meta = { corrId: trace.corrId, traceId: trace.traceId }
  state.queue.push(job as Job)
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

export function deadLetters(): Job[] { return [...state.dead] }

export function queueStats() {
  return { pending: state.queue.length, dead: state.dead.length, types: [...state.handlers.keys()] }
}

/** PHASE 15: queue gauges + worker liveness for health/readiness (ED-175). */
export function queueHealth() {
  gauge('queue_depth', undefined, state.queue.length)
  gauge('queue_dead', undefined, state.dead.length)
  return {
    pending: state.queue.length,
    dead: state.dead.length,
    handlerCount: state.handlers.size,
    workerAlive: state.timer !== undefined,
    lastJobAt: state.lastJobAt ?? null,
  }
}

// test hooks
export const __internals = {
  drain: async () => {
    // process every currently-due job synchronously (retries scheduled in the future are kept)
    for (let i = 0; i < state.queue.length; i++) {
      const job = state.queue[i]
      if (job.nextRunAt <= Date.now()) {
        state.queue.splice(i--, 1)
        await runJob(job)
      }
    }
  },
  reset: () => { state.queue.length = 0; state.dead.length = 0 },
}

let deadHook: DeadLetterHook | null = null
export function setDeadLetterHook(hook: DeadLetterHook): void { deadHook = hook }

async function runJob(job: Job): Promise<void> {
  const handler = state.handlers.get(job.type)
  if (!handler) {
    log.warn('job has no handler — dropped to dead-letter', { type: job.type, id: job.id })
    state.dead.push(job)
    return
  }
  job.attempts += 1
  const started = Date.now()
  state.lastJobAt = Date.now()
  // ED-169: run the handler inside the enqueuing action's trace context so
  // logs/metrics/ServiceLog rows from the job correlate with the request
  const jobTrace: TraceContext = job.meta
    ? enterJobTrace(job.meta, job)
    : { reqId: job.id, corrId: `corr_job_${job.id}`, traceId: job.id.replace(/[^0-9a-f]/g, '').padEnd(32, '0').slice(0, 32), spanId: job.id.slice(-16).replace(/[^0-9a-f]/g, '0').padEnd(16, '0'), route: `job:${job.type}` }
  await enterTrace(jobTrace, async () => {
    try {
      await handler(job.payload, job)
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
        try { await deadHook?.(job, e) } catch { /* hook failures must not loop */ }
      } else {
        job.nextRunAt = Date.now() + job.backoffMs * job.attempts // linear backoff
        state.queue.push(job)
      }
    }
  })
}

function ensureWorker() {
  if (state.timer) return
  if (process.env.NEXT_PHASE === 'build') return
  state.timer = setInterval(async () => {
    const now = Date.now()
    for (let i = 0; i < state.queue.length; i++) {
      const job = state.queue[i]
      if (job.nextRunAt <= now) {
        state.queue.splice(i--, 1)
        void runJob(job)
      }
    }
  }, WORKER_INTERVAL)
  ;(state.timer as unknown as { unref?: () => void }).unref?.()
}
