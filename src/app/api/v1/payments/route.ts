import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, audit, genCode, parseJSON } from '@/lib/api'
import { getAuth, signImageUrl } from '@/lib/auth'
import { notify } from '@/lib/notify'
import { createHash } from 'crypto'

// GET /api/v1/payments?status= — role-scoped (patient: own; staff: all for verify)
export async function GET(req: NextRequest) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  const status = new URL(req.url).searchParams.get('status') || ''
  const where: Record<string, unknown> = {}
  if (auth.user.role === 'PATIENT') where.userId = auth.user.id
  if (status) where.status = status
  const payments = await db.payment.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      order: { include: { items: true, user: { select: { firstName: true, lastName: true, phone: true } } } },
      invoice: true,
      verifiedBy: { select: { firstName: true, lastName: true } },
    },
  })
  return ok({
    payments: payments.map((p) => ({
      ...p,
      receiptUrl: p.receiptImageId ? signImageUrl(p.receiptImageId, 600) : null,
    })),
  })
}

// POST /api/v1/payments — start payment (Zarinpal-mock gateway OR card-to-card receipt)
// Idempotency: duplicate payment for an unpaid invoice is rejected (idempotencyKey + DB unique)
export async function POST(req: NextRequest) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  if (auth.user.role !== 'PATIENT') return fail('فقط کاربران می‌توانند پرداخت ثبت کنند', 403)

  const body = await req.json().catch(() => ({}))
  const orderId = String(body.orderId || '')
  const method = body.method === 'CARD_TO_CARD' ? 'CARD_TO_CARD' : 'ZARINPAL'

  const order = await db.order.findUnique({ where: { id: orderId }, include: { payments: true, invoices: { take: 1 } } })
  if (!order || order.userId !== auth.user.id) return fail('سفارش یافت نشد', 404)
  if (['PAID', 'SHIPPED', 'DELIVERED'].includes(order.status)) return fail('این سفارش قبلاً پرداخت شده است', 409)

  const active = order.payments.find((p) => !['FAILED', 'REJECTED', 'REFUNDED'].includes(p.status))
  if (active) return fail('برای این سفارش پرداخت فعالی وجود دارد', 409)

  // update order & invoice status
  await db.order.update({ where: { id: orderId }, data: { status: 'PAYMENT_PENDING' } })
  await db.invoice.updateMany({ where: { orderId }, data: { status: 'CONFIRMED', confirmedAt: new Date() } })

  const payment = await db.payment.create({
    data: {
      code: genCode('PAY'), orderId, invoiceId: order.invoices?.[0]?.id || null, userId: auth.user.id,
      method, amount: order.total, status: method === 'CARD_TO_CARD' ? 'AWAITING_VERIFY' : 'PENDING',
      authority: method === 'ZARINPAL' ? createHash('sha256').update(`${orderId}-${Date.now()}`).digest('hex').slice(0, 36) : null,
      idempotencyKey: `order-${orderId}`,
    },
  })

  if (method === 'ZARINPAL') {
    // Mock gateway: client will open the gateway simulation view and call /callback
    return ok({
      payment: { id: payment.id, code: payment.code, amount: payment.amount, authority: payment.authority },
      gatewayUrl: `/api/v1/payments/zarinpal/callback?authority=${payment.authority}&status=OK`,
      mockGateway: { authority: payment.authority, amount: payment.amount, merchant: process.env.ZARINPAL_MERCHANT_ID || 'MOCK-MERCHANT' },
    })
  }
  return ok({ payment: { id: payment.id, code: payment.code, amount: payment.amount, status: payment.status }, uploadReceipt: true })
}
