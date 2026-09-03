import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, audit } from '@/lib/api'
import { getAuth } from '@/lib/auth'
import { notify } from '@/lib/notify'

// GET /api/v1/shipments — staff: all; patient: own (via orders)
export async function GET(req: NextRequest) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  const shipments = await db.shipment.findMany({
    orderBy: { createdAt: 'desc' }, take: 100,
    include: { order: { include: { user: { select: { firstName: true, lastName: true, phone: true } }, items: true } } },
  })
  const visible = auth.user.role === 'PATIENT' ? shipments.filter((s) => s.order.userId === auth.user.id) : shipments
  return ok({ shipments: visible })
}

// PATCH /api/v1/shipments — staff registers/updates delivery info {shipmentId, method, driverName, driverPhone, trackingCode, cost, status, receiverPhone, vehicleType}
export async function PATCH(req: NextRequest) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  if (!['OPERATOR', 'EXPERT_2', 'ADMIN'].includes(auth.user.role)) return fail('دسترسی غیرمجاز', 403)
  const body = await req.json().catch(() => ({}))
  const shipmentId = String(body.shipmentId || '')
  const shipment = await db.shipment.findUnique({ where: { id: shipmentId }, include: { order: true } })
  if (!shipment) return fail('ارسال یافت نشد', 404)

  const data: Record<string, unknown> = {}
  for (const k of ['driverName', 'driverPhone', 'trackingCode', 'receiverPhone', 'vehicleType', 'note']) {
    if (body[k] !== undefined) data[k] = body[k] || null
  }
  if (body.method && ['MOTORCYCLE', 'CAR', 'POST'].includes(body.method)) data.method = body.method
  if (body.cost !== undefined) data.cost = Number(body.cost) || 0
  if (body.status && ['PREPARING', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'FAILED'].includes(body.status)) {
    data.status = body.status
    if (body.status === 'SHIPPED' && !shipment.shippingDate) data.shippingDate = new Date()
    if (body.status === 'DELIVERED') {
      data.deliveryDate = new Date()
      await db.order.update({ where: { id: shipment.orderId }, data: { status: 'DELIVERED' } })
      await notify(shipment.order.userId, 'ORDER_DELIVERED', { link: '/orders', sms: true })
      // sync case
      const invoice = await db.invoice.findFirst({ where: { orderId: shipment.orderId } })
      if (invoice?.caseId) {
        const c = await db.medicalCase.findUnique({ where: { id: invoice.caseId } })
        if (c && ['SHIPPED', 'PREPARING_SHIPMENT'].includes(c.status)) {
          await db.medicalCase.update({ where: { id: c.id }, data: { status: 'DELIVERED' } })
          await db.caseEvent.create({ data: { caseId: c.id, actorId: auth.user.id, action: 'STATUS_CHANGE', fromStatus: c.status, toStatus: 'DELIVERED', comment: 'تحویل ثبت شد' } })
        }
      }
    }
    if (body.status === 'SHIPPED') {
      await db.order.update({ where: { id: shipment.orderId }, data: { status: 'SHIPPED' } })
      await notify(shipment.order.userId, 'ORDER_SHIPPED', { link: '/orders', sms: true })
    }
  }
  await db.shipment.update({ where: { id: shipmentId }, data })
  await audit(req, auth.user.id, 'EDIT_SHIPMENT', 'Shipment', shipmentId, { status: shipment.status }, data)
  return ok()
}
