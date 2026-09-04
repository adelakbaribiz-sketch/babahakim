// ── BabaHakim Backend · Application Service: Payments (PHASE 08) ──────────
// Start/verify/receipt/gateway-callback. Status writes flow through the
// PAYMENT machine (Phase 02); start is now transactional (ED-103).
// PHASE 13: every gateway interaction goes through the PaymentProvider
// adapter (Zarinpal live / deterministic mock — ED-142) behind the
// integration resilience stack. The service NEVER talks HTTP itself.
import { db } from '@/lib/db'
import type { AuthContext } from '@/lib/auth'
import { executeTransition } from '@/lib/workflow'
import { applySubTransition, cascadeSubTransition } from '@/lib/workflow/subtransition'
import { ORDER_MACHINE } from '@/lib/workflow/machines/order'
import { INVOICE_MACHINE } from '@/lib/workflow/machines/invoice'
import { genCode } from '@/server/core/ids'
import { AppError, BusinessRuleError, ForbiddenError, NotFoundError, ValidationError, ErrorCode } from '@/server/core/errors'
import { writeAudit, toAuditReq } from '@/server/infrastructure/audit'
import { withTransaction } from '@/server/infrastructure/uow'
import { publish, Events } from '@/server/infrastructure/events'
import type { RequestContext } from '@/server/core/context'
import { assertOrderPayable, assertNoActivePayment } from '@/server/domain/policies'
import type { paymentStartSchema, paymentVerifySchema, receiptSchema } from '@/server/application/dto'
import { payment as paymentProvider, IntegrationError, paymentSettings, zarinpalMerchantMasked } from '@/server/integrations'
import type { z } from 'zod'

const SYSTEM_ACTOR = { id: 'SYSTEM', role: 'SYSTEM' as const }

// ── START (Zarinpal mock OR card-to-card) ─────────────────────────────────
export async function startPayment(
  auth: AuthContext, ctx: RequestContext, input: z.infer<typeof paymentStartSchema>,
) {
  if (auth.user.role !== 'PATIENT') throw new ForbiddenError('فقط کاربران می‌توانند پرداخت ثبت کنند')
  const order = await db.order.findUnique({ where: { id: input.orderId }, include: { payments: true, invoices: { take: 1 } } })
  if (!order || order.userId !== auth.user.id) throw new NotFoundError('سفارش یافت نشد')
  assertOrderPayable(order.status)
  assertNoActivePayment(order.payments.some((p) => !['FAILED', 'REJECTED', 'REFUNDED'].includes(p.status)))

  // PHASE 13 (ED-142): the gateway request goes through the PaymentProvider
  // adapter (Zarinpal live / deterministic mock) with idempotency per order —
  // retrying start never opens a second gateway session. Provider failures
  // surface as 502 with the humanized Persian message (ED-141).
  let gateway: { authority: string; gatewayUrl: string }
  if (input.method === 'ZARINPAL') {
    const user = await db.user.findUnique({ where: { id: auth.user.id }, select: { phone: true } })
    const base = paymentSettings().callbackBase
    try {
      const created = await paymentProvider().createPayment({
        amount: order.total,
        description: `سفارش ${order.code} — باباحکیم`,
        callbackUrl: `${base}/api/v1/payments/zarinpal/callback`,
        mobile: user?.phone ?? null,
        orderId: input.orderId,
      })
      gateway = { authority: created.authority, gatewayUrl: created.gatewayUrl }
    } catch (e) {
      if (e instanceof IntegrationError) {
        throw new AppError('BAD_GATEWAY' as ErrorCode, e.message, 502, { code: e.code, provider: e.provider })
      }
      throw e
    }
  } else {
    gateway = { authority: '', gatewayUrl: '' }
  }

  const payment = await withTransaction(async (tx) => {
    // PHASE 12 (ED-126): order + invoice state changes are machine-guarded
    // sub-transitions (audited, WorkflowState-synced) instead of raw updates
    const orderRes = await applySubTransition({
      tx, machine: ORDER_MACHINE, entityId: input.orderId, action: 'ENTER_PAYMENT',
    })
    if (!orderRes.ok) {
      throw new BusinessRuleError('سفارش در وضعیت قابل پرداخت نیست')
    }
    const invoices = await tx.invoice.findMany({ where: { orderId: input.orderId }, select: { id: true } })
    for (const inv of invoices) {
      await cascadeSubTransition({ tx, machine: INVOICE_MACHINE, entityId: inv.id, action: 'CONFIRM' })
    }
    return tx.payment.create({
      data: {
        code: genCode('PAY'), orderId: input.orderId, invoiceId: order.invoices?.[0]?.id || null,
        userId: auth.user.id, method: input.method, amount: order.total,
        status: input.method === 'CARD_TO_CARD' ? 'AWAITING_VERIFY' : 'PENDING',
        authority: input.method === 'ZARINPAL' ? gateway.authority : null,
        idempotencyKey: `order-${input.orderId}`,
      },
    })
  })

  await publish(Events.PaymentStarted, { paymentId: payment.id, orderId: input.orderId, userId: auth.user.id, method: input.method }, ctx.reqId)

  if (input.method === 'ZARINPAL') {
    return {
      payment: { id: payment.id, code: payment.code, amount: payment.amount, authority: payment.authority },
      gatewayUrl: gateway.gatewayUrl,
      mockGateway: paymentProvider().name.startsWith('mock-')
        ? { authority: payment.authority, amount: payment.amount, merchant: zarinpalMerchantMasked() }
        : undefined,
    }
  }
  return { payment: { id: payment.id, code: payment.code, amount: payment.amount, status: payment.status }, uploadReceipt: true }
}

// ── VERIFY (operator decision → PAYMENT machine cascade) ──────────────────
export async function verifyPayment(
  auth: AuthContext, ctx: RequestContext, id: string, input: z.infer<typeof paymentVerifySchema>,
) {
  const ACTION: Record<string, string> = { APPROVE: 'VERIFY_APPROVE', REJECT: 'VERIFY_REJECT', MORE_INFO: 'REQUEST_INFO' }
  const action = ACTION[input.decision]
  if (!action) throw new ValidationError('تصمیم نامعتبر است')

  const res = await executeTransition({
    machine: 'PAYMENT', entityId: id, action,
    actor: { id: auth.user.id, role: auth.user.role as never },
    payload: { note: input.note }, req: toAuditReq(ctx),
  })
  if (!res.ok) {
    // idempotent double-approve keeps the original friendly message
    if (res.code === 'INVALID_TRANSITION' && input.decision === 'APPROVE') {
      throw new AppError('CONFLICT' as ErrorCode, 'این پرداخت قبلاً تأیید شده است', 409)
    }
    throw new AppError(mapEngineCode(res.code), res.error, res.httpStatus, res.details)
  }
  await publish(Events.PaymentVerified, { paymentId: id, decision: input.decision }, ctx.reqId)
  return {
    message: input.decision === 'APPROVE' ? 'پرداخت تأیید شد' : input.decision === 'REJECT' ? 'پرداخت رد شد' : 'درخواست اطلاعات بیشتر ثبت شد',
  }
}

// ── RECEIPT (patient submits card-to-card proof) ───────────────────────────
export async function submitReceipt(
  auth: AuthContext, ctx: RequestContext, id: string, input: z.infer<typeof receiptSchema>,
) {
  const payment = await db.payment.findUnique({ where: { id } })
  if (!payment || payment.userId !== auth.user.id) throw new NotFoundError('پرداخت یافت نشد')
  if (payment.method !== 'CARD_TO_CARD') throw new BusinessRuleError('این پرداخت کارت‌به‌کارت نیست')

  let receiptImageId: string | null = null
  if (input.imageId) {
    const img = await db.medicalImage.findUnique({ where: { id: input.imageId } })
    if (img && img.ownerId === auth.user.id) receiptImageId = img.id
  }

  const res = await executeTransition({
    machine: 'PAYMENT', entityId: id, action: 'SUBMIT_RECEIPT',
    actor: { id: auth.user.id, role: auth.user.role as never },
    payload: {
      trackingCode: input.trackingCode || null,
      note: input.note || null,
      imageId: receiptImageId,
    }, req: toAuditReq(ctx),
  })
  if (!res.ok) throw new AppError(mapEngineCode(res.code), res.error, res.httpStatus, res.details)
  return { ok: true, message: 'رسید شما ارسال شد و توسط اپراتور بررسی می‌شود' }
}

// ── GATEWAY CALLBACK (provider-verified, idempotent — BR-FIN-01) ──────────
export async function gatewayCallback(ctx: RequestContext, authority: string, status: string) {
  const payment = await db.payment.findFirst({ where: { authority } })
  if (!payment) throw new NotFoundError('تراکنش یافت نشد')

  if (payment.status === 'PAID') {
    return { alreadyPaid: true, code: payment.code } // idempotent replay
  }

  // PHASE 13 (ED-142): verification is the PROVIDER's job (Zarinpal verify
  // API live / deterministic mock). Provider-level idempotency
  // (`verify:{authority}`) makes repeated callbacks free (BR-INT-03).
  let verified: { ok: boolean; refNumber?: string }
  try {
    verified = await paymentProvider().verifyPayment({ authority, amount: payment.amount, orderId: payment.orderId, status })
  } catch (e) {
    // transient provider failure → GATEWAY_FAIL keeps the row honest; the
    // payer/gateway may retry (idempotency replays the SUCCESS later)
    const res = await executeTransition({
      machine: 'PAYMENT', entityId: payment.id, action: 'GATEWAY_FAIL',
      actor: SYSTEM_ACTOR,
      payload: { error: e instanceof IntegrationError ? `${e.code}: ${e.message}` : 'provider error' },
      req: toAuditReq(ctx),
    })
    if (!res.ok) throw new AppError(mapEngineCode(res.code), res.error, res.httpStatus, res.details)
    return { failed: true, providerError: e instanceof IntegrationError ? e.code : 'PROVIDER' }
  }

  if (!verified.ok) {
    const res = await executeTransition({
      machine: 'PAYMENT', entityId: payment.id, action: 'GATEWAY_FAIL',
      actor: SYSTEM_ACTOR, payload: { error: 'Canceled by user (gateway)' }, req: toAuditReq(ctx),
    })
    if (!res.ok) throw new AppError(mapEngineCode(res.code), res.error, res.httpStatus, res.details)
    return { failed: true }
  }

  const refNumber = verified.refNumber ?? ''
  const res = await executeTransition({
    machine: 'PAYMENT', entityId: payment.id, action: 'GATEWAY_VERIFY',
    actor: SYSTEM_ACTOR, payload: { refNumber: String(refNumber), authority }, req: toAuditReq(ctx),
  })
  if (!res.ok) throw new AppError(mapEngineCode(res.code), res.error, res.httpStatus, res.details)
  await publish(Events.OrderPaid, { paymentId: payment.id, orderId: payment.orderId }, ctx.reqId)
  return { ok: true, code: payment.code, refNumber, amount: payment.amount }
}

function mapEngineCode(code?: string): ErrorCode {
  switch (code) {
    case 'NOT_FOUND': return 'NOT_FOUND'
    case 'FORBIDDEN_ROLE': case 'FORBIDDEN_PERMISSION': case 'NOT_OWNER': return 'FORBIDDEN'
    case 'INVALID_TRANSITION': case 'ALREADY_OWNED': case 'PRECONDITION': return 'CONFLICT'
    case 'VALIDATION': return 'BUSINESS_RULE'
    default: return 'INTERNAL'
  }
}
