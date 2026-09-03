import { NextRequest } from 'next/server'
import { ok, fail } from '@/lib/api'
import { getAuth } from '@/lib/auth'
import { executeTransition } from '@/lib/workflow'

// POST /api/v1/payments/[id]/verify — operator approves/rejects card-to-card receipt
// {decision: APPROVE|REJECT|MORE_INFO, note}
// Phase 02: runs through the PAYMENT machine — guards, validation (note mandatory on
// REJECT), audit log, and the atomic paid-cascade (ORDER + Invoice + FinancialTransaction
// + CASE sync) all execute inside the engine transaction.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  const { id } = await ctx.params
  const body = await req.json().catch(() => ({}))
  const decision = String(body.decision || '')

  const ACTION = { APPROVE: 'VERIFY_APPROVE', REJECT: 'VERIFY_REJECT', MORE_INFO: 'REQUEST_INFO' } as Record<string, string>
  const action = ACTION[decision]
  if (!action) return fail('تصمیم نامعتبر است')

  const res = await executeTransition({
    machine: 'PAYMENT', entityId: id, action,
    actor: { id: auth.user.id, role: auth.user.role as never },
    payload: { note: String(body.note || '') }, req,
  })
  if (!res.ok) {
    // idempotent double-approve keeps the original friendly message
    if (res.code === 'INVALID_TRANSITION' && decision === 'APPROVE') {
      return fail('این پرداخت قبلاً تأیید شده است', 409)
    }
    return fail(res.error, res.httpStatus, res.details)
  }
  return ok({ message: decision === 'APPROVE' ? 'پرداخت تأیید شد' : decision === 'REJECT' ? 'پرداخت رد شد' : 'درخواست اطلاعات بیشتر ثبت شد' })
}
