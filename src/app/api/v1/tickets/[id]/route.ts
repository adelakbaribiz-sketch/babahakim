import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { getAuth } from '@/lib/auth'
import { notify } from '@/lib/notify'
import { executeTransition } from '@/lib/workflow'

// POST /api/v1/tickets/[id] — add message {message, isInternal}
// Phase 02: ticket status changes run through the TICKET machine (guarded + audited).
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  const { id } = await ctx.params
  const body = await req.json().catch(() => ({}))
  const message = String(body.message || '').trim()
  if (!message) return fail('متن پیام الزامی است')
  const t = await db.ticket.findUnique({ where: { id } })
  if (!t) return fail('تیکت یافت نشد', 404)
  if (auth.user.role === 'PATIENT' && t.userId !== auth.user.id) return fail('دسترسی غیرمجاز', 403)
  const isInternal = auth.user.role !== 'PATIENT' && Boolean(body.isInternal)

  await db.ticketMessage.create({ data: { ticketId: id, senderId: auth.user.id, message, isInternal } })

  // status transition via machine (message-only replies on non-OPEN staff tickets
  // intentionally keep their current status — engine returns 409 which we ignore)
  const action = auth.user.role === 'PATIENT' ? 'PATIENT_REPLY' : 'STAFF_REPLY'
  await executeTransition({
    machine: 'TICKET', entityId: id, action,
    actor: { id: auth.user.id, role: auth.user.role as never },
    payload: {}, req,
  }).catch(() => null)
  await db.ticket.update({ where: { id }, data: { updatedAt: new Date() } })

  if (!isInternal) {
    await notify(t.userId, 'TICKET_UPDATED', { extraFa: t.code })
  }
  return ok()
}

// PATCH /api/v1/tickets/[id] — staff: assign / status / priority
// Status values map to machine actions: IN_PROGRESS→ASSIGN, WAITING_USER→WAIT_USER,
// WAITING_EXPERT→ESCALATE, RESOLVED→RESOLVE, CLOSED→CLOSE.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  if (auth.user.role === 'PATIENT') return fail('دسترسی غیرمجاز', 403)
  const { id } = await ctx.params
  const body = await req.json().catch(() => ({}))
  const t = await db.ticket.findUnique({ where: { id } })
  if (!t) return fail('تیکت یافت نشد', 404)

  const STATUS_ACTION: Record<string, string> = {
    IN_PROGRESS: 'ASSIGN', WAITING_USER: 'WAIT_USER', WAITING_EXPERT: 'ESCALATE',
    RESOLVED: 'RESOLVE', CLOSED: 'CLOSE', REOPEN: 'REOPEN',
  }

  const actor = { id: auth.user.id, role: auth.user.role as never }
  const data: Record<string, unknown> = { updatedAt: new Date() }
  if (body.priority && ['LOW', 'NORMAL', 'HIGH', 'URGENT'].includes(body.priority)) data.priority = body.priority
  if (body.assignedToId) data.assignedToId = body.assignedToId

  // non-status field updates (priority/assignment) go directly
  await db.ticket.update({ where: { id }, data })

  // status change goes through the machine (guard + audit + notify on resolve/close)
  const action = STATUS_ACTION[String(body.status || '')]
  if (action) {
    const res = await executeTransition({
      machine: 'TICKET', entityId: id, action, actor,
      payload: { assignedToId: body.assignedToId ? String(body.assignedToId) : undefined }, req,
    })
    if (!res.ok && res.code !== 'INVALID_TRANSITION') {
      return fail(res.error, res.httpStatus, res.details)
    }
    if (!res.ok && res.code === 'INVALID_TRANSITION') {
      // same-status PATCH or no-op — keep API permissive for UI toggles
      if (t.status !== body.status) {
        return fail(res.error, res.httpStatus, res.details)
      }
    }
  }
  return ok()
}
