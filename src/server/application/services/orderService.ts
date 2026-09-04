// ── BabaHakim Backend · Application Service: Orders (PHASE 08) ────────────
// CRITICAL FIX (audit A2): checkout was previously NON-transactional —
// order + invoice + stock decrement + cart clear could partially succeed.
// Now: one atomic unit with stock guards (ED-103/104) + domain events.
import { db } from '@/lib/db'
import type { AuthContext } from '@/lib/auth'
import { signImageUrl } from '@/lib/auth'
import { parseJSON } from '@/lib/api'
import { executeTransition } from '@/lib/workflow'
import { genCode } from '@/server/core/ids'
import type { RequestContext } from '@/server/core/context'
import { ForbiddenError, NotFoundError, ValidationError } from '@/server/core/errors'
import { writeAudit, toAuditReq } from '@/server/infrastructure/audit'
import { withTransaction } from '@/server/infrastructure/uow'
import { publish, Events } from '@/server/infrastructure/events'
import { listMeta } from '@/server/api/envelope'
import type { ListQuery } from '@/server/api/query'
import { SHOP_SHIPPING_COST, computeTotals, assertStockAvailable, assertCartHasItems } from '@/server/domain/policies'
import type { orderPatchSchema } from '@/server/application/dto'
import type { z } from 'zod'

// ── LIST (role-scoped, paginated — ED-100) ────────────────────────────────
export async function listOrders(auth: AuthContext, query: ListQuery, status: string, type: string) {
  const where: Record<string, unknown> = {}
  if (auth.user.role === 'PATIENT') where.userId = auth.user.id
  if (status) where.status = status
  if (type) where.type = type

  const [orders, total] = await Promise.all([
    db.order.findMany({
      where,
      orderBy: { [query.sort]: query.order },
      skip: query.offset, take: query.limit,
      include: {
        items: true,
        user: { select: { firstName: true, lastName: true, phone: true } },
        payments: true,
        invoices: { take: 1 },
        shipment: true,
      },
    }),
    db.order.count({ where }),
  ])

  return {
    orders: orders.map((o) => ({ ...o, invoice: o.invoices?.[0] || null, addressSnapshot: parseJSON(o.addressSnapshot, null) })),
    ...listMeta(query.page, query.limit, total),
  }
}

// ── CHECKOUT (atomic, stock-guarded — was the audit's A2 CRITICAL bug) ────
export async function checkout(auth: AuthContext, ctx: RequestContext) {
  if (auth.user.role !== 'PATIENT') {
    throw new ForbiddenError('فقط کاربران می‌توانند سفارش ثبت کنند')
  }
  const cart = await db.cartItem.findMany({ where: { userId: auth.user.id }, include: { product: true } })
  assertCartHasItems(cart.length)

  // domain policy: totals + stock availability (pure, unit-tested)
  assertStockAvailable(cart.map((i) => ({
    productId: i.product.id, unitPrice: i.product.currentPrice, quantity: i.quantity,
    stock: i.product.stock, nameFa: i.product.nameFa, nameEn: i.product.nameEn,
    requiresPrescription: i.product.requiresPrescription,
  })))
  const { subtotal, shippingCost, total } = computeTotals(cart.map((i) => ({ unitPrice: i.product.currentPrice, quantity: i.quantity })), SHOP_SHIPPING_COST)

  const profile = await db.patientProfile.findUnique({ where: { userId: auth.user.id } })
  const addressSnapshot = {
    province: profile?.province || '', city: profile?.city || '', postalCode: profile?.postalCode || '',
    addressLine: profile?.addressLine || '', phone: auth.user.phone,
  }
  const itemsData = cart.map((i) => ({
    productId: i.product.id, nameFa: i.product.nameFa, nameEn: i.product.nameEn,
    unitPrice: i.product.currentPrice, quantity: i.quantity, total: i.product.currentPrice * i.quantity,
    available: i.product.stock >= i.quantity,
  }))

  const result = await withTransaction(async (tx) => {
    // re-check stock INSIDE the transaction (guards races with concurrent buyers)
    const products = await tx.product.findMany({ where: { id: { in: itemsData.map((i) => i.productId) } } })
    assertStockAvailable(products.map((p) => {
      const line = itemsData.find((i) => i.productId === p.id)!
      return {
        productId: p.id, unitPrice: p.currentPrice, quantity: line.quantity, stock: p.stock,
        nameFa: p.nameFa, nameEn: p.nameEn, requiresPrescription: p.requiresPrescription,
      }
    }))

    const order = await tx.order.create({
      data: {
        code: genCode('ORD'), userId: auth.user.id, type: 'SHOP', status: 'PENDING_CONFIRMATION',
        subtotal, shippingCost, total,
        addressSnapshot: JSON.stringify(addressSnapshot),
        items: { create: itemsData },
      },
    })
    const invoice = await tx.invoice.create({
      data: {
        code: genCode('INV'), orderId: order.id, status: 'SENT',
        items: JSON.stringify(itemsData), subtotal, shippingCost, total,
        note: 'پیش‌فاکتور سفارش فروشگاهی',
      },
    })
    for (const i of itemsData) {
      await tx.product.update({ where: { id: i.productId }, data: { stock: { decrement: i.quantity } } })
    }
    await tx.cartItem.deleteMany({ where: { userId: auth.user.id } })
    return { order, invoice }
  })

  await publish(Events.OrderCreated, { orderId: result.order.id, code: result.order.code, userId: auth.user.id }, ctx.reqId)
  // stock levels are part of the catalog read model — invalidate after decrement (ED-98)
  await publish(Events.ProductCatalogChanged, { orderId: result.order.id, via: 'checkout' }, ctx.reqId)
  await writeAudit(ctx, {
    userId: auth.user.id, action: 'CREATE_ORDER', entity: 'Order', entityId: result.order.id,
    newValues: { code: result.order.code, total: result.order.total },
  })
  return { order: { id: result.order.id, code: result.order.code, total: result.order.total }, invoice: { code: result.invoice.code } }
}

// ── DETAIL ────────────────────────────────────────────────────────────────
export async function getOrder(auth: AuthContext, id: string) {
  const order = await db.order.findUnique({
    where: { id },
    include: {
      items: true, payments: true, invoices: { take: 1 }, shipment: true,
      user: { select: { firstName: true, lastName: true, phone: true, profile: true } },
      prescription: { include: { items: true } },
    },
  })
  if (!order) throw new NotFoundError('سفارش یافت نشد')
  if (auth.user.role === 'PATIENT' && order.userId !== auth.user.id) throw new ForbiddenError('دسترسی غیرمجاز')
  return { order: { ...order, invoice: order.invoices?.[0] || null } }
}

// ── PATCH: operator lifecycle actions via the ORDER machine ───────────────
export async function patchOrder(
  auth: AuthContext, ctx: RequestContext, id: string, input: z.infer<typeof orderPatchSchema>,
) {
  const order = await db.order.findUnique({ where: { id } })
  if (!order) throw new NotFoundError('سفارش یافت نشد')
  const ACTION_MAP: Record<string, string> = {
    CONFIRM: 'CONFIRM', CANCEL: 'CANCEL', PREPARING: 'PREPARE', READY: 'READY', REFUND: 'REFUND',
  }
  const action = ACTION_MAP[input.action]
  if (!action) throw new ValidationError('اقدام نامعتبر است')

  const res = await executeTransition({
    machine: 'ORDER', entityId: id, action,
    actor: { id: auth.user.id, role: auth.user.role as never },
    payload: { reason: input.reason }, req: toAuditReq(ctx),
  })
  if (!res.ok) throw new (await import('@/server/core/errors')).AppError(
    res.code === 'FORBIDDEN_PERMISSION' || res.code === 'FORBIDDEN_ROLE' ? 'FORBIDDEN'
      : res.code === 'NOT_FOUND' ? 'NOT_FOUND'
      : res.code === 'VALIDATION' ? 'BUSINESS_RULE' : 'CONFLICT',
    res.error, res.httpStatus, res.details,
  )
  return { ok: true, order: { id, status: res.entity.status } }
}

/** Payments list (kept here — order/payment are one aggregate stream). */
export async function listPayments(auth: AuthContext, query: ListQuery, status: string) {
  const where: Record<string, unknown> = {}
  if (auth.user.role === 'PATIENT') where.userId = auth.user.id
  if (status) where.status = status
  const [payments, total] = await Promise.all([
    db.payment.findMany({
      where,
      orderBy: { [query.sort]: query.order },
      skip: query.offset, take: query.limit,
      include: {
        order: { include: { items: true, user: { select: { firstName: true, lastName: true, phone: true } } } },
        invoice: true,
        verifiedBy: { select: { firstName: true, lastName: true } },
      },
    }),
    db.payment.count({ where }),
  ])
  return {
    payments: payments.map((p) => ({ ...p, receiptUrl: p.receiptImageId ? signImageUrl(p.receiptImageId, 600) : null })),
    ...listMeta(query.page, query.limit, total),
  }
}
