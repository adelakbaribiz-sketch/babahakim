import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, textMatches, parseJSON } from '@/lib/api'
import { getAuth } from '@/lib/auth'

// GET /api/v1/admin/audit-logs?q=&action=
export async function GET(req: NextRequest) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  if (!['ADMIN'].includes(auth.user.role)) return fail('دسترسی غیرمجاز', 403)
  const url = new URL(req.url)
  const q = url.searchParams.get('q') || ''
  const action = url.searchParams.get('action') || ''
  const logs = await db.auditLog.findMany({
    where: { ...(action ? { action } : {}) },
    orderBy: { createdAt: 'desc' }, take: 300,
    include: { user: { select: { firstName: true, lastName: true, role: true, phone: true } } },
  })
  let filtered = logs
  if (q) filtered = logs.filter((l) => textMatches(q, l.action, l.entity, l.entityId, l.user?.firstName, l.user?.lastName, l.ip))
  return ok({ logs: filtered.map((l) => ({ ...l, oldValues: parseJSON(l.oldValues, null), newValues: parseJSON(l.newValues, null) })) })
}
