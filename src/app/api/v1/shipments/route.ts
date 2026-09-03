import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { getAuth } from '@/lib/auth'
import { executeTransition } from '@/lib/workflow'

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

// PATCH /api/v1/shipments — staff registers/updates delivery info
// {shipmentId, method, driverName, driverPhone, trackingCode, cost, status, receiverPhone, vehicleType}
// Phase 02: status changes run through the SHIPMENT machine (guarded + audited);
// DELIVER cascades ORDER → DELIVERED and CASE → DELIVERED (via CASE machine).
export async function PATCH(req: NextRequest) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  if (!['OPERATOR', 'EXPERT_2', 'ADMIN'].includes(auth.user.role)) return fail('دسترسی غیرمجاز', 403)
  const body = await req.json().catch(() => ({}))
  const shipmentId = String(body.shipmentId || '')
  const shipment = await db.shipment.findUnique({ where: { id: shipmentId }, include: { order: true } })
  if (!shipment) return fail('ارسال یافت نشد', 404)

  const actor = { id: auth.user.id, role: auth.user.role as never }
  const STATUS_ACTION: Record<string, string> = {
    SHIPPED: 'SHIP', DELIVERED: 'DELIVER', IN_TRANSIT: 'IN_TRANSIT', FAILED: 'FAIL',
  }

  // non-status info fields first (direct update — not a transition)
  const info: Record<string, unknown> = {}
  for (const k of ['driverName', 'driverPhone', 'trackingCode', 'receiverPhone', 'vehicleType', 'note']) {
    if (body[k] !== undefined) info[k] = body[k] || null
  }
  if (body.method && ['MOTORCYCLE', 'CAR', 'POST'].includes(body.method)) info.method = body.method
  if (body.cost !== undefined) info.cost = Number(body.cost) || 0
  if (Object.keys(info).length > 0) {
    await db.shipment.update({ where: { id: shipmentId }, data: info })
  }

  // status transition via machine (payload carries full field set for dataEffects)
  const action = STATUS_ACTION[String(body.status || '')]
  if (action) {
    const reason = String(body.reason || body.note || '')
    const res = await executeTransition({
      machine: 'SHIPMENT', entityId: shipmentId, action, actor,
      payload: { ...body, reason }, req,
    })
    if (!res.ok) return fail(res.error, res.httpStatus, res.details)

    // CASE sync for prescription orders — driven by the CASE machine (single writer)
    if (action === 'DELIVER' && shipment.order.type === 'PRESCRIPTION') {
      const invoice = await db.invoice.findFirst({ where: { orderId: shipment.orderId } })
      if (invoice?.caseId) {
        const c = await db.medicalCase.findUnique({ where: { id: invoice.caseId } })
        if (c && ['SHIPPED', 'PREPARING_SHIPMENT', 'PAYMENT_CONFIRMED'].includes(c.status)) {
          await executeTransition({
            machine: 'CASE', entityId: c.id, action: 'MARK_DELIVERED', actor,
            payload: { comment: `تحویل مرسوله ${shipment.trackingCode || shipment.id}` }, req,
          })
        }
      }
    }
  }
  return ok()
}
