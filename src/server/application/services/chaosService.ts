// ── BabaHakim Application Service · Chaos Console (PHASE 17, ED-187) ──────
// Business logic for the failure-injection control plane. The API route
// stays a thin controller (ED-93); every mutation is audited (CHAOS_FAULT).
// Availability of the console itself is double-gated (env + ADMIN) — see
// the route. Actions:
//   activate / deactivate / clear  — arm & disarm named faults (TTL time-boxed)
//   inject-job                     — enqueue a job of an arbitrary type
//   inject-stale-running           — simulate a worker crash mid-job
//   recover                        — run crash recovery immediately
import { db } from '@/lib/db'
import { AppError, NotFoundError, ErrorCode } from '@/server/core/errors'
import { writeAudit } from '@/server/infrastructure/audit'
import { chaosEnabled, activeFaults, activateFault, deactivateFault, clearFaults, FAULT_NAMES } from '@/server/infrastructure/faults'
import { runJobRecovery, enqueue } from '@/server/infrastructure/jobs'
import type { RequestContext } from '@/server/core/context'

export interface ChaosAction {
  action: 'activate' | 'deactivate' | 'clear' | 'inject-job' | 'inject-stale-running' | 'recover'
  fault?: string
  type?: string
  payload?: unknown
  ttlMs?: number
}

export function getChaosStatus(): { chaos: boolean; enabled: boolean; faults: string[]; available: readonly string[] } {
  return { chaos: true, enabled: chaosEnabled(), faults: activeFaults(), available: FAULT_NAMES }
}

/** Route-facing helper — keeps the controller free of infrastructure imports. */
export function chaosModeOn(): boolean {
  return chaosEnabled()
}

export async function runChaosAction(input: ChaosAction, ctx: RequestContext, actorId: string): Promise<Record<string, unknown>> {
  let result: Record<string, unknown> = { ok: true }

  switch (input.action) {
    case 'activate': {
      if (!input.fault) throw new AppError('VALIDATION' as ErrorCode, 'fault لازم است', 422)
      await activateFault(input.fault, input.ttlMs)
      result = { ok: true, armed: activeFaults() }
      break
    }
    case 'deactivate': {
      if (!input.fault) throw new AppError('VALIDATION' as ErrorCode, 'fault لازم است', 422)
      await deactivateFault(input.fault)
      result = { ok: true, armed: activeFaults() }
      break
    }
    case 'clear': {
      await clearFaults()
      result = { ok: true, armed: [] }
      break
    }
    case 'inject-job': {
      // enqueue a job of an arbitrary type — unknown types dead-letter
      // immediately (DLQ drill); known types execute for real
      const type = input.type ?? 'chaos.probe.unknown'
      const id = enqueue(type, input.payload ?? {}, { maxAttempts: 2, backoffMs: 10 })
      result = { ok: true, jobId: id, type }
      break
    }
    case 'inject-stale-running': {
      // simulate a job whose worker CRASHED mid-run (claimed, never finished)
      const type = input.type ?? 'metrics-sampler'
      const id = `job_chaos_${Date.now().toString(36)}`
      await db.durableJob.create({
        data: {
          id, type, payload: JSON.stringify(input.payload ?? {}),
          status: 'RUNNING', attempts: 1, maxAttempts: 3, backoffMs: 100,
          claimedAt: new Date(Date.now() - 10 * 60_000), // 10min stale
          ownerPid: process.pid - 1, // a "dead" worker
        },
      })
      result = { ok: true, jobId: id, type, staleRunning: true }
      break
    }
    case 'recover': {
      const rec = await runJobRecovery()
      result = { ok: true, ...rec }
      break
    }
  }

  await writeAudit(ctx, {
    userId: actorId,
    action: 'CHAOS_FAULT',
    entity: 'Chaos',
    entityId: input.fault ?? input.action,
    newValues: { action: input.action, type: input.type ?? null, armed: activeFaults() },
  })

  return result
}

/** 404 helper used by the route when chaos mode is off (invisible console). */
export function chaosNotFound(): never {
  throw new NotFoundError()
}
