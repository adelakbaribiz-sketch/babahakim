/**
 * PHASE 12: Sub-Transition Engine — Unit Tests (fake tx, DB-free writes)
 * Coverage: machine-guarded cascades inside a caller's transaction — happy
 * path (status + dataEffects + audit + CaseEvent + WorkflowState projection),
 * idempotent no-op on INVALID_TRANSITION / NOT_FOUND, guard rejections,
 * and the WorkflowState upsert semantics (create-then-update resets SLA).
 */
import { describe, test, expect } from 'bun:test'
import { applySubTransition, cascadeSubTransition, syncWorkflowStateTx } from '@/lib/workflow/subtransition'
import { MEDICAL_IMAGE_MACHINE, INVOICE_MACHINE, ORDER_MACHINE } from '@/lib/workflow'
import type { TxClient } from '@/lib/workflow'

/* ── fake transaction client ──────────────────────────────────────────── */

interface Recorded {
  updates: Array<{ delegate: string; where: { id: string }; data: Record<string, unknown> }>
  audits: Array<{ data: Record<string, unknown> }>
  events: Array<{ data: Record<string, unknown> }>
  upserts: Array<{ where: Record<string, unknown>; create: Record<string, unknown>; update: Record<string, unknown> }>
}

function makeTx(rows: Record<string, Array<Record<string, unknown>>>, rec: Recorded): TxClient {
  const findUnique = (delegate: string) => async ({ where }: { where: { id: string } }) => {
    const list = rows[delegate] ?? []
    return list.find((r) => r.id === where.id) ?? null
  }
  const update = (delegate: string) => async (a: { where: { id: string }; data: Record<string, unknown> }) => {
    rec.updates.push({ delegate: 'any', where: a.where, data: a.data })
    const list = rows[delegate] ?? []
    const i = list.findIndex((r) => r.id === a.where.id)
    const next = { ...(list[i] ?? { id: a.where.id }), ...a.data }
    if (i >= 0) list[i] = next
    return next
  }
  const create = (delegate: string) => async (a: { data: Record<string, unknown> }) => {
    const list = (rows[delegate] ??= [])
    const row = { id: `gen-${delegate}-${list.length + 1}`, ...a.data }
    list.push(row)
    return row
  }
  const delegates: Record<string, unknown> = {}
  for (const key of Object.keys(rows)) {
    delegates[key] = {
      findUnique: findUnique(key), update: update(key), create: create(key),
      findMany: async () => rows[key] ?? [],
    }
  }
  return {
    ...delegates,
    auditLog: { create: async (a: { data: Record<string, unknown> }) => { rec.audits.push(a); return {} } },
    caseEvent: { create: async (a: { data: Record<string, unknown> }) => { rec.events.push(a); return {} } },
    workflowState: {
      upsert: async (a: { where: Record<string, unknown>; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        rec.upserts.push(a)
        return {}
      },
    },
  } as unknown as TxClient
}

/* ── applySubTransition ───────────────────────────────────────────────── */

describe('applySubTransition (machine-guarded cascade)', () => {
  test('happy path: image VALIDATE writes status + fields + audit + WorkflowState', async () => {
    const rec: Recorded = { updates: [], audits: [], events: [], upserts: [] }
    const tx = makeTx({
      medicalImage: [{ id: 'img1', status: 'PENDING', ownerId: 'u1', deletedAt: null }],
    }, rec)

    const res = await applySubTransition({
      tx, machine: MEDICAL_IMAGE_MACHINE, entityId: 'img1', action: 'VALIDATE',
      payload: { originalPath: '/data/o.jpg', width: 1024, height: 768, sizeOriginal: 5000, quality: { score: 0.9 } },
    })

    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.transition.from).toBe('PENDING')
      expect(res.transition.to).toBe('VALIDATED')
      expect(res.entity.status).toBe('VALIDATED')
    }
    // dataEffects mapped the payload onto the row update
    const upd = rec.updates.find((u) => u.data.status === 'VALIDATED')
    expect(upd).toBeDefined()
    expect(upd!.data.originalPath).toBe('/data/o.jpg')
    expect(upd!.data.width).toBe(1024)
    expect(upd!.data.quality).toBe(JSON.stringify({ score: 0.9 }))
    // SYSTEM-attributed audit row with the cascade marker
    expect(rec.audits.length).toBe(1)
    expect(rec.audits[0].data.action).toBe('WORKFLOW_MEDICAL_IMAGE_VALIDATE')
    expect(rec.audits[0].data.userId).toBeNull()
    expect(String(rec.audits[0].data.newValues)).toContain('CASCADE')
    // WorkflowState projection upserted with the machine entity + new status
    expect(rec.upserts.length).toBe(1)
    expect(rec.upserts[0].where.entityType_entityId?.entityType).toBe('MEDICAL_IMAGE')
    expect(rec.upserts[0].create.status).toBe('VALIDATED')
    expect(rec.upserts[0].update.reminderCount).toBe(0) // SLA counters reset
  })

  test('guards apply: non-system actor cannot fire a system-only cascade', async () => {
    const rec: Recorded = { updates: [], audits: [], events: [], upserts: [] }
    const tx = makeTx({ medicalImage: [{ id: 'img1', status: 'PENDING', ownerId: 'u1', deletedAt: null }] }, rec)
    const res = await applySubTransition({
      tx, machine: MEDICAL_IMAGE_MACHINE, entityId: 'img1', action: 'VALIDATE',
      actor: { id: 'u1', role: 'PATIENT' },
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('INVALID_TRANSITION')
    expect(rec.updates.length).toBe(0) // nothing written
  })

  test('validate hooks run: REJECT without reason is refused (422)', async () => {
    const rec: Recorded = { updates: [], audits: [], events: [], upserts: [] }
    const tx = makeTx({ medicalImage: [{ id: 'img1', status: 'PENDING', ownerId: 'u1', deletedAt: null }] }, rec)
    const res = await applySubTransition({ tx, machine: MEDICAL_IMAGE_MACHINE, entityId: 'img1', action: 'REJECT' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('VALIDATION')
    expect(rec.updates.length).toBe(0)
  })

  test('idempotency: cascadeSubTransition → null on INVALID_TRANSITION (already moved)', async () => {
    const rec: Recorded = { updates: [], audits: [], events: [], upserts: [] }
    const tx = makeTx({
      invoice: [{ id: 'inv1', status: 'PAID', deletedAt: null }], // already paid
    }, rec)
    const res = await cascadeSubTransition({ tx, machine: INVOICE_MACHINE, entityId: 'inv1', action: 'MARK_PAID' })
    expect(res).toBeNull() // benign no-op — replayed verify (BR-FIN-01)
    expect(rec.updates.length).toBe(0)
  })

  test('idempotency: cascadeSubTransition → null on NOT_FOUND', async () => {
    const rec: Recorded = { updates: [], audits: [], events: [], upserts: [] }
    const tx = makeTx({ invoice: [] }, rec)
    const res = await cascadeSubTransition({ tx, machine: INVOICE_MACHINE, entityId: 'gone', action: 'MARK_PAID' })
    expect(res).toBeNull()
  })

  test('soft-deleted rows are invisible (NOT_FOUND)', async () => {
    const rec: Recorded = { updates: [], audits: [], events: [], upserts: [] }
    const tx = makeTx({ invoice: [{ id: 'inv1', status: 'SENT', deletedAt: new Date() }] }, rec)
    const res = await applySubTransition({ tx, machine: INVOICE_MACHINE, entityId: 'inv1', action: 'MARK_PAID' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('NOT_FOUND')
  })

  test('ORDER MARK_PAID chains its txEffects (invoice + financial cascade) in the same tx', async () => {
    const rec: Recorded = { updates: [], audits: [], events: [], upserts: [] }
    const rows: Record<string, Array<Record<string, unknown>>> = {
      order: [{ id: 'ord1', status: 'CONFIRMED', userId: 'u1', total: 100, code: 'ORD-1', deletedAt: null }],
      invoice: [{ id: 'inv1', orderId: 'ord1', status: 'SENT', deletedAt: null }],
      financialTransaction: [],
    }
    const tx = makeTx(rows, rec)
    const res = await applySubTransition({
      tx, machine: ORDER_MACHINE, entityId: 'ord1', action: 'MARK_PAID',
      payload: { paymentCode: 'PAY-9', paymentAmount: 100, paymentSource: 'تأیید کارت‌به‌کارت' },
    })
    expect(res.ok).toBe(true)
    // order updated to PAID
    expect(rows.order[0].status).toBe('PAID')
    // invoice moved to PAID via the chained cascade (machine-guarded)
    expect(rows.invoice[0].status).toBe('PAID')
    expect(rows.invoice[0].paidAt).toBeDefined()
    // financial journal row appended
    expect(rows.financialTransaction.length).toBe(1)
    expect(rows.financialTransaction[0].amount).toBe(100)
    expect(rows.financialTransaction[0].type).toBe('INCOME')
    // both machines projected into WorkflowState
    const projected = rec.upserts.map((u) => u.create.entityType)
    expect(projected).toContain('ORDER')
    expect(projected).toContain('INVOICE')
  })
})

/* ── syncWorkflowStateTx ──────────────────────────────────────────────── */

describe('syncWorkflowStateTx (SLA projection)', () => {
  test('upsert create on first transition, update resets counters afterwards', async () => {
    const calls: Array<{ where: Record<string, unknown>; create: Record<string, unknown>; update: Record<string, unknown> }> = []
    const tx = { workflowState: { upsert: async (a: typeof calls[number]) => { calls.push(a); return {} } } } as unknown as TxClient

    await syncWorkflowStateTx(tx, INVOICE_MACHINE, 'inv1', 'SENT')
    await syncWorkflowStateTx(tx, INVOICE_MACHINE, 'inv1', 'PAID')

    expect(calls.length).toBe(2)
    expect(calls[0].where.entityType_entityId).toEqual({ entityType: 'INVOICE', entityId: 'inv1' })
    expect(calls[0].create.status).toBe('SENT')
    // entering the new status resets the SLA ladder
    expect(calls[1].update.status).toBe('PAID')
    expect(calls[1].update.reminderCount).toBe(0)
    expect(calls[1].update.escalatedAt).toBeNull()
    expect(calls[1].update.lastRemindedAt).toBeNull()
  })
})
