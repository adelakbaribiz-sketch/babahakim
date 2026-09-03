import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, genCode } from '@/lib/api'
import { getAuth } from '@/lib/auth'
import { notify } from '@/lib/notify'

// GET /api/v1/tickets
export async function GET(req: NextRequest) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  const where = auth.user.role === 'PATIENT' ? { userId: auth.user.id } : {}
  const tickets = await db.ticket.findMany({
    where, orderBy: { updatedAt: 'desc' }, take: 100,
    include: {
      user: { select: { firstName: true, lastName: true, phone: true } },
      messages: { orderBy: { createdAt: 'asc' }, include: { sender: { select: { firstName: true, lastName: true, role: true } } } },
    },
  })
  return ok({ tickets })
}

// POST /api/v1/tickets — patient creates ticket {subject, category, priority, message, caseId}
export async function POST(req: NextRequest) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  if (auth.user.role !== 'PATIENT') return fail('تیکت توسط کاربر ایجاد می‌شود', 403)
  const body = await req.json().catch(() => ({}))
  const subject = String(body.subject || '').trim()
  const message = String(body.message || '').trim()
  if (!subject || !message) return fail('موضوع و متن پیام الزامی است')
  const t = await db.ticket.create({
    data: {
      code: genCode('TKT'), userId: auth.user.id, subject,
      category: ['GENERAL', 'ORDER', 'PAYMENT', 'MEDICAL', 'SHIPPING', 'OTHER'].includes(body.category) ? body.category : 'GENERAL',
      priority: ['LOW', 'NORMAL', 'HIGH', 'URGENT'].includes(body.priority) ? body.priority : 'NORMAL',
      caseId: body.caseId || null, status: 'OPEN',
      messages: { create: { senderId: auth.user.id, message } },
    },
  })
  const operators = await db.user.findMany({ where: { role: 'OPERATOR', isActive: true }, select: { id: true } })
  for (const op of operators) await notify(op.id, 'TICKET_UPDATED', { extraFa: t.code })
  return ok({ ticket: { id: t.id, code: t.code } })
}
