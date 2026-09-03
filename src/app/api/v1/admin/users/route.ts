import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, audit, textMatches } from '@/lib/api'
import { getAuth } from '@/lib/auth'

// GET /api/v1/admin/users?q=&role=
export async function GET(req: NextRequest) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  if (!['ADMIN'].includes(auth.user.role)) return fail('دسترسی غیرمجاز', 403)
  const url = new URL(req.url)
  const q = url.searchParams.get('q') || ''
  const role = url.searchParams.get('role') || ''
  const users = await db.user.findMany({
    where: { deletedAt: null, ...(role ? { role } : {}) },
    include: { profile: true, referralsReceived: { include: { referrer: { select: { firstName: true, lastName: true, referralCode: true } } } } },
    orderBy: { createdAt: 'desc' },
  })
  let filtered = users
  if (q) filtered = users.filter((u) => textMatches(q, u.firstName, u.lastName, u.phone, u.email, u.role))
  return ok({
    users: filtered.map((u) => ({
      id: u.id, firstName: u.firstName, lastName: u.lastName, phone: u.phone, email: u.email, role: u.role,
      isActive: u.isActive, referralCode: u.referralCode, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt,
      profileComplete: u.profileComplete, profile: u.profile,
      referredBy: u.referralsReceived[0]?.referrer || null,
      caseCount: 0,
    })),
  })
}

// PATCH /api/v1/admin/users — activate/deactivate/role change
export async function PATCH(req: NextRequest) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  if (!['ADMIN'].includes(auth.user.role)) return fail('دسترسی غیرمجاز', 403)
  const body = await req.json().catch(() => ({}))
  const user = await db.user.findUnique({ where: { id: String(body.id || '') } })
  if (!user) return fail('کاربر یافت نشد', 404)
  const data: Record<string, unknown> = {}
  if (body.isActive !== undefined) data.isActive = Boolean(body.isActive)
  if (body.role && ['ADMIN', 'EXPERT_1', 'EXPERT_2', 'OPERATOR', 'DOCTOR', 'PATIENT'].includes(body.role)) data.role = body.role
  if (body.deleted !== undefined && body.deleted) data.deletedAt = new Date()
  await db.user.update({ where: { id: user.id }, data })
  await audit(req, auth.user.id, 'EDIT_USER', 'User', user.id, { role: user.role, isActive: user.isActive }, data)
  return ok()
}
