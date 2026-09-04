// ── BabaHakim Backend · Application Service: Tickets / Shipments /
//    Follow-ups / Notifications (PHASE 08) ─────────────────────────────────
// Small sibling domains grouped in one module (same bounded context family).
import { db } from '@/lib/db'
import type { AuthContext } from '@/lib/auth'
import { executeTransition } from '@/lib/workflow'
import { genCode } from '@/server/core/ids'
import { ForbiddenError, NotFoundError, ValidationError } from '@/server/core/errors'
import { toAuditReq } from '@/server/infrastructure/audit'
import { publish, Events } from '@/server/infrastructure/events'
import { listMeta } from '@/server/api/envelope'
import type { ListQuery } from '@/server/api/query'
import type { RequestContext } from '@/server/core/context'
import { notify } from '@/lib/notify'
import type { z } from 'zod'
import type {
  ticketCreateSchema, ticketMessageSchema, ticketPatchSchema,
  shippingSchema, followupPatchSchema, markReadSchema,
} from '@/server/application/dto'

// ════════════════════════════ TICKETS ══════════════════════════════════════

export async function listTickets(auth: AuthContext, query: ListQuery) {
  const where = auth.user.role === 'PATIENT' ? { userId: auth.user.id } : {}
  const [tickets, total] = await Promise.all([
    db.ticket.findMany({
      where, orderBy: { [query.sort]: query.order }, skip: query.offset, take: query.limit,
      include: {
        user: { select: { firstName: true, lastName: true, phone: true } },
        messages: { orderBy: { createdAt: 'asc' }, include: { sender: { select: { firstName: true, lastName: true, role: true } } } },
      },
    }),
    db.ticket.count({ where }),
  ])
  return { tickets, ...listMeta(query.page, query.limit, total) }
}

export async function createTicket(
  auth: AuthContext, ctx: RequestContext, input: z.infer<typeof ticketCreateSchema>,
) {
  if (auth.user.role !== 'PATIENT') throw new ForbiddenError('تیکت توسط کاربر ایجاد می‌شود')
  const t = await db.ticket.create({
    data: {
      code: genCode('TKT'), userId: auth.user.id, subject: input.subject,
      category: input.category, priority: input.priority,
      caseId: input.caseId || null, status: 'OPEN',
      messages: { create: { senderId: auth.user.id, message: input.message } },
    },
  })
  await publish(Events.TicketCreated, { code: t.code }, ctx.reqId)
  return { ticket: { id: t.id, code: t.code } }
}

export async function addTicketMessage(
  auth: AuthContext, ctx: RequestContext, id: string, input: z.infer<typeof ticketMessageSchema>,
) {
  const t = await db.ticket.findUnique({ where: { id } })
  if (!t) throw new NotFoundError('تیکت یافت نشد')
  if (auth.user.role === 'PATIENT' && t.userId !== auth.user.id) throw new ForbiddenError('دسترسی غیرمجاز')
  const isInternal = auth.user.role !== 'PATIENT' && input.isInternal

  await db.ticketMessage.create({ data: { ticketId: id, senderId: auth.user.id, message: input.message, isInternal } })

  const action = auth.user.role === 'PATIENT' ? 'PATIENT_REPLY' : 'STAFF_REPLY'
  await executeTransition({
    machine: 'TICKET', entityId: id, action,
    actor: { id: auth.user.id, role: auth.user.role as never },
    payload: {}, req: toAuditReq(ctx),
  }).catch(() => null) // message-only replies intentionally keep status (Phase 02 semantics)
  await db.ticket.update({ where: { id }, data: { updatedAt: new Date() } })

  if (!isInternal) await publish(Events.TicketReplied, { userId: t.userId, code: t.code }, ctx.reqId)
  return { ok: true }
}

export async function patchTicket(
  auth: AuthContext, ctx: RequestContext, id: string, input: z.infer<typeof ticketPatchSchema>,
) {
  if (auth.user.role === 'PATIENT') throw new ForbiddenError('دسترسی غیرمجاز')
  const t = await db.ticket.findUnique({ where: { id } })
  if (!t) throw new NotFoundError('تیکت یافت نشد')

  const STATUS_ACTION: Record<string, string> = {
    IN_PROGRESS: 'ASSIGN', WAITING_USER: 'WAIT_USER', WAITING_EXPERT: 'ESCALATE',
    RESOLVED: 'RESOLVE', CLOSED: 'CLOSE', REOPEN: 'REOPEN',
  }
  const actor = { id: auth.user.id, role: auth.user.role as never }
  const data: Record<string, unknown> = { updatedAt: new Date() }
  if (input.priority) data.priority = input.priority
  if (input.assignedToId) data.assignedToId = input.assignedToId
  await db.ticket.update({ where: { id }, data })

  const action = STATUS_ACTION[input.status || '']
  if (action) {
    const res = await executeTransition({
      machine: 'TICKET', entityId: id, action, actor,
      payload: { assignedToId: input.assignedToId || undefined }, req: toAuditReq(ctx),
    })
    if (!res.ok && res.code !== 'INVALID_TRANSITION') {
      throw new ValidationError(res.error)
    }
    // same-status PATCH / no-op stays permissive for UI toggles (Phase 02 semantics)
    if (!res.ok && res.code === 'INVALID_TRANSITION' && t.status !== input.status) {
      throw new ValidationError(res.error)
    }
  }
  return { ok: true }
}

// ════════════════════════════ SHIPMENTS ════════════════════════════════════

export async function listShipments(auth: AuthContext, query: ListQuery) {
  const shipments = await db.shipment.findMany({
    orderBy: { [query.sort]: query.order }, take: query.limit,
    include: { order: { include: { user: { select: { firstName: true, lastName: true, phone: true } }, items: true } } },
  })
  const visible = auth.user.role === 'PATIENT' ? shipments.filter((s) => s.order.userId === auth.user.id) : shipments
  return { shipments: visible }
}

export async function patchShipment(
  auth: AuthContext, ctx: RequestContext, input: z.infer<typeof shippingSchema>,
) {
  if (!['OPERATOR', 'EXPERT_2', 'ADMIN'].includes(auth.user.role)) throw new ForbiddenError('دسترسی غیرمجاز')
  if (!input.shipmentId) throw new ValidationError('شناسه ارسال الزامی است')
  const shipment = await db.shipment.findUnique({ where: { id: input.shipmentId }, include: { order: true } })
  if (!shipment) throw new NotFoundError('ارسال یافت نشد')

  const actor = { id: auth.user.id, role: auth.user.role as never }
  const STATUS_ACTION: Record<string, string> = {
    SHIPPED: 'SHIP', DELIVERED: 'DELIVER', IN_TRANSIT: 'IN_TRANSIT', FAILED: 'FAIL',
  }

  const info: Record<string, unknown> = {}
  for (const k of ['driverName', 'driverPhone', 'trackingCode', 'receiverPhone', 'vehicleType', 'note'] as const) {
    if (input[k] !== undefined) info[k] = input[k] || null
  }
  if (input.method) info.method = input.method
  if (input.cost !== undefined) info.cost = input.cost
  if (Object.keys(info).length > 0) {
    await db.shipment.update({ where: { id: input.shipmentId }, data: info })
  }

  const action = STATUS_ACTION[input.status || '']
  if (action) {
    const reason = input.reason || input.note || ''
    const res = await executeTransition({
      machine: 'SHIPMENT', entityId: input.shipmentId, action, actor,
      payload: { ...input, reason }, req: toAuditReq(ctx),
    })
    if (!res.ok) throw new ValidationError(res.error)

    // CASE sync for prescription orders — single writer via CASE machine
    if (action === 'DELIVER' && shipment.order.type === 'PRESCRIPTION') {
      const invoice = await db.invoice.findFirst({ where: { orderId: shipment.orderId } })
      if (invoice?.caseId) {
        const c = await db.medicalCase.findUnique({ where: { id: invoice.caseId } })
        if (c && ['SHIPPED', 'PREPARING_SHIPMENT', 'PAYMENT_CONFIRMED'].includes(c.status)) {
          await executeTransition({
            machine: 'CASE', entityId: c.id, action: 'MARK_DELIVERED', actor,
            payload: { comment: `تحویل مرسوله ${shipment.trackingCode || shipment.id}` }, req: toAuditReq(ctx),
          })
        }
      }
    }
  }
  return { ok: true }
}

// ════════════════════════════ FOLLOW-UPS ═══════════════════════════════════

export async function listFollowups(auth: AuthContext) {
  const where = auth.user.role === 'PATIENT' ? { patientId: auth.user.id } : {}
  const items = await db.followUp.findMany({
    where, orderBy: { dueDate: 'asc' }, take: 200,
    include: {
      case: { select: { code: true, status: true } },
      patient: { select: { firstName: true, lastName: true, phone: true } },
      completedBy: { select: { firstName: true, lastName: true } },
    },
  })
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const tomorrow = new Date(today.getTime() + 864e5)
  const enriched = items.map((f) => ({
    ...f,
    bucket: f.status === 'COMPLETED' ? 'COMPLETED' : f.dueDate < today ? 'OVERDUE' : f.dueDate < tomorrow ? 'DUE_TODAY' : 'UPCOMING',
  }))
  return {
    followups: enriched,
    counts: {
      dueToday: enriched.filter((f) => f.bucket === 'DUE_TODAY').length,
      overdue: enriched.filter((f) => f.bucket === 'OVERDUE').length,
      upcoming: enriched.filter((f) => f.bucket === 'UPCOMING').length,
      completed: enriched.filter((f) => f.bucket === 'COMPLETED').length,
    },
  }
}

export async function patchFollowup(
  auth: AuthContext, ctx: RequestContext, input: z.infer<typeof followupPatchSchema>,
) {
  const f = await db.followUp.findUnique({ where: { id: input.id } })
  if (!f) throw new NotFoundError('پیگیری یافت نشد')

  const actor = { id: auth.user.id, role: auth.user.role as never }
  const STATUS_ACTION: Record<string, string> = {
    COMPLETED: 'COMPLETE', CANCELLED: 'CANCEL', DUE: 'MARK_DUE', OVERDUE: 'MARK_OVERDUE',
  }

  const info: Record<string, unknown> = {}
  if (input.note !== undefined) info.note = input.note
  if (input.resultNote !== undefined && !input.status) info.resultNote = input.resultNote
  if (Object.keys(info).length > 0) {
    await db.followUp.update({ where: { id: f.id }, data: info })
  }

  const action = STATUS_ACTION[input.status || '']
  if (action) {
    const res = await executeTransition({
      machine: 'FOLLOWUP', entityId: f.id, action, actor,
      payload: { note: input.note ?? input.resultNote ?? '', reason: input.reason }, req: toAuditReq(ctx),
    })
    if (!res.ok) throw new ValidationError(res.error)
  }
  return { ok: true }
}

// ════════════════════════════ NOTIFICATIONS ════════════════════════════════

export async function listNotifications(auth: AuthContext, query: ListQuery) {
  const items = await db.notification.findMany({
    where: { userId: auth.user.id }, orderBy: { createdAt: 'desc' }, take: Math.max(50, query.limit),
  })
  return { notifications: items, unread: items.filter((n) => !n.read).length }
}

export async function markNotificationsRead(
  auth: AuthContext, input: z.infer<typeof markReadSchema>,
) {
  if (input.id) {
    await db.notification.updateMany({ where: { id: input.id, userId: auth.user.id }, data: { read: true } })
  } else {
    await db.notification.updateMany({ where: { userId: auth.user.id, read: false }, data: { read: true } })
  }
  return { ok: true }
}

// exported for bootstrap reuse (operator fan-out lives with ticket/order events)
export { notify }
