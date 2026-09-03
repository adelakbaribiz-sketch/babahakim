import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { getAuth } from '@/lib/auth'
import { executeTransition } from '@/lib/workflow'

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
// Phase 02: all status changes run through the ORDER machine (guarded + audited;
// CANCEL requires a reason — BR-FIN validation).
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  const { id } = await ctx.params
  const body = await req.json().catch(() => ({}))
  const order = await db.order.findUnique({ where: { id } })
  if (!order) return fail('سفارش یافت نشد', 404)

  const ACTION_MAP: Record<string, string> = {
    CONFIRM: 'CONFIRM', CANCEL: 'CANCEL', PREPARING: 'PREPARE', READY: 'READY', REFUND: 'REFUND',
  }
  const action = ACTION_MAP[String(body.action || '')]
  if (!action) return fail('اقدام نامعتبر است')

  const res = await executeTransition({
    machine: 'ORDER', entityId: id, action,
    actor: { id: auth.user.id, role: auth.user.role as never },
    payload: { reason: String(body.reason || '') }, req,
  })
  if (!res.ok) return fail(res.error, res.httpStatus, res.details)
  return ok()
}
