import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { getAuth } from '@/lib/auth'
import { executeTransition } from '@/lib/workflow'

// POST /api/v1/payments/[id]/receipt — patient uploads card-to-card receipt
// {trackingCode, amount, note, imageId}
// Phase 02: runs through the PAYMENT machine (SUBMIT_RECEIPT) — ownership guard,
// receipt data effects, audit log and operator notifications included.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  const { id } = await ctx.params
  const body = await req.json().catch(() => ({}))
  const payment = await db.payment.findUnique({ where: { id } })
  if (!payment || payment.userId !== auth.user.id) return fail('پرداخت یافت نشد', 404)
  if (payment.method !== 'CARD_TO_CARD') return fail('این پرداخت کارت‌به‌کارت نیست')

  let receiptImageId: string | null = null
  if (body.imageId) {
    const img = await db.medicalImage.findUnique({ where: { id: String(body.imageId) } })
    if (img && img.ownerId === auth.user.id) receiptImageId = img.id
  }

  const res = await executeTransition({
    machine: 'PAYMENT', entityId: id, action: 'SUBMIT_RECEIPT',
    actor: { id: auth.user.id, role: auth.user.role as never },
    payload: {
      trackingCode: String(body.trackingCode || '') || null,
      note: String(body.note || '') || null,
      imageId: receiptImageId,
    }, req,
  })
  if (!res.ok) return fail(res.error, res.httpStatus, res.details)
  return ok({ ok: true, message: 'رسید شما ارسال شد و توسط اپراتور بررسی می‌شود' })
}
