import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, audit } from '@/lib/api'

// GET /api/v1/payments/zarinpal/callback?authority=&status=
// Mock Zarinpal verification endpoint (sandbox). Idempotent: repeated callbacks with
// same authority will not double-apply payment.
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const authority = url.searchParams.get('authority') || ''
  const status = url.searchParams.get('status') || ''
  const payment = await db.payment.findFirst({ where: { authority } })
  if (!payment) return fail('تراکنش یافت نشد', 404)

  if (payment.status === 'PAID') {
    return ok({ alreadyPaid: true, code: payment.code }) // idempotent replay
  }

  if (status !== 'OK') {
    await db.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', error: 'Canceled by user (gateway)' } })
    return ok({ failed: true })
  }

  const refNumber = 100000000 + Math.floor(Math.random() * 900000000)
  await db.payment.update({
    where: { id: payment.id },
    data: { status: 'PAID', refNumber: String(refNumber), verifiedAt: new Date(), gateway: JSON.stringify({ provider: 'ZARINPAL', mock: true, authority }) },
  })

  const order = await db.order.findUnique({ where: { id: payment.orderId } })
  if (order) {
    if (order.status !== 'PAID') { // idempotency guard
      await db.order.update({ where: { id: order.id }, data: { status: 'PAID' } })
      await db.invoice.updateMany({ where: { orderId: order.id }, data: { status: 'PAID', paidAt: new Date() } })
      await db.financialTransaction.create({
        data: { type: 'INCOME', category: 'SALES', amount: payment.amount, description: `پرداخت درگاه زرین‌پال ${payment.code}`, orderId: order.id, userId: payment.userId },
      })
      const { notify } = await import('@/lib/notify')
      await notify(payment.userId, 'PAYMENT_CONFIRMED', { link: '/orders', sms: true })
      const operators = await db.user.findMany({ where: { role: 'OPERATOR', isActive: true }, select: { id: true } })
      for (const op of operators) await notify(op.id, 'PAYMENT_CONFIRMED', { extraFa: payment.code })
      // sync medical case status if prescription order
      if (order.type === 'PRESCRIPTION') {
        const invoice = await db.invoice.findFirst({ where: { orderId: order.id } })
        if (invoice?.caseId) {
          const c = await db.medicalCase.findUnique({ where: { id: invoice.caseId } })
          if (c && c.status === 'WAITING_FOR_PAYMENT') {
            await db.medicalCase.update({ where: { id: c.id }, data: { status: 'PAYMENT_CONFIRMED' } })
            await db.caseEvent.create({ data: { caseId: c.id, actorId: null, action: 'STATUS_CHANGE', fromStatus: 'WAITING_FOR_PAYMENT', toStatus: 'PAYMENT_CONFIRMED', comment: `پرداخت ${payment.code} تأیید شد` } })
          }
        }
      }
    }
    await audit(req, payment.userId, 'PAYMENT', 'Payment', payment.id, null, { status: 'PAID', refNumber })
  }
  return ok({ ok: true, code: payment.code, refNumber, amount: payment.amount })
}

// POST — same as GET for programmatic simulation
export async function POST(req: NextRequest) {
  return GET(req)
}
