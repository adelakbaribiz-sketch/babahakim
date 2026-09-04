// PAYMENT state machine — Zarinpal gateway + card-to-card verification.
// Idempotency (BR-FIN-01): GATEWAY_VERIFY/VERIFY_APPROVE only fire from
// non-PAID statuses; replayed callbacks resolve to no transition and the
// route answers from the already-PAID row.
import { TransitionDef, MachineDef, WorkflowError } from '../types'
import { cascadeSubTransition } from '../subtransition'
import { ORDER_MACHINE } from './order'
import { CASE_MACHINE } from './case'

export const PAYMENT_STATUSES = [
  'PENDING',        // gateway payment initiated
  'AWAITING_VERIFY', // card-to-card receipt submitted / awaiting operator
  'PAID',
  'FAILED',         // gateway error / user cancel
  'REJECTED',       // operator rejected receipt
  'REFUNDED',
] as const

const t = (def: TransitionDef): TransitionDef => def

/**
 * Atomic paid-cascade (single source of truth = the payment row):
 * ORDER → PAID (machine sub-transition whose txEffects chains cascadePaid:
 * invoices → PAID + FinancialTransaction INCOME), CASE → PAYMENT_CONFIRMED
 * (+ CaseEvent) for prescription orders.
 * Idempotent: no-op parts when the target is already in the final state,
 * so replayed verifies never double-apply (BR-FIN-01).
 */
export async function paymentPaidCascade(
  tx: unknown,
  payment: { id: string; code: string; amount: number; userId: string; orderId: string | null },
  actorId: string | null,
  source: string,
) {
  if (!payment.orderId) return
  // ORDER → PAID: machine-guarded. Already-PAID/REFUNDED/gone resolves to
  // a benign no-op (idempotent replay — BR-FIN-01).
  const orderMoved = await cascadeSubTransition({
    tx, machine: ORDER_MACHINE, entityId: payment.orderId, action: 'MARK_PAID',
    actor: { id: actorId || 'SYSTEM', role: 'SYSTEM' },
    payload: {
      paymentCode: payment.code, paymentAmount: payment.amount,
      paymentActorId: actorId, paymentSource: source,
    },
  })
  if (!orderMoved) return

  // CASE → PAYMENT_CONFIRMED for prescription orders (+ CaseEvent)
  const txx = tx as {
    order: { findUnique: (a: unknown) => Promise<{ type: string } | null> }
    invoice: { findFirst: (a: unknown) => Promise<{ caseId: string | null } | null> }
  }
  const order = await txx.order.findUnique({ where: { id: payment.orderId }, select: { type: true } })
  if (order?.type === 'PRESCRIPTION') {
    const invoice = await txx.invoice.findFirst({ where: { orderId: payment.orderId }, select: { caseId: true } })
    if (invoice?.caseId) {
      await cascadeSubTransition({
        tx, machine: CASE_MACHINE, entityId: invoice.caseId, action: 'MARK_PAID',
        payload: { comment: `${source} ${payment.code} تأیید شد` },
      })
    }
  }
}

export const PAYMENT_MACHINE: MachineDef = {
  entity: 'PAYMENT',
  prismaKey: 'payment',
  ownerField: 'userId',
  statuses: PAYMENT_STATUSES,
  initial: 'PENDING',
  transitions: [
    t({
      action: 'SUBMIT_RECEIPT', from: ['AWAITING_VERIFY', 'REJECTED'], to: 'AWAITING_VERIFY',
      roles: ['PATIENT'], descFa: 'رسید کارت‌به‌کارت ارسال/به‌روزرسانی شد',
      requireOwnership: true,
      dataEffects: (c) => ({
        trackingCode: String(c.payload.trackingCode || '') || null,
        receiptNote: String(c.payload.note || '') || null,
        receiptImageId: c.payload.imageId ? String(c.payload.imageId) : (c.entity as { receiptImageId?: string }).receiptImageId ?? null,
      }),
      postCommit: async (c) => {
        const { notify } = await import('@/lib/notify')
        await notify(c.actor.id, 'RECEIPT_UPLOADED', { link: '/payments' })
        const db = (c as unknown as { db: { user: { findMany: (a: unknown) => Promise<{ id: string }[]> } } }).db
        const operators = await db.user.findMany({ where: { role: 'OPERATOR', isActive: true }, select: { id: true } })
        for (const op of operators) await notify(op.id, 'RECEIPT_UPLOADED', { extraFa: String(c.entity.code || '') })
      },
    }),
    t({
      action: 'GATEWAY_FAIL', from: ['PENDING'], to: 'FAILED',
      roles: ['SYSTEM'], system: true, descFa: 'پرداخت درگاه ناموفق بود',
      dataEffects: (c) => ({ error: String(c.payload.error || 'Canceled by user (gateway)') }),
    }),
    t({
      action: 'GATEWAY_VERIFY', from: ['PENDING'], to: 'PAID',
      roles: ['SYSTEM'], system: true, descFa: 'پرداخت درگاه تأیید شد',
      dataEffects: (c) => ({
        refNumber: String(c.payload.refNumber || ''),
        verifiedAt: c.now,
        gateway: JSON.stringify({ provider: 'ZARINPAL', mock: true, authority: String(c.payload.authority || '') }),
      }),
      txEffects: async (c) => {
        await paymentPaidCascade((c as { tx: unknown }).tx, {
          id: String(c.entity.id), code: String(c.entity.code || ''),
          amount: Number(c.entity.amount || 0), userId: String(c.entity.userId),
          orderId: (c.entity as { orderId?: string }).orderId ? String(c.entity.orderId) : null,
        }, null, 'پرداخت درگاه زرین‌پال')
      },
      postCommit: async (c) => {
        const { notify } = await import('@/lib/notify')
        await notify(String(c.entity.userId), 'PAYMENT_CONFIRMED', { link: '/orders', sms: true })
        const db = (c as unknown as { db: { user: { findMany: (a: unknown) => Promise<{ id: string }[]> } } }).db
        const operators = await db.user.findMany({ where: { role: 'OPERATOR', isActive: true }, select: { id: true } })
        for (const op of operators) await notify(op.id, 'PAYMENT_CONFIRMED', { extraFa: String(c.entity.code || '') })
      },
    }),
    t({
      action: 'VERIFY_APPROVE', from: ['AWAITING_VERIFY'], to: 'PAID',
      roles: ['OPERATOR', 'EXPERT_2'], permission: 'verify_payment', descFa: 'رسید کارت‌به‌کارت تأیید شد',
      dataEffects: (c) => ({
        verifiedById: c.actor.id, verifiedAt: c.now,
        refNumber: (c.entity as { refNumber?: string }).refNumber || `MAN-${Date.now()}`,
      }),
      txEffects: async (c) => {
        await paymentPaidCascade((c as { tx: unknown }).tx, {
          id: String(c.entity.id), code: String(c.entity.code || ''),
          amount: Number(c.entity.amount || 0), userId: String(c.entity.userId),
          orderId: (c.entity as { orderId?: string }).orderId ? String(c.entity.orderId) : null,
        }, c.actor.id, 'تأیید کارت‌به‌کارت')
      },
      postCommit: async (c) => {
        const { notify } = await import('@/lib/notify')
        await notify(String(c.entity.userId), 'PAYMENT_CONFIRMED', { link: '/orders', sms: true })
      },
    }),
    t({
      action: 'VERIFY_REJECT', from: ['AWAITING_VERIFY'], to: 'REJECTED',
      roles: ['OPERATOR', 'EXPERT_2'], permission: 'verify_payment', descFa: 'رسید پرداخت رد شد',
      validate: (c) => {
        if (!String(c.payload.note || '').trim()) {
          throw new WorkflowError('VALIDATION', 'ذکر دلیل رد رسید الزامی است | Rejection note required', 422)
        }
      },
      dataEffects: (c) => ({ error: String(c.payload.note || '') || null }),
      postCommit: async (c) => {
        const { notify } = await import('@/lib/notify')
        await notify(String(c.entity.userId), 'PAYMENT_REJECTED', { link: '/payments', sms: true })
      },
    }),
    t({
      action: 'REQUEST_INFO', from: ['AWAITING_VERIFY', 'REJECTED'], to: 'AWAITING_VERIFY',
      roles: ['OPERATOR', 'EXPERT_2'], permission: 'verify_payment', descFa: 'اطلاعات بیشتر از پرداخت‌کننده درخواست شد',
      dataEffects: (c) => ({ error: String(c.payload.note || 'نیاز به اطلاعات بیشتر') || null }),
      postCommit: async (c) => {
        const { notify } = await import('@/lib/notify')
        await notify(String(c.entity.userId), 'RECEIPT_UPLOADED', { link: '/payments', extraFa: 'نیاز به اطلاعات بیشتر' })
      },
    }),
    t({
      action: 'RETRY', from: ['FAILED', 'REJECTED'], to: 'PENDING',
      roles: ['PATIENT'], descFa: 'پرداخت مجدداً آغاز شد',
      requireOwnership: true,
      dataEffects: (c) => ({ error: null }),
    }),
    t({
      action: 'REFUND', from: ['PAID'], to: 'REFUNDED',
      roles: ['ADMIN', 'OPERATOR'], permission: 'verify_payment', descFa: 'پرداخت بازگردانده شد',
      validate: (c) => {
        if (!String(c.payload.reason || '').trim()) {
          throw new WorkflowError('VALIDATION', 'دلیل بازپرداخت الزامی است | Refund reason required', 422)
        }
      },
      postCommit: async (c) => {
        const { notify } = await import('@/lib/notify')
        await notify(String(c.entity.userId), 'PAYMENT_REJECTED', { link: '/payments', extraFa: 'بازپرداخت ثبت شد' })
      },
    }),
  ],
}
