/**
 * PHASE 12: Workflow Policy Layer — Unit Tests (pure, DB-free)
 * Coverage: timeout policy resolution, SLA arithmetic, the governance
 * decision ladder (REMIND cooldown/cap, ESCALATE one-shot latch,
 * AUTO_TRANSITION cooldown), retry backoff curves, failure/recovery
 * taxonomy completeness for all 11 registered machines.
 */
import { describe, test, expect } from 'bun:test'
import {
  TIMEOUT_POLICIES, RETRY_POLICIES, FAILURE_POLICIES,
  timeoutPoliciesFor, timeoutPolicyStatuses, allTimeoutPolicies,
  retryPolicyFor, failurePolicyFor,
  governanceDecision, slaDeadline, breachMs, computeBackoffMs, slaLabel,
} from '@/lib/workflow/policies'
import type { GovernanceEntry, TimeoutPolicy } from '@/lib/workflow/policies'
import { allMachines } from '@/lib/workflow/registry'

const MIN = 60_000
const HOUR = 3_600_000
const DAY = 24 * HOUR

/* ── catalog integrity ────────────────────────────────────────────────── */

describe('policy catalog integrity', () => {
  test('every policy references a registered machine + a legal status of it', () => {
    const machines = new Map(allMachines().map((m) => [m.entity, m]))
    for (const p of TIMEOUT_POLICIES) {
      const m = machines.get(p.entity)
      expect(m).toBeDefined()
      expect(m!.statuses).toContain(p.status)
      expect(p.afterMs).toBeGreaterThan(0)
      expect(p.descFa.length).toBeGreaterThan(0)
      if (p.level === 'AUTO_TRANSITION') {
        // auto actions must exist as a SYSTEM-fireable transition of the machine
        expect(p.autoAction).toBeTruthy()
        const t = m!.transitions.find((x) => x.action === p.autoAction)
        expect(t).toBeDefined()
        expect(t!.system).toBe(true)
      }
    }
  })

  test('every machine has a failure policy and recovery stance (PHASE 12 mandate)', () => {
    for (const m of allMachines()) {
      const f = failurePolicyFor(m.entity)
      expect(f).toBeDefined()
      // failure statuses must be legal statuses of the machine
      for (const s of f.failureStatuses) expect(m.statuses).toContain(s)
      // recovery actions must exist in the machine graph
      for (const a of f.recoveryActions) {
        expect(m.transitions.some((t) => t.action === a)).toBe(true)
      }
    }
  })

  test('resolvers: timeoutPoliciesFor filters entity+status, statuses dedupe', () => {
    expect(timeoutPoliciesFor('CASE', 'WAITING_FOR_EXPERT_1').length).toBe(2) // 24h REMIND + 72h ESCALATE ladder
    expect(timeoutPoliciesFor('CASE', 'CLOSED')).toEqual([])
    expect(timeoutPoliciesFor('NOPE', 'X')).toEqual([])
    const statuses = timeoutPolicyStatuses('PAYMENT')
    expect(statuses).toContain('PENDING')
    expect(statuses).toContain('AWAITING_VERIFY')
    expect(new Set(statuses).size).toBe(statuses.length) // deduped
    expect(allTimeoutPolicies().length).toBe(TIMEOUT_POLICIES.length)
  })

  test('gateway session expiry is the only AUTO_TRANSITION and is minutes-scaled', () => {
    const autos = TIMEOUT_POLICIES.filter((p) => p.level === 'AUTO_TRANSITION')
    expect(autos.length).toBe(1)
    expect(autos[0].entity).toBe('PAYMENT')
    expect(autos[0].status).toBe('PENDING')
    expect(autos[0].afterMs).toBeLessThanOrEqual(HOUR)
  })

  test('privacy deadline: deletion requests escalate within 7 days', () => {
    const escalate = TIMEOUT_POLICIES.find(
      (p) => p.entity === 'DELETION_REQUEST' && p.level === 'ESCALATE',
    )
    expect(escalate).toBeDefined()
    expect(escalate!.afterMs).toBeLessThanOrEqual(7 * DAY)
  })

  test('slaLabel renders human-readable Persian durations', () => {
    expect(slaLabel({ afterMs: DAY } as TimeoutPolicy)).toBe('1 روز')
    expect(slaLabel({ afterMs: 12 * HOUR } as TimeoutPolicy)).toBe('12 ساعت')
    expect(slaLabel({ afterMs: 30 * MIN } as TimeoutPolicy)).toBe('30 دقیقه')
  })
})

/* ── SLA arithmetic ───────────────────────────────────────────────────── */

describe('SLA arithmetic (slaDeadline / breachMs)', () => {
  const policy: TimeoutPolicy = { entity: 'CASE', status: 'X', afterMs: 24 * HOUR, level: 'REMIND', descFa: '' }
  const enteredAt = new Date('2026-09-01T00:00:00Z')

  test('deadline = enteredAt + afterMs', () => {
    expect(slaDeadline({ enteredAt }, policy).getTime()).toBe(enteredAt.getTime() + 24 * HOUR)
  })

  test('breachMs negative before deadline, positive after', () => {
    expect(breachMs({ enteredAt }, policy, new Date(enteredAt.getTime() + 23 * HOUR))).toBe(-HOUR)
    expect(breachMs({ enteredAt }, policy, new Date(enteredAt.getTime() + 25 * HOUR))).toBe(HOUR)
    expect(breachMs({ enteredAt }, policy, new Date(enteredAt.getTime() + 24 * HOUR))).toBe(0)
  })
})

/* ── governance decision ladder ───────────────────────────────────────── */

describe('governanceDecision ladder', () => {
  const remind: TimeoutPolicy = { entity: 'CASE', status: 'X', afterMs: 24 * HOUR, level: 'REMIND', descFa: '' }
  const escalate: TimeoutPolicy = { entity: 'CASE', status: 'X', afterMs: 72 * HOUR, level: 'ESCALATE', descFa: '' }
  const auto: TimeoutPolicy = { entity: 'PAYMENT', status: 'PENDING', afterMs: 30 * MIN, level: 'AUTO_TRANSITION', autoAction: 'GATEWAY_FAIL', descFa: '' }

  const entry = (over: Partial<GovernanceEntry> = {}): GovernanceEntry => ({
    status: 'X', enteredAt: new Date(Date.parse('2026-09-01T00:00:00Z')),
    lastRemindedAt: null, reminderCount: 0, escalatedAt: null, ...over,
  })
  const at = (h: number) => new Date(Date.parse('2026-09-01T00:00:00Z') + h * HOUR)

  test('REMIND: NOT_DUE before the deadline', () => {
    expect(governanceDecision(entry(), remind, at(23)).fire).toBe(false)
  })

  test('REMIND: fires when overdue, respects cooldown + cap', () => {
    expect(governanceDecision(entry(), remind, at(25)).fire).toBe(true)
    // just reminded 1h ago (cooldown default 24h) → COOLDOWN
    const d = governanceDecision(entry({ lastRemindedAt: at(24), reminderCount: 1 }), remind, at(25))
    expect(d.fire).toBe(false)
    expect(d.fire === false && d.reason).toBe('COOLDOWN')
    // cap reached → MAX_REMINDERS (last reminder 25h ago, cooldown passed)
    const capped = governanceDecision(entry({ lastRemindedAt: at(0), reminderCount: 3 }), remind, at(25))
    expect(capped.fire).toBe(false)
    expect(capped.fire === false && capped.reason).toBe('MAX_REMINDERS')
  })

  test('ESCALATE: one-shot latch', () => {
    expect(governanceDecision(entry(), escalate, at(80)).fire).toBe(true)
    const done = governanceDecision(entry({ escalatedAt: at(75) }), escalate, at(80))
    expect(done.fire).toBe(false)
    expect(done.fire === false && done.reason).toBe('ALREADY_ESCALATED')
    // not due yet at 71h
    expect(governanceDecision(entry(), escalate, at(71)).fire).toBe(false)
  })

  test('AUTO_TRANSITION: fires when due, short cooldown backs retries', () => {
    const e2 = (over: Partial<GovernanceEntry> = {}): GovernanceEntry => ({
      status: 'PENDING', enteredAt: new Date(Date.parse('2026-09-01T00:00:00Z')),
      lastRemindedAt: null, reminderCount: 0, escalatedAt: null, ...over,
    })
    const t = (m: number) => new Date(Date.parse('2026-09-01T00:00:00Z') + m * MIN)
    expect(governanceDecision(e2(), auto, t(31)).fire).toBe(true)
    // failed 1 minute ago (cooldown default 5 min) → COOLDOWN_AUTO
    const cooling = governanceDecision(e2({ lastRemindedAt: t(30) }), auto, t(31))
    expect(cooling.fire).toBe(false)
    expect(cooling.fire === false && cooling.reason).toBe('COOLDOWN_AUTO')
    // 10 minutes after the failure → retries
    expect(governanceDecision(e2({ lastRemindedAt: t(20) }), auto, t(31)).fire).toBe(true)
  })

  test('custom cooldown is honored', () => {
    const p: TimeoutPolicy = { ...remind, cooldownMs: 10 * MIN }
    // 6 minutes since the last reminder < 10-minute cooldown → suppressed
    const d = governanceDecision(entry({ lastRemindedAt: at(24.9), reminderCount: 1 }), p, at(25))
    expect(d.fire).toBe(false)
    expect(d.fire === false && d.reason).toBe('COOLDOWN')
    // 20 minutes since the last reminder > cooldown → fires
    expect(governanceDecision(entry({ lastRemindedAt: at(24.67), reminderCount: 1 }), p, at(25)).fire).toBe(true)
  })
})

/* ── retry backoff ────────────────────────────────────────────────────── */

describe('retry policies + backoff curves', () => {
  test('exponential: base * 2^(n-1)', () => {
    const p = retryPolicyFor('PAYMENT', 'AUTO_TRANSITION') // 2s base, EXPONENTIAL
    expect(computeBackoffMs(p, 1)).toBe(2_000)
    expect(computeBackoffMs(p, 2)).toBe(4_000)
    expect(computeBackoffMs(p, 3)).toBe(8_000)
  })

  test('linear: base * n', () => {
    const p = { entity: 'FOLLOWUP' as const, scope: 'BATCH_TRANSITION' as const, maxAttempts: 2, backoff: 'LINEAR' as const, baseMs: 5_000, descFa: '' }
    expect(computeBackoffMs(p, 1)).toBe(5_000)
    expect(computeBackoffMs(p, 2)).toBe(10_000)
  })

  test('attempt 0/negative clamps to 1', () => {
    const p = RETRY_POLICIES[0]
    expect(computeBackoffMs(p, 0)).toBe(computeBackoffMs(p, 1))
    expect(computeBackoffMs(p, -5)).toBe(computeBackoffMs(p, 1))
  })

  test('unknown (entity, scope) falls back to the default policy', () => {
    const p = retryPolicyFor('TICKET', 'AUTO_TRANSITION')
    expect(p.maxAttempts).toBe(3)
    expect(p.backoff).toBe('EXPONENTIAL')
  })
})
