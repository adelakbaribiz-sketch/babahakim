import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, audit } from '@/lib/api'
import { getAuth } from '@/lib/auth'

// GET /api/v1/orders/[id]
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  const { id } = await ctx.params
  const order = await db.order.findUnique({
    where: { id },
    include: {
      items: true, payments: true, invoices: { take: 1 }, shipment: true,
      user: { select: { firstName: true, lastName: true, phone: true, profile: true } },
      prescription: { include: { items: true } },
    },
  })
  if (!order) return fail('سفارش یافت نشد', 404)
  if (auth.user.role === 'PATIENT' && order.userId !== auth.user.id) return fail('دسترسی غیرمجاز', 403)
  return ok({ order: { ...order, invoice: order.invoices?.[0] || null } })
}

// PATCH /api/v1/orders/[id] — operator: CONFIRM / CANCEL / PREPARING / READY
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  if (!['OPERATOR', 'EXPERT_2', 'ADMIN'].includes(auth.user.role)) return fail('دسترسی غیرمجاز', 403)
  const { id } = await ctx.params
  const body = await req.json().catch(() => ({}))
  const order = await db.order.findUnique({ where: { id } })
  if (!order) return fail('سفارش یافت نشد', 404)

  const actionMap: Record<string, string> = {
    CONFIRM: 'CONFIRMED', CANCEL: 'CANCELLED', PREPARING: 'PREPARING', READY: 'READY_TO_SHIP',
  }
  const newStatus = actionMap[String(body.action || '')]
  if (!newStatus) return fail('اقدام نامعتبر است')

  await db.order.update({ where: { id }, data: { status: newStatus, verifiedById: auth.user.id, cancelledReason: newStatus === 'CANCELLED' ? String(body.reason || '') : null } })
  if (newStatus === 'CONFIRMED') await db.invoice.updateMany({ where: { orderId: id }, data: { status: 'CONFIRMED', confirmedAt: new Date() } })
  await notify(order.userId, newStatus === 'CANCELLED' ? 'CASE_CLOSED' : 'ORDER_PREPARING', { link: '/orders' })
  await audit(req, auth.user.id, 'ORDER_STATUS', 'Order', id, { status: order.status }, { status: newStatus })
  return ok()
}
