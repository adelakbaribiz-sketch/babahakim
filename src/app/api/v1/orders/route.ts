import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, audit, genCode, parseJSON } from '@/lib/api'
import { getAuth } from '@/lib/auth'
import { notify } from '@/lib/notify'

// GET /api/v1/orders — role-scoped list (patient: own; staff: all)
export async function GET(req: NextRequest) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  const url = new URL(req.url)
  const status = url.searchParams.get('status') || ''
  const type = url.searchParams.get('type') || ''

  const where: Record<string, unknown> = {}
  if (auth.user.role === 'PATIENT') where.userId = auth.user.id
  if (status) where.status = status
  if (type) where.type = type

  const orders = await db.order.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      items: true,
      user: { select: { firstName: true, lastName: true, phone: true } },
      payments: true,
      invoices: { take: 1 },
      shipment: true,
    },
  })
  return ok({ orders: orders.map((o) => ({ ...o, invoice: o.invoices?.[0] || null, addressSnapshot: parseJSON(o.addressSnapshot, null) })) })
}

// POST /api/v1/orders — checkout from cart → creates order + proforma invoice
export async function POST(req: NextRequest) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  if (auth.user.role !== 'PATIENT') return fail('فقط کاربران می‌توانند سفارش ثبت کنند', 403)

  const cart = await db.cartItem.findMany({ where: { userId: auth.user.id }, include: { product: true } })
  if (cart.length === 0) return fail('سبد خرید خالی است')

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
  const subtotal = itemsData.reduce((s, i) => s + i.total, 0)
  const shippingCost = 50000
  const order = await db.order.create({
    data: {
      code: genCode('ORD'), userId: auth.user.id, type: 'SHOP', status: 'PENDING_CONFIRMATION',
      subtotal, shippingCost, total: subtotal + shippingCost,
      addressSnapshot: JSON.stringify(addressSnapshot),
      items: { create: itemsData },
    },
  })
  const invoice = await db.invoice.create({
    data: {
      code: genCode('INV'), orderId: order.id, status: 'SENT',
      items: JSON.stringify(itemsData), subtotal, shippingCost, total: subtotal + shippingCost,
      note: 'پیش‌فاکتور سفارش فروشگاهی',
    },
  })
  // decrement stock + clear cart
  for (const i of cart) {
    await db.product.update({ where: { id: i.product.id }, data: { stock: { decrement: i.quantity } } })
  }
  await db.cartItem.deleteMany({ where: { userId: auth.user.id } })

  await notify(auth.user.id, 'NEW_ORDER', { link: '/orders' })
  const operators = await db.user.findMany({ where: { role: 'OPERATOR', isActive: true }, select: { id: true } })
  for (const op of operators) await notify(op.id, 'NEW_ORDER', { extraFa: order.code })
  await audit(req, auth.user.id, 'CREATE_ORDER', 'Order', order.id, null, { code: order.code, total: order.total })

  return ok({ order: { id: order.id, code: order.code, total: order.total }, invoice: { code: invoice.code } })
}
