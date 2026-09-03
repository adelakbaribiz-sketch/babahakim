import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { executeTransition } from '@/lib/workflow'

// GET /api/v1/payments/zarinpal/callback?authority=&status=
// Mock Zarinpal verification endpoint (sandbox). Idempotent: repeated callbacks
// with the same authority resolve from the already-PAID row (BR-FIN-01);
// the paid-cascade (ORDER/Invoice/FinancialTransaction/CASE) runs inside the
// PAYMENT machine transaction.
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
    const res = await executeTransition({
      machine: 'PAYMENT', entityId: payment.id, action: 'GATEWAY_FAIL',
      actor: { id: 'SYSTEM', role: 'SYSTEM' },
      payload: { error: 'Canceled by user (gateway)' }, req,
    })
    if (!res.ok) return fail(res.error, res.httpStatus, res.details)
    return ok({ failed: true })
  }

  const refNumber = 100000000 + Math.floor(Math.random() * 900000000)
  const res = await executeTransition({
    machine: 'PAYMENT', entityId: payment.id, action: 'GATEWAY_VERIFY',
    actor: { id: 'SYSTEM', role: 'SYSTEM' },
    payload: { refNumber: String(refNumber), authority }, req,
  })
  if (!res.ok) return fail(res.error, res.httpStatus, res.details)

  return ok({ ok: true, code: payment.code, refNumber, amount: payment.amount })
}

// POST — same as GET for programmatic simulation
export async function POST(req: NextRequest) {
  return GET(req)
}
