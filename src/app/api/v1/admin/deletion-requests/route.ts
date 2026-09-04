import { NextRequest } from 'next/server'
import { fail, ok, audit } from '@/lib/api'
import { requirePermission } from '@/lib/api'
import { db } from '@/lib/db'
import { anonymizeUser } from '@/lib/security/privacy'

// GET /api/v1/admin/deletion-requests?status=PENDING — queue for admin
export async function GET(req: NextRequest) {
  const guard = await requirePermission('manage_users')
  if ('error' in guard) return guard.error
  const url = new URL(req.url)
  const status = url.searchParams.get('status') || 'PENDING'
  const rows = await db.deletionRequest.findMany({
    where: status === 'ALL' ? {} : { status },
    orderBy: { requestedAt: 'desc' },
    take: 100,
  })
  const withUsers = await Promise.all(rows.map(async (r) => {
    const u = await db.user.findUnique({ where: { id: r.userId }, select: { firstName: true, lastName: true, phone: true, createdAt: true } })
    return { ...r, user: u }
  }))
  return ok({ requests: withUsers })
}

// PATCH /api/v1/admin/deletion-requests { requestId, action: 'ANONYMIZE' | 'REJECT', note? }
// ANONYMIZE executes the irreversible PII strip (ED-69). REJECT keeps data with a reason.
export async function PATCH(req: NextRequest) {
  const guard = await requirePermission('manage_users')
  if ('error' in guard) return guard.error
  const body = await req.json().catch(() => null)
  const requestId = String(body?.requestId || '')
  const action = String(body?.action || '')
  const note = body?.note ? String(body.note).slice(0, 500) : null
  if (!requestId || !['ANONYMIZE', 'REJECT'].includes(action)) return fail('پارامترهای نامعتبر', 422)

  const rec = await db.deletionRequest.findUnique({ where: { id: requestId } })
  if (!rec || !['PENDING', 'PROCESSING'].includes(rec.status)) return fail('درخواست قابل پردازش نیست', 409)

  if (action === 'REJECT') {
    await db.deletionRequest.update({ where: { id: rec.id }, data: { status: 'REJECTED', processedAt: new Date(), processedById: guard.auth.user.id, note } })
    await audit(req, guard.auth.user.id, 'DELETION_REJECTED', 'DeletionRequest', rec.id, null, { note })
    return ok({ status: 'REJECTED' })
  }

  const result = await anonymizeUser(rec.userId, guard.auth.user.id)
  await audit(req, guard.auth.user.id, 'DELETION_ANONYMIZED', 'DeletionRequest', rec.id, null, { fields: result.anonymized })
  return ok({ status: 'COMPLETED', anonymized: result.anonymized })
}
