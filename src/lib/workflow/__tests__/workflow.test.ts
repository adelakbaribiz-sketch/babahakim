/**
 * BabaHakim Workflow Engine — Unit Tests (PHASE 02)
 * Coverage: transition resolution, role/permission/ownership guards,
 * graph integrity for all 8 machines, validation hooks, data-effect
 * purity, registry wiring, backward-compat shim, and the NOT_FOUND
 * execution path.
 */
import { describe, test, expect } from 'bun:test'
import {
  CASE_MACHINE, PRESCRIPTION_MACHINE, ORDER_MACHINE, PAYMENT_MACHINE,
  SHIPMENT_MACHINE, TICKET_MACHINE, FOLLOWUP_MACHINE, AI_REVIEW_MACHINE,
  DELETION_REQUEST_MACHINE, MEDICAL_IMAGE_MACHINE, INVOICE_MACHINE,
  resolveTransition, assertGuards, hasPermission, ownsEntity,
  reachableFrom, terminalStatuses, executeTransition, getMachine, allMachines,
  WorkflowError,
} from '@/lib/workflow'
import type { MachineDef, EntityRow, WorkflowActor } from '@/lib/workflow'
import { PERMISSIONS } from '@/lib/constants'
import { QUEUES, ROLE_QUEUE_STATUSES } from '@/lib/workflow/queues'

const MACHINES: MachineDef[] = [
  CASE_MACHINE, PRESCRIPTION_MACHINE, ORDER_MACHINE, PAYMENT_MACHINE,
  SHIPMENT_MACHINE, TICKET_MACHINE, FOLLOWUP_MACHINE, AI_REVIEW_MACHINE,
  DELETION_REQUEST_MACHINE, MEDICAL_IMAGE_MACHINE, INVOICE_MACHINE,
]

const row = (status: string, extra: Record<string, unknown> = {}): EntityRow =>
  ({ id: 'e1', status, ...extra }) as EntityRow

const actor = (id: string, role: string): WorkflowActor => ({ id, role: role as never })

/* ── graph integrity (all machines) ─────────────────────────────────── */

describe('machine graph integrity', () => {
  test('all 11 machines are registered (PHASE 12: +DELETION_REQUEST/MEDICAL_IMAGE/INVOICE)', () => {
    expect(allMachines().length).toBe(11)
    for (const key of [
      'CASE', 'PRESCRIPTION', 'ORDER', 'PAYMENT', 'SHIPMENT', 'TICKET', 'FOLLOWUP', 'AI_REVIEW',
      'DELETION_REQUEST', 'MEDICAL_IMAGE', 'INVOICE',
    ]) {
      expect(() => getMachine(key)).not.toThrow()
    }
    expect(() => getMachine('NOPE')).toThrow(WorkflowError)
  })

  for (const m of MACHINES) {
    test(`${m.entity}: transition statuses ⊆ catalog, unique actions, valid roles/permissions`, () => {
      const actions = new Set<string>()
      for (const t of m.transitions) {
        expect(m.statuses).toContain(t.to)
        for (const f of t.from) expect(m.statuses).toContain(f)
        expect(t.descFa.length).toBeGreaterThan(0)
        expect(t.roles.length).toBeGreaterThan(0)
        for (const r of t.roles) {
          expect([...['ADMIN', 'EXPERT_1', 'EXPERT_2', 'OPERATOR', 'DOCTOR', 'PATIENT', 'SYSTEM']]).toContain(r)
        }
        if (t.permission) {
          expect([...PERMISSIONS]).toContain(t.permission)
        }
        // an action may legally appear once per machine (action+from pairs unique)
        expect(actions.has(t.action)).toBe(false)
        actions.add(t.action)
        expect(t.to).not.toBe('')
      }
      expect(m.statuses).toContain(m.initial)
      expect(m.prismaKey.length).toBeGreaterThan(0)
    })
  }

  test('CASE: 21 statuses / 19 transitions (NEW is a virtual creation state)', () => {
    expect(CASE_MACHINE.statuses.length).toBe(21)
    expect(CASE_MACHINE.transitions.length).toBe(19) // +EXPERT2_RETURN (2026-10 overhaul)
    // creation writes WAITING_FOR_EXPERT_1 directly (CaseEvent logs the virtual NEW→WAITING step)
    expect(CASE_MACHINE.initial).toBe('NEW')
  })

  test('CASE: closed/cancelled are terminal', () => {
    const terminals = terminalStatuses(CASE_MACHINE)
    expect(terminals).toContain('CLOSED')
    expect(terminals).toContain('CANCELLED')
  })

  test('golden path is walkable end-to-end', () => {
    const path: [string, string][] = [
      ['CLAIM', 'EXPERT_1'], ['SUBMIT_ASSESSMENT', 'EXPERT_1'], ['USER_APPROVE', 'PATIENT'],
      ['SUBMIT_PRESCRIPTION', 'EXPERT_1'], ['EXPERT2_REVIEW', 'EXPERT_2'], ['DOCTOR_APPROVE', 'DOCTOR'],
      ['CREATE_PROFORMA', 'OPERATOR'], ['CONFIRM_PROFORMA', 'PATIENT'], ['MARK_PAID', 'OPERATOR'],
      ['START_SHIPPING', 'OPERATOR'], ['MARK_DELIVERED', 'OPERATOR'], ['SCHEDULE_FOLLOWUP', 'OPERATOR'],
      ['COMPLETE_FOLLOWUP', 'OPERATOR'],
    ]
    let status = 'WAITING_FOR_EXPERT_1'
    for (const [action, role] of path) {
      const t = resolveTransition(CASE_MACHINE, status, action, role as never)
      expect(t).not.toBeNull()
      status = t!.to
    }
    expect(status).toBe('CLOSED')
  })
})

/* ── 2026-10 overhaul: rejection / return loops never close the case ── */

describe('revision loops (doctor reject · expert 2 return)', () => {
  const fire = (machine: MachineDef, action: string, status: string, payload: Record<string, unknown>, who: string) => {
    const entity = row(status, { patientId: 'u1', userId: 'u1' })
    const t = assertGuards(machine, entity, action, actor('u1', who))
    return t.validate?.({ entity, actor: actor('u1', who), payload, transition: t, machine, now: new Date() })
  }

  test('DOCTOR_REJECT returns the case to Expert 1 revision — never CLOSED', () => {
    const t = resolveTransition(CASE_MACHINE, 'WAITING_FOR_DOCTOR', 'DOCTOR_REJECT', 'DOCTOR')
    expect(t?.to).toBe('REVISION_REQUESTED')
    const effects = t!.dataEffects?.({ entity: { id: 'c', status: 'WAITING_FOR_DOCTOR' }, actor: { id: 'd', role: 'DOCTOR' }, payload: { comment: 'x' }, transition: t!, machine: CASE_MACHINE, now: new Date() }) || {}
    expect(effects).not.toHaveProperty('closedAt')
  })

  test('a rejected case can be re-prescribed, re-reviewed and approved', () => {
    const path: [string, string][] = [
      ['DOCTOR_REJECT', 'DOCTOR'], ['SUBMIT_PRESCRIPTION', 'EXPERT_1'],
      ['EXPERT2_REVIEW', 'EXPERT_2'], ['DOCTOR_APPROVE', 'DOCTOR'],
    ]
    let status = 'WAITING_FOR_DOCTOR'
    for (const [action, role] of path) {
      const t = resolveTransition(CASE_MACHINE, status, action, role as never)
      expect(t).not.toBeNull()
      status = t!.to
    }
    expect(status).toBe('PRESCRIPTION_APPROVED')
  })

  test('EXPERT2_RETURN puts the case in Expert 1 queue state and requires a reason', () => {
    expect(resolveTransition(CASE_MACHINE, 'WAITING_FOR_EXPERT_2', 'EXPERT2_RETURN', 'EXPERT_2')?.to).toBe('REVISION_REQUESTED')
    expect(resolveTransition(CASE_MACHINE, 'WAITING_FOR_EXPERT_2', 'EXPERT2_RETURN', 'EXPERT_1')).toBeNull()
    expect(() => fire(CASE_MACHINE, 'EXPERT2_RETURN', 'WAITING_FOR_EXPERT_2', {}, 'EXPERT_2')).toThrow()
    expect(() => fire(CASE_MACHINE, 'EXPERT2_RETURN', 'WAITING_FOR_EXPERT_2', { reason: 'دوز نامشخص' }, 'EXPERT_2')).not.toThrow()
  })

  test('every actionable staff status is listed in some work queue', () => {
    const queued = new Set(QUEUES.flatMap((q) => q.statuses))
    for (const t of CASE_MACHINE.transitions) {
      if (t.roles.some((r) => r === 'EXPERT_1' || r === 'EXPERT_2' || r === 'DOCTOR')) {
        for (const from of t.from) expect(queued.has(from)).toBe(true)
      }
    }
    expect(ROLE_QUEUE_STATUSES.EXPERT_1).toContain('REVISION_REQUESTED')
  })
})

/* ── resolveTransition: role matrix ─────────────────────────────────── */

describe('resolveTransition role guards', () => {
  test('EXPERT_1 can CLAIM a waiting case', () => {
    const t = resolveTransition(CASE_MACHINE, 'WAITING_FOR_EXPERT_1', 'CLAIM', 'EXPERT_1')
    expect(t?.to).toBe('EXPERT_1_REVIEW')
  })

  test('PATIENT cannot CLAIM', () => {
    expect(resolveTransition(CASE_MACHINE, 'WAITING_FOR_EXPERT_1', 'CLAIM', 'PATIENT')).toBeNull()
  })

  test('DOCTOR cannot CLAIM', () => {
    expect(resolveTransition(CASE_MACHINE, 'WAITING_FOR_EXPERT_1', 'CLAIM', 'DOCTOR')).toBeNull()
  })

  test('ADMIN bypasses role guards (BR-RBAC-02)', () => {
    const t = resolveTransition(CASE_MACHINE, 'WAITING_FOR_EXPERT_1', 'CLAIM', 'ADMIN')
    expect(t?.to).toBe('EXPERT_1_REVIEW')
  })

  test('wrong source status is rejected', () => {
    expect(resolveTransition(CASE_MACHINE, 'NEW', 'CLAIM', 'EXPERT_1')).toBeNull()
    expect(resolveTransition(CASE_MACHINE, 'CLOSED', 'CLAIM', 'EXPERT_1')).toBeNull()
  })

  test('unknown action is rejected', () => {
    expect(resolveTransition(CASE_MACHINE, 'NEW', 'HOLOGRAM', 'ADMIN')).toBeNull()
  })

  test('SYSTEM fires only system-flagged transitions', () => {
    expect(resolveTransition(PAYMENT_MACHINE, 'PENDING', 'GATEWAY_VERIFY', 'SYSTEM')?.to).toBe('PAID')
    expect(resolveTransition(PAYMENT_MACHINE, 'PENDING', 'GATEWAY_FAIL', 'SYSTEM')?.to).toBe('FAILED')
    expect(resolveTransition(CASE_MACHINE, 'WAITING_FOR_EXPERT_1', 'CLAIM', 'SYSTEM')).toBeNull()
  })

  test('non-system actor cannot fire system transitions', () => {
    expect(resolveTransition(PAYMENT_MACHINE, 'PENDING', 'GATEWAY_VERIFY', 'OPERATOR')).toBeNull()
  })

  test('patient-only transitions (G1 gate)', () => {
    expect(resolveTransition(CASE_MACHINE, 'WAITING_FOR_USER_APPROVAL', 'USER_APPROVE', 'PATIENT')?.to)
      .toBe('WAITING_FOR_EXPERT_1_PRESCRIPTION')
    expect(resolveTransition(CASE_MACHINE, 'WAITING_FOR_USER_APPROVAL', 'USER_APPROVE', 'OPERATOR')).toBeNull()
  })
})

/* ── permission + ownership guards ──────────────────────────────────── */

describe('hasPermission / ownsEntity', () => {
  test('permission matrix', () => {
    expect(hasPermission('ADMIN', 'verify_payment')).toBe(true)
    expect(hasPermission('OPERATOR', 'verify_payment')).toBe(true)
    expect(hasPermission('EXPERT_1', 'verify_payment')).toBe(false)
    expect(hasPermission('DOCTOR', 'approve_prescription')).toBe(true)
    expect(hasPermission('OPERATOR', 'approve_prescription')).toBe(false)
    expect(hasPermission('PATIENT', undefined)).toBe(true)
    expect(hasPermission('SYSTEM', 'verify_payment')).toBe(true)
  })

  test('ownership guard (BR-RBAC-03)', () => {
    const caseRow = row('WAITING_FOR_USER_APPROVAL', { patientId: 'p1' })
    expect(ownsEntity(CASE_MACHINE, caseRow, actor('p1', 'PATIENT'))).toBe(true)
    expect(ownsEntity(CASE_MACHINE, caseRow, actor('p2', 'PATIENT'))).toBe(false)
    expect(ownsEntity(CASE_MACHINE, caseRow, actor('op1', 'OPERATOR'))).toBe(true)
    expect(ownsEntity(PAYMENT_MACHINE, row('PENDING', { userId: 'p1' }), actor('p2', 'PATIENT'))).toBe(false)
  })
})

/* ── assertGuards error taxonomy ────────────────────────────────────── */

describe('assertGuards throws typed errors', () => {
  const caseRow = row('WAITING_FOR_USER_APPROVAL', { patientId: 'p1' })

  test('INVALID_TRANSITION (409) for wrong status', () => {
    try {
      assertGuards(CASE_MACHINE, row('NEW'), 'USER_APPROVE', actor('p1', 'PATIENT'))
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as WorkflowError).code).toBe('INVALID_TRANSITION')
      expect((e as WorkflowError).httpStatus).toBe(409)
    }
  })

  test('FORBIDDEN_PERMISSION (403) when role lacks permission', () => {
    // FOLLOWUP.COMPLETE lists DOCTOR in roles, but DOCTOR lacks manage_followups
    try {
      assertGuards(FOLLOWUP_MACHINE, row('DUE', { patientId: 'u1' }), 'COMPLETE', actor('u1', 'DOCTOR'))
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as WorkflowError).code).toBe('FORBIDDEN_PERMISSION')
      expect((e as WorkflowError).httpStatus).toBe(403)
    }
  })

  test('NOT_OWNER (403) when patient acts on foreign case', () => {
    try {
      assertGuards(CASE_MACHINE, caseRow, 'USER_APPROVE', actor('p2', 'PATIENT'))
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as WorkflowError).code).toBe('NOT_OWNER')
      expect((e as WorkflowError).httpStatus).toBe(403)
    }
  })
})

/* ── validation hooks (pure) ────────────────────────────────────────── */

describe('validation hooks', () => {
  const fire = (machine: MachineDef, action: string, status: string, payload: Record<string, unknown>, who: string) => {
    const entity = row(status, { patientId: 'u1', userId: 'u1' })
    const t = assertGuards(machine, entity, action, actor('u1', who))
    return t.validate?.({ entity, actor: actor('u1', who), payload, transition: t, machine, now: new Date() })
  }

  test('USER_DECLINE requires a reason', () => {
    expect(() => fire(CASE_MACHINE, 'USER_DECLINE', 'WAITING_FOR_USER_APPROVAL', {}, 'PATIENT')).toThrow()
    expect(() => fire(CASE_MACHINE, 'USER_DECLINE', 'WAITING_FOR_USER_APPROVAL', { reason: 'مصرف دارو' }, 'PATIENT')).not.toThrow()
  })

  test('DOCTOR_REJECT/REVISION require a comment', () => {
    expect(() => fire(CASE_MACHINE, 'DOCTOR_REJECT', 'WAITING_FOR_DOCTOR', {}, 'DOCTOR')).toThrow()
    expect(() => fire(CASE_MACHINE, 'DOCTOR_REJECT', 'WAITING_FOR_DOCTOR', { comment: 'تداخل دارویی' }, 'DOCTOR')).not.toThrow()
    expect(() => fire(CASE_MACHINE, 'DOCTOR_REVISION', 'WAITING_FOR_DOCTOR', {}, 'DOCTOR')).toThrow()
  })

  test('PAYMENT.VERIFY_REJECT requires a note', () => {
    expect(() => fire(PAYMENT_MACHINE, 'VERIFY_REJECT', 'AWAITING_VERIFY', {}, 'OPERATOR')).toThrow()
    expect(() => fire(PAYMENT_MACHINE, 'VERIFY_REJECT', 'AWAITING_VERIFY', { note: 'مبلغ ناهمخوان' }, 'OPERATOR')).not.toThrow()
  })

  test('ORDER.CANCEL requires reason ≥ 3 chars', () => {
    expect(() => fire(ORDER_MACHINE, 'CANCEL', 'PENDING_CONFIRMATION', { reason: 'x' }, 'OPERATOR')).toThrow()
    expect(() => fire(ORDER_MACHINE, 'CANCEL', 'PENDING_CONFIRMATION', { reason: 'عدم موجودی' }, 'OPERATOR')).not.toThrow()
  })

  test('PRESCRIPTION.DOCTOR_REJECT requires comment', () => {
    expect(() => fire(PRESCRIPTION_MACHINE, 'DOCTOR_REJECT', 'PENDING_DOCTOR', {}, 'DOCTOR')).toThrow()
    expect(() => fire(PRESCRIPTION_MACHINE, 'DOCTOR_REJECT', 'PENDING_DOCTOR', { comment: 'دوز نامناسب' }, 'DOCTOR')).not.toThrow()
  })

  test('AI_REVIEW.REJECT requires comment', () => {
    expect(() => fire(AI_REVIEW_MACHINE, 'REJECT', 'PENDING_REVIEW', {}, 'EXPERT_1')).toThrow()
    expect(() => fire(AI_REVIEW_MACHINE, 'REJECT', 'PENDING_REVIEW', { comment: 'تصویر بی‌کیفیت' }, 'EXPERT_1')).not.toThrow()
  })

  test('SHIPMENT.FAIL requires reason', () => {
    expect(() => fire(SHIPMENT_MACHINE, 'FAIL', 'SHIPPED', {}, 'OPERATOR')).toThrow()
    expect(() => fire(SHIPMENT_MACHINE, 'FAIL', 'SHIPPED', { reason: 'گیرنده در دسترس نبود' }, 'OPERATOR')).not.toThrow()
  })
})

/* ── data-effect purity ─────────────────────────────────────────────── */

describe('data effects', () => {
  const effects = (machine: MachineDef, action: string, entity: EntityRow, payload: Record<string, unknown>, who = 'EXPERT_1') => {
    const t = machine.transitions.find((x) => x.action === action)!
    return t.dataEffects?.({
      entity, actor: actor('u1', who), payload, transition: t, machine, now: new Date('2026-09-04T10:00:00Z'),
    }) || {}
  }

  test('CLAIM assigns the claiming expert', () => {
    const d = effects(CASE_MACHINE, 'CLAIM', row('WAITING_FOR_EXPERT_1'), {})
    expect(d.assignedExpert1Id).toBe('u1')
    expect(Object.keys(d)).not.toContain('status') // engine merges status separately
  })

  test('DOCTOR_APPROVE records doctor + follow-up days', () => {
    const d = effects(CASE_MACHINE, 'DOCTOR_APPROVE', row('WAITING_FOR_DOCTOR', { followUpDays: 30 }), { followUpDays: 21 }, 'DOCTOR')
    expect(d.assignedDoctorId).toBe('u1')
    expect(d.followUpDays).toBe(21)
  })

  test('GATEWAY_VERIFY stamps refNumber/verifiedAt/gateway', () => {
    const d = effects(PAYMENT_MACHINE, 'GATEWAY_VERIFY', row('PENDING', { code: 'PAY-1' }), { refNumber: '123', authority: 'a1' }, 'SYSTEM')
    expect(d.refNumber).toBe('123')
    expect(d.verifiedAt).toEqual(new Date('2026-09-04T10:00:00Z'))
    expect(JSON.parse(String(d.gateway))).toEqual({ provider: 'ZARINPAL', mock: true, authority: 'a1' })
  })

  test('VERIFY_APPROVE keeps existing refNumber or generates one', () => {
    const d = effects(PAYMENT_MACHINE, 'VERIFY_APPROVE', row('AWAITING_VERIFY', { refNumber: 'R9' }), {}, 'OPERATOR')
    expect(d.refNumber).toBe('R9')
    expect(d.verifiedById).toBe('u1')
  })

  test('SHIPMENT.SHIP fills fields with fallback to existing values', () => {
    const d = effects(SHIPMENT_MACHINE, 'SHIP', row('PREPARING', { method: 'POST', cost: 5, trackingCode: 'TRK-1' }),
      { method: 'CAR', driverName: 'ali', cost: 10 }, 'OPERATOR')
    expect(d.method).toBe('CAR')
    expect(d.trackingCode).toBe('TRK-1') // fallback preserved
    expect(d.cost).toBe(10)
    expect(d.driverName).toBe('ali')
    expect(d.shippingDate).toBeDefined()
  })

  test('FOLLOWUP.COMPLETE stamps completion', () => {
    const d = effects(FOLLOWUP_MACHINE, 'COMPLETE', row('DUE'), { note: 'بهبود کامل' }, 'OPERATOR')
    expect(d.completedById).toBe('u1')
    expect(d.resultNote).toBe('بهبود کامل')
    expect(d.completedAt).toBeDefined()
  })

  test('AI review stamps reviewer + comment', () => {
    const d = effects(AI_REVIEW_MACHINE, 'MODIFY', row('PENDING_REVIEW'), { comment: 'پوشش زبان اصلاح شد' }, 'EXPERT_1')
    expect(d.humanReviewed).toBe(true)
    expect(d.reviewComment).toBe('پوشش زبان اصلاح شد')
    expect(d.reviewedById).toBe('u1')
  })
})

/* ── backward-compat shim ───────────────────────────────────────────── */

describe('backward compatibility (constants shim)', () => {
  test('TRANSITIONS re-export the case machine', async () => {
    const { TRANSITIONS, canTransition } = await import('@/lib/constants')
    expect(TRANSITIONS.length).toBe(19)
    expect(canTransition('WAITING_FOR_EXPERT_1', 'CLAIM', 'EXPERT_1')?.to).toBe('EXPERT_1_REVIEW')
    expect(canTransition('WAITING_FOR_EXPERT_1', 'CLAIM', 'PATIENT')).toBeNull()
    expect(canTransition('NEW', 'CLAIM', 'EXPERT_1')).toBeNull()
  })
})

/* ── reachableFrom / terminalStatuses helpers ───────────────────────── */

describe('graph helpers', () => {
  test('reachableFrom maps status → legal targets', () => {
    expect(reachableFrom(CASE_MACHINE, 'WAITING_FOR_EXPERT_1')).toContain('EXPERT_1_REVIEW')
    expect(reachableFrom(ORDER_MACHINE, 'PREPARING')).toContain('READY_TO_SHIP')
  })

  test('payment terminal states (FAILED can retry, REFUNDED is final)', () => {
    const terminals = terminalStatuses(PAYMENT_MACHINE)
    expect(terminals).toContain('REFUNDED')
    expect(terminals).not.toContain('PENDING')
    expect(terminals).not.toContain('FAILED') // FAILED → RETRY exists
    expect(reachableFrom(PAYMENT_MACHINE, 'FAILED')).toContain('PENDING')
  })
})

/* ── execution layer: NOT_FOUND path (safe DB read) ─────────────────── */

describe('executeTransition error path', () => {
  test('missing entity → NOT_FOUND 404 without throwing', async () => {
    const res = await executeTransition({
      machine: 'CASE', entityId: 'nonexistent-id', action: 'CLAIM',
      actor: actor('u1', 'EXPERT_1'), payload: {},
    })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('NOT_FOUND')
      expect(res.httpStatus).toBe(404)
    }
  })

  test('unknown machine → typed error', () => {
    expect(() => getMachine('TELEPORT')).toThrow(WorkflowError)
  })
})

/* ── per-machine spot checks (from/to wiring) ───────────────────────── */

describe('machine transition spot checks', () => {
  test('PRESCRIPTION doctor flow', () => {
    expect(resolveTransition(PRESCRIPTION_MACHINE, 'PENDING_EXPERT_2', 'EXPERT2_REVIEW', 'EXPERT_2')?.to).toBe('PENDING_DOCTOR')
    expect(resolveTransition(PRESCRIPTION_MACHINE, 'PENDING_DOCTOR', 'DOCTOR_APPROVE', 'DOCTOR')?.to).toBe('APPROVED')
    expect(resolveTransition(PRESCRIPTION_MACHINE, 'PENDING_DOCTOR', 'DOCTOR_REVISION', 'DOCTOR')?.to).toBe('REVISION_REQUESTED')
    expect(resolveTransition(PRESCRIPTION_MACHINE, 'APPROVED', 'SUPERSEDE', 'SYSTEM')?.to).toBe('SUPERSEDED')
    // expert 2 cannot approve
    expect(resolveTransition(PRESCRIPTION_MACHINE, 'PENDING_DOCTOR', 'DOCTOR_APPROVE', 'EXPERT_2')).toBeNull()
  })

  test('ORDER paid-path reflects current production flows', () => {
    expect(resolveTransition(ORDER_MACHINE, 'PENDING_CONFIRMATION', 'MARK_PAID', 'SYSTEM')?.to).toBe('PAID')
    expect(resolveTransition(ORDER_MACHINE, 'PAYMENT_PENDING', 'MARK_PAID', 'OPERATOR')?.to).toBe('PAID')
    expect(resolveTransition(ORDER_MACHINE, 'PAID', 'REFUND', 'ADMIN')?.to).toBe('REFUNDED')
    expect(resolveTransition(ORDER_MACHINE, 'DELIVERED', 'CANCEL', 'OPERATOR')).toBeNull() // delivered cannot cancel
  })

  test('TICKET conversation flow', () => {
    expect(resolveTransition(TICKET_MACHINE, 'OPEN', 'STAFF_REPLY', 'OPERATOR')?.to).toBe('IN_PROGRESS')
    expect(resolveTransition(TICKET_MACHINE, 'IN_PROGRESS', 'PATIENT_REPLY', 'PATIENT')?.to).toBe('WAITING_EXPERT')
    expect(resolveTransition(TICKET_MACHINE, 'WAITING_EXPERT', 'ESCALATE', 'OPERATOR')).toBeNull()
    expect(resolveTransition(TICKET_MACHINE, 'RESOLVED', 'REOPEN', 'PATIENT')?.to).toBe('IN_PROGRESS')
    expect(resolveTransition(TICKET_MACHINE, 'CLOSED', 'PATIENT_REPLY', 'PATIENT')).toBeNull() // closed stays closed
  })

  test('FOLLOWUP lifecycle', () => {
    expect(resolveTransition(FOLLOWUP_MACHINE, 'PENDING', 'MARK_DUE', 'SYSTEM')?.to).toBe('DUE')
    expect(resolveTransition(FOLLOWUP_MACHINE, 'DUE', 'MARK_OVERDUE', 'SYSTEM')?.to).toBe('OVERDUE')
    expect(resolveTransition(FOLLOWUP_MACHINE, 'OVERDUE', 'COMPLETE', 'OPERATOR')?.to).toBe('COMPLETED')
    expect(resolveTransition(FOLLOWUP_MACHINE, 'COMPLETED', 'COMPLETE', 'OPERATOR')).toBeNull() // terminal
  })

  test('AI_REVIEW lifecycle', () => {
    expect(resolveTransition(AI_REVIEW_MACHINE, 'PENDING_REVIEW', 'ACCEPT', 'EXPERT_1')?.to).toBe('ACCEPTED')
    expect(resolveTransition(AI_REVIEW_MACHINE, 'PENDING_REVIEW', 'MODIFY', 'EXPERT_2')?.to).toBe('MODIFIED')
    expect(resolveTransition(AI_REVIEW_MACHINE, 'MODIFIED', 'RESET', 'ADMIN')?.to).toBe('PENDING_REVIEW')
    expect(resolveTransition(AI_REVIEW_MACHINE, 'PENDING_REVIEW', 'RESET', 'ADMIN')).toBeNull()
    // patient can never review AI
    expect(resolveTransition(AI_REVIEW_MACHINE, 'PENDING_REVIEW', 'ACCEPT', 'PATIENT')).toBeNull()
  })

  test('SHIPMENT lifecycle', () => {
    expect(resolveTransition(SHIPMENT_MACHINE, 'PREPARING', 'SHIP', 'OPERATOR')?.to).toBe('SHIPPED')
    expect(resolveTransition(SHIPMENT_MACHINE, 'SHIPPED', 'IN_TRANSIT', 'OPERATOR')?.to).toBe('IN_TRANSIT')
    expect(resolveTransition(SHIPMENT_MACHINE, 'IN_TRANSIT', 'DELIVER', 'OPERATOR')?.to).toBe('DELIVERED')
    expect(resolveTransition(SHIPMENT_MACHINE, 'DELIVERED', 'SHIP', 'OPERATOR')).toBeNull() // terminal
  })

  test('PHASE 12: SYSTEM can fire machine-enabled cascades (MARK_PAID paths)', () => {
    // payment paid-cascade moves the order, case and invoice as SYSTEM
    expect(resolveTransition(ORDER_MACHINE, 'CONFIRMED', 'MARK_PAID', 'SYSTEM')?.to).toBe('PAID')
    expect(resolveTransition(CASE_MACHINE, 'WAITING_FOR_PAYMENT', 'MARK_PAID', 'SYSTEM')?.to).toBe('PAYMENT_CONFIRMED')
    expect(resolveTransition(INVOICE_MACHINE, 'SENT', 'MARK_PAID', 'SYSTEM')?.to).toBe('PAID')
    expect(resolveTransition(INVOICE_MACHINE, 'CONFIRMED', 'MARK_PAID', 'SYSTEM')?.to).toBe('PAID')
    // payment-start path (ED-126): ENTER_PAYMENT closes the graph hole
    expect(resolveTransition(ORDER_MACHINE, 'CONFIRMED', 'ENTER_PAYMENT', 'PATIENT')?.to).toBe('PAYMENT_PENDING')
    expect(resolveTransition(ORDER_MACHINE, 'PENDING_CONFIRMATION', 'ENTER_PAYMENT', 'SYSTEM')?.to).toBe('PAYMENT_PENDING')
    // operator cannot enter payment on someone's behalf
    expect(resolveTransition(ORDER_MACHINE, 'CONFIRMED', 'ENTER_PAYMENT', 'OPERATOR')).toBeNull()
    // delivered orders may not re-enter payment
    expect(resolveTransition(ORDER_MACHINE, 'DELIVERED', 'ENTER_PAYMENT', 'PATIENT')).toBeNull()
  })

  test('PHASE 12: DELETION_REQUEST lifecycle (privacy workflow)', () => {
    expect(DELETION_REQUEST_MACHINE.initial).toBe('PENDING')
    expect(resolveTransition(DELETION_REQUEST_MACHINE, 'PENDING', 'START', 'ADMIN')?.to).toBe('PROCESSING')
    expect(resolveTransition(DELETION_REQUEST_MACHINE, 'PENDING', 'COMPLETE', 'ADMIN')?.to).toBe('COMPLETED')
    expect(resolveTransition(DELETION_REQUEST_MACHINE, 'PROCESSING', 'COMPLETE', 'ADMIN')?.to).toBe('COMPLETED')
    expect(resolveTransition(DELETION_REQUEST_MACHINE, 'PENDING', 'REJECT', 'ADMIN')?.to).toBe('REJECTED')
    // only admins govern privacy requests
    expect(resolveTransition(DELETION_REQUEST_MACHINE, 'PENDING', 'COMPLETE', 'OPERATOR')).toBeNull()
    expect(resolveTransition(DELETION_REQUEST_MACHINE, 'PENDING', 'REJECT', 'PATIENT')).toBeNull()
    // COMPLETED/REJECTED are terminal
    expect(terminalStatuses(DELETION_REQUEST_MACHINE).sort()).toEqual(['COMPLETED', 'REJECTED'])
  })

  test('PHASE 12: MEDICAL_IMAGE lifecycle (AI input gate)', () => {
    expect(MEDICAL_IMAGE_MACHINE.initial).toBe('PENDING')
    expect(resolveTransition(MEDICAL_IMAGE_MACHINE, 'PENDING', 'VALIDATE', 'SYSTEM')?.to).toBe('VALIDATED')
    expect(resolveTransition(MEDICAL_IMAGE_MACHINE, 'PENDING', 'REJECT', 'SYSTEM')?.to).toBe('REJECTED')
    expect(resolveTransition(MEDICAL_IMAGE_MACHINE, 'VALIDATED', 'MARK_PROCESSED', 'SYSTEM')?.to).toBe('PROCESSED')
    // erasure path: images in ANY live state can be rejected by the anonymizer
    expect(resolveTransition(MEDICAL_IMAGE_MACHINE, 'PROCESSED', 'REJECT', 'SYSTEM')?.to).toBe('REJECTED')
    expect(resolveTransition(MEDICAL_IMAGE_MACHINE, 'VALIDATED', 'REJECT', 'SYSTEM')?.to).toBe('REJECTED')
    // recovery: admin re-queues a rejected image
    expect(resolveTransition(MEDICAL_IMAGE_MACHINE, 'REJECTED', 'REVALIDATE', 'ADMIN')?.to).toBe('PENDING')
    expect(resolveTransition(MEDICAL_IMAGE_MACHINE, 'REJECTED', 'REVALIDATE', 'OPERATOR')).toBeNull()
    // patient cannot validate their own image (worker-only)
    expect(resolveTransition(MEDICAL_IMAGE_MACHINE, 'PENDING', 'VALIDATE', 'PATIENT')).toBeNull()
  })

  test('PHASE 12: INVOICE lifecycle (financial documents)', () => {
    expect(INVOICE_MACHINE.initial).toBe('DRAFT')
    expect(resolveTransition(INVOICE_MACHINE, 'DRAFT', 'ISSUE', 'EXPERT_2')?.to).toBe('SENT')
    expect(resolveTransition(INVOICE_MACHINE, 'SENT', 'CONFIRM', 'OPERATOR')?.to).toBe('CONFIRMED')
    expect(resolveTransition(INVOICE_MACHINE, 'SENT', 'MARK_PAID', 'SYSTEM')?.to).toBe('PAID')
    expect(resolveTransition(INVOICE_MACHINE, 'CONFIRMED', 'CANCEL', 'OPERATOR')?.to).toBe('CANCELLED')
    // patients never act on invoices directly (order/case machines own their steps)
    expect(resolveTransition(INVOICE_MACHINE, 'SENT', 'CONFIRM', 'PATIENT')).toBeNull()
    // PAID invoices are terminal (refunds run on ORDER/PAYMENT machines)
    expect(terminalStatuses(INVOICE_MACHINE).sort()).toEqual(['CANCELLED', 'PAID'])
  })
})

describe('care-team assignment', () => {
  test('Expert 2 review and return record the acting Expert 2', () => {
    for (const action of ['EXPERT2_REVIEW', 'EXPERT2_RETURN']) {
      const t = resolveTransition(CASE_MACHINE, 'WAITING_FOR_EXPERT_2', action, 'EXPERT_2')!
      const d = t.dataEffects!({ entity: { id: 'c', status: 'WAITING_FOR_EXPERT_2' }, actor: { id: 'e2', role: 'EXPERT_2' }, payload: { reason: 'r' }, transition: t, machine: CASE_MACHINE, now: new Date() })
      expect(d.assignedExpert2Id).toBe('e2')
    }
  })
})
