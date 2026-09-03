import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, audit } from '@/lib/api'
import { getAuth } from '@/lib/auth'
import { notify } from '@/lib/notify'

// POST /api/v1/tickets/[id] — add message {message, isInternal}
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
  const status = auth.user.role === 'PATIENT' ? 'WAITING_EXPERT' : t.status === 'OPEN' ? 'IN_PROGRESS' : t.status
  await db.ticket.update({ where: { id }, data: { status, updatedAt: new Date() } })
  if (!isInternal) {
    await notify(t.userId, 'TICKET_UPDATED', { extraFa: t.code })
  }
  return ok()
}

// PATCH /api/v1/tickets/[id] — staff: assign/status
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  if (auth.user.role === 'PATIENT') return fail('دسترسی غیرمجاز', 403)
  const { id } = await ctx.params
  const body = await req.json().catch(() => ({}))
  const t = await db.ticket.findUnique({ where: { id } })
  if (!t) return fail('تیکت یافت نشد', 404)
  const data: Record<string, unknown> = { updatedAt: new Date() }
  if (body.status && ['OPEN', 'IN_PROGRESS', 'WAITING_USER', 'WAITING_EXPERT', 'RESOLVED', 'CLOSED'].includes(body.status)) data.status = body.status
  if (body.assignedToId) data.assignedToId = body.assignedToId
  if (body.priority && ['LOW', 'NORMAL', 'HIGH', 'URGENT'].includes(body.priority)) data.priority = body.priority
  await db.ticket.update({ where: { id }, data })
  if (data.status === 'RESOLVED' || data.status === 'CLOSED') await notify(t.userId, 'TICKET_UPDATED', { extraFa: t.code })
  await audit(req, auth.user.id, 'TICKET_UPDATE', 'Ticket', id, { status: t.status }, data)
  return ok()
}
