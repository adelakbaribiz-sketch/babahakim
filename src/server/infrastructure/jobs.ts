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
}

export type JobHandler = (payload: any, job: Job) => Promise<void>
export type DeadLetterHook = (job: Job, error: unknown) => Promise<void> | void

const WORKER_INTERVAL = 1000

const g = globalThis as unknown as {
  __bhJobs?: { queue: Job[]; dead: Job[]; handlers: Map<string, JobHandler>; timer?: ReturnType<typeof setInterval> }
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
  state.queue.push(job as Job)
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
  try {
    await handler(job.payload, job)
    log.debug('job done', { type: job.type, id: job.id, ms: Date.now() - started, attempt: job.attempts })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    log.warn('job failed', { type: job.type, id: job.id, attempt: job.attempts, error: message })
    if (job.attempts >= job.maxAttempts) {
      state.dead.push(job)
      log.error('job dead-lettered', { type: job.type, id: job.id, attempts: job.attempts })
      try { await deadHook?.(job, e) } catch { /* hook failures must not loop */ }
    } else {
      job.nextRunAt = Date.now() + job.backoffMs * job.attempts // linear backoff
      state.queue.push(job)
    }
  }
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
