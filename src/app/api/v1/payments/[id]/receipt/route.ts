import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, audit } from '@/lib/api'
import { getAuth } from '@/lib/auth'
import { notify } from '@/lib/notify'

// POST /api/v1/payments/[id]/receipt — patient uploads card-to-card receipt {trackingCode, amount, note, imageId}
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  const { id } = await ctx.params
  const body = await req.json().catch(() => ({}))
  const payment = await db.payment.findUnique({ where: { id } })
  if (!payment || payment.userId !== auth.user.id) return fail('پرداخت یافت نشد', 404)
  if (payment.method !== 'CARD_TO_CARD') return fail('این پرداخت کارت‌به‌کارت نیست')
  if (payment.status !== 'AWAITING_VERIFY') return fail('این پرداخت در وضعیت قابل ارسال رسید نیست', 409)

  let receiptImageId: string | null = null
  if (body.imageId) {
    const img = await db.medicalImage.findUnique({ where: { id: String(body.imageId) } })
    if (img && img.ownerId === auth.user.id) receiptImageId = img.id
  }

  await db.payment.update({
    where: { id },
    data: {
      trackingCode: String(body.trackingCode || '') || null,
      receiptNote: String(body.note || '') || null,
      receiptImageId,
      status: 'AWAITING_VERIFY',
    },
  })
  await notify(auth.user.id, 'RECEIPT_UPLOADED', { link: '/payments' })
  const operators = await db.user.findMany({ where: { role: 'OPERATOR', isActive: true }, select: { id: true } })
  for (const op of operators) await notify(op.id, 'RECEIPT_UPLOADED', { extraFa: payment.code })
  await audit(req, auth.user.id, 'RECEIPT_UPLOAD', 'Payment', id)
  return ok({ ok: true, message: 'رسید شما ارسال شد و توسط اپراتور بررسی می‌شود' })
}
