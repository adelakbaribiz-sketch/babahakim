import { NextRequest } from 'next/server'
import { fail, ok, audit } from '@/lib/api'
import { requireAuth } from '@/lib/api'
import { db } from '@/lib/db'
import { createDeletionRequest } from '@/lib/security/privacy'

// GET /api/v1/privacy/deletion-request — my current deletion request status
export async function GET() {
  const auth = await requireAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  const rec = await db.deletionRequest.findUnique({ where: { userId: auth.user.id } })
  return ok({ request: rec ? { status: rec.status, requestedAt: rec.requestedAt, processedAt: rec.processedAt, note: rec.note } : null })
}

// POST /api/v1/privacy/deletion-request { reason? }
// PHASE 05 (ED-69): right to erasure — handled by ANONYMIZATION, never hard
// delete (clinical/financial aggregate duties). Admin processes in a workflow.
export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  const body = await req.json().catch(() => null)
  const reason = body?.reason ? String(body.reason).slice(0, 500) : null

  const res = await createDeletionRequest(auth.user.id, reason)
  if (!res.ok) return fail('درخواست حذف در جریان است', 409)

  await audit(req, auth.user.id, 'DELETION_REQUESTED', 'DeletionRequest', res.rec.id, null, { reason: reason ? 'provided' : 'none' })
  return ok({ request: { id: res.rec.id, status: res.rec.status, requestedAt: res.rec.requestedAt } })
}
