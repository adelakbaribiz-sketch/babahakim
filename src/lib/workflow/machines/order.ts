// ORDER state machine — shop + prescription order lifecycle (11 statuses).
// Encodes the CURRENT production behavior (payment verify sets PAID from
// PENDING_CONFIRMATION/CONFIRMED/PAYMENT_PENDING) plus the full clean
// path from BR §3.2. CASCADES (invoice, financial transaction) run inside
// the same transaction as the status write.
import { TransitionDef, MachineDef, WorkflowError } from '../types'
import { cascadeSubTransition } from '../subtransition'
import { INVOICE_MACHINE } from './invoice'

export const ORDER_STATUSES = [
  'CART', 'PENDING_CONFIRMATION', 'CONFIRMED', 'PAYMENT_PENDING', 'PAID',
  'PREPARING', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED',
] as const

const t = (def: TransitionDef): TransitionDef => def

/**
 * Shared cascade for "order became PAID": invoices → PAID (machine-guarded
 * sub-transitions) + financial INCOME row. Runs inside the caller's
 * transaction. The ORDER status write itself is NOT done here — the engine
 * (user action) or applySubTransition (payment cascade) owns it, and both
 * chain into this function via ORDER.MARK_PAID.txEffects.
 * (Previously duplicated inline in payments verify + zarinpal callback.)
 */
export async function cascadePaid(tx: unknown, orderId: string, payment: {
  code: string; amount: number; userId: string; actorId: string | null; source: string
}) {
  const txx = tx as {
    invoice: { findMany: (a: unknown) => Promise<{ id: string }[]> }
    financialTransaction: { create: (a: unknown) => Promise<unknown> }
  }
  // invoices → PAID: machine-guarded, idempotent (already-PAID → no-op)
  const invoices = await txx.invoice.findMany({ where: { orderId }, select: { id: true } })
  for (const inv of invoices) {
    await cascadeSubTransition({ tx, machine: INVOICE_MACHINE, entityId: inv.id, action: 'MARK_PAID' })
  }
  // append-only financial journal row (not a state-machine entity)
  await txx.financialTransaction.create({
    data: {
      type: 'INCOME', category: 'SALES', amount: payment.amount,
      description: `${payment.source} ${payment.code}`,
      orderId, userId: payment.userId, createdById: payment.actorId,
    },
  })
}

export const ORDER_MACHINE: MachineDef = {
  entity: 'ORDER',
  prismaKey: 'order',
  ownerField: 'userId',
  statuses: ORDER_STATUSES,
  initial: 'CART',
  transitions: [
    t({
      action: 'CHECKOUT', from: ['CART'], to: 'PENDING_CONFIRMATION',
      roles: ['PATIENT'], descFa: 'سفارش ثبت شد و در انتظار تأیید است',
      requireOwnership: true,
    }),
    t({
      // PHASE 12 (ED-126): startPayment used to write PAYMENT_PENDING
      // directly — a status the machine graph could not even reach. Now the
      // payment-start path enters it through the machine (guarded + audited).
      action: 'ENTER_PAYMENT', from: ['PENDING_CONFIRMATION', 'CONFIRMED', 'PAYMENT_PENDING', 'PREPARING', 'READY_TO_SHIP'], to: 'PAYMENT_PENDING',
      roles: ['PATIENT', 'SYSTEM'], system: true, descFa: 'فرآیند پرداخت سفارش آغاز شد',
      requireOwnership: true,
    }),
    t({
      action: 'CONFIRM', from: ['PENDING_CONFIRMATION'], to: 'CONFIRMED',
      roles: ['OPERATOR', 'EXPERT_2'], permission: 'manage_orders', descFa: 'سفارش تأیید شد',
      dataEffects: (c) => ({ verifiedById: c.actor.id }),
      txEffects: async (c) => {
        // invoice SENT → CONFIRMED (machine-guarded, idempotent)
        const txx = (c as { tx: unknown }).tx as { invoice: { findMany: (a: unknown) => Promise<{ id: string }[]> } }
        const invoices = await txx.invoice.findMany({ where: { orderId: c.entity.id }, select: { id: true } })
        for (const inv of invoices) {
          await cascadeSubTransition({ tx: (c as { tx: unknown }).tx, machine: INVOICE_MACHINE, entityId: inv.id, action: 'CONFIRM' })
        }
      },
      postCommit: async (c) => {
        const { notify } = await import('@/lib/notify')
        await notify(String(c.entity.userId), 'ORDER_PREPARING', { link: '/orders' })
      },
    }),
    t({
      action: 'MARK_PAID',
      from: ['PENDING_CONFIRMATION', 'CONFIRMED', 'PAYMENT_PENDING'],
      to: 'PAID',
      roles: ['OPERATOR', 'EXPERT_2', 'SYSTEM'], permission: 'verify_payment', system: true,
      descFa: 'پرداخت سفارش تأیید شد',
      dataEffects: (c) => ({
        verifiedById: c.actor.id === 'SYSTEM' ? (c.entity as { verifiedById?: string }).verifiedById ?? null : c.actor.id,
      }),
      txEffects: async (c) => {
        const ctx = c as unknown as { tx: unknown; payload: Record<string, unknown> }
        await cascadePaid(ctx.tx, c.entity.id, {
          code: String(ctx.payload.paymentCode || (c.entity as { code?: string }).code || ''),
          amount: Number(ctx.payload.paymentAmount || (c.entity as { total?: number }).total || 0),
          userId: String(c.entity.userId),
          actorId: ctx.payload.paymentActorId ? String(ctx.payload.paymentActorId) : null,
          source: String(ctx.payload.paymentSource || 'تأیید پرداخت'),
        })
      },
    }),
    t({
      action: 'PREPARE', from: ['CONFIRMED', 'PAID'], to: 'PREPARING',
      roles: ['OPERATOR'], permission: 'manage_orders', descFa: 'آماده‌سازی سفارش آغاز شد',
      dataEffects: (c) => ({ verifiedById: c.actor.id }),
    }),
    t({
      action: 'READY', from: ['PREPARING'], to: 'READY_TO_SHIP',
      roles: ['OPERATOR'], permission: 'manage_orders', descFa: 'سفارش آماده ارسال است',
      dataEffects: (c) => ({ verifiedById: c.actor.id }),
    }),
    t({
      action: 'SHIP', from: ['PREPARING', 'READY_TO_SHIP', 'PAID', 'CONFIRMED'], to: 'SHIPPED',
      roles: ['OPERATOR', 'EXPERT_2'], permission: 'manage_shipments', descFa: 'سفارش ارسال شد',
      postCommit: async (c) => {
        const { notify } = await import('@/lib/notify')
        await notify(String(c.entity.userId), 'ORDER_SHIPPED', { link: '/orders', sms: true })
      },
    }),
    t({
      action: 'DELIVER', from: ['SHIPPED', 'READY_TO_SHIP'], to: 'DELIVERED',
      roles: ['OPERATOR', 'EXPERT_2'], permission: 'manage_shipments', descFa: 'سفارش تحویل شد',
      postCommit: async (c) => {
        const { notify } = await import('@/lib/notify')
        await notify(String(c.entity.userId), 'ORDER_DELIVERED', { link: '/orders', sms: true })
      },
    }),
    t({
      action: 'CANCEL',
      from: ['CART', 'PENDING_CONFIRMATION', 'CONFIRMED', 'PAYMENT_PENDING', 'PREPARING', 'READY_TO_SHIP'],
      to: 'CANCELLED',
      roles: ['PATIENT', 'OPERATOR', 'EXPERT_2'], descFa: 'سفارش لغو شد',
      requireOwnership: true,
      validate: (c) => {
        if (String(c.payload.reason || '').trim().length < 3) {
          throw new WorkflowError('VALIDATION', 'ذکر دلیل لغو (حداقل ۳ حرف) الزامی است | Reason required', 422)
        }
      },
      dataEffects: (c) => ({ cancelledReason: String(c.payload.reason || '') }),
      postCommit: async (c) => {
        const { notify } = await import('@/lib/notify')
        await notify(String(c.entity.userId), 'CASE_CLOSED', { link: '/orders' })
      },
    }),
    t({
      action: 'REFUND', from: ['PAID', 'DELIVERED'], to: 'REFUNDED',
      roles: ['ADMIN', 'OPERATOR'], permission: 'verify_payment', descFa: 'سفارش بازپرداخت شد',
      validate: (c) => {
        if (!String(c.payload.reason || '').trim()) {
          throw new WorkflowError('VALIDATION', 'دلیل بازپرداخت الزامی است | Refund reason required', 422)
        }
      },
      txEffects: async (c) => {
        const tx = (c as { tx: unknown }).tx as {
          financialTransaction: { create: (a: unknown) => Promise<unknown> }
          payment: { updateMany: (a: unknown) => Promise<unknown> }
        }
        await tx.payment.updateMany({ where: { orderId: c.entity.id, status: 'PAID' }, data: { status: 'REFUNDED' } })
        await tx.financialTransaction.create({
          data: {
            type: 'REFUND', category: 'SALES', amount: Number(c.entity.total || 0),
            description: `بازپرداخت سفارش ${c.entity.code} — ${String(c.payload.reason || '')}`,
            orderId: c.entity.id, userId: String(c.entity.userId), createdById: c.actor.id,
          },
        })
      },
    }),
  ],
}
