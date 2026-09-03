import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, audit } from '@/lib/api'
import { getAuth } from '@/lib/auth'
import { notify } from '@/lib/notify'

// POST /api/v1/payments/[id]/verify — operator approves/rejects card-to-card receipt {decision: APPROVE|REJECT|MORE_INFO, note}
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  if (!['OPERATOR', 'EXPERT_2', 'ADMIN'].includes(auth.user.role)) return fail('دسترسی غیرمجاز', 403)
  const { id } = await ctx.params
  const body = await req.json().catch(() => ({}))
  const decision = String(body.decision || '')

  const payment = await db.payment.findUnique({ where: { id }, include: { order: { include: { invoices: { take: 1 } } } } })
  if (!payment) return fail('پرداخت یافت نشد', 404)
  if (payment.status === 'PAID' && decision === 'APPROVE') return fail('این پرداخت قبلاً تأیید شده است', 409)

  if (decision === 'APPROVE') {
    await db.payment.update({
      where: { id },
      data: { status: 'PAID', verifiedById: auth.user.id, verifiedAt: new Date(), refNumber: payment.refNumber || `MAN-${Date.now()}` },
    })
    const order = payment.order
    if (order && order.status !== 'PAID') {
      await db.order.update({ where: { id: order.id }, data: { status: 'PAID', verifiedById: auth.user.id } })
      await db.invoice.updateMany({ where: { orderId: order.id }, data: { status: 'PAID', paidAt: new Date() } })
      await db.financialTransaction.create({
        data: { type: 'INCOME', category: 'SALES', amount: payment.amount, description: `تأیید کارت‌به‌کارت ${payment.code}`, orderId: order.id, userId: payment.userId, createdById: auth.user.id },
      })
    }
    // sync case status
    const invoice = order?.invoices?.[0]
    if (invoice?.caseId) {
      const c = await db.medicalCase.findUnique({ where: { id: invoice.caseId } })
      if (c && c.status === 'WAITING_FOR_PAYMENT') {
        await db.medicalCase.update({ where: { id: c.id }, data: { status: 'PAYMENT_CONFIRMED' } })
        await db.caseEvent.create({ data: { caseId: c.id, actorId: auth.user.id, action: 'STATUS_CHANGE', fromStatus: 'WAITING_FOR_PAYMENT', toStatus: 'PAYMENT_CONFIRMED', comment: `تأیید پرداخت ${payment.code} توسط ${auth.user.firstName} ${auth.user.lastName}` } })
      }
    }
    await notify(payment.userId, 'PAYMENT_CONFIRMED', { link: '/orders', sms: true })
    await audit(req, auth.user.id, 'VERIFY_PAYMENT', 'Payment', id, { status: payment.status }, { status: 'PAID' })
    return ok({ message: 'پرداخت تأیید شد' })
  }

  if (decision === 'REJECT' || decision === 'MORE_INFO') {
    const status = decision === 'REJECT' ? 'REJECTED' : 'AWAITING_VERIFY'
    await db.payment.update({ where: { id }, data: { status, error: String(body.note || '') || null } })
    if (decision === 'REJECT') await notify(payment.userId, 'PAYMENT_REJECTED', { link: '/payments', sms: true })
    if (decision === 'MORE_INFO') await notify(payment.userId, 'RECEIPT_UPLOADED', { link: '/payments', extraFa: 'نیاز به اطلاعات بیشتر' })
    await audit(req, auth.user.id, 'VERIFY_PAYMENT', 'Payment', id, { status: payment.status }, { status, note: body.note })
    return ok({ message: decision === 'REJECT' ? 'پرداخت رد شد' : 'درخواست اطلاعات بیشتر ثبت شد' })
  }

  return fail('تصمیم نامعتبر است')
}
