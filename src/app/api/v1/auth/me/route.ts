import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { getAuth } from '@/lib/auth'
import { ROLE_PERMISSIONS } from '@/lib/constants'

// GET /api/v1/auth/me
export async function GET(req: NextRequest) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  const user = await db.user.findUnique({ where: { id: auth.user.id }, include: { profile: true } })
  if (!user) return fail('کاربر یافت نشد', 404)
  const perms = user.role === 'ADMIN' ? ROLE_PERMISSIONS.ADMIN : (ROLE_PERMISSIONS as Record<string, string[]>)[user.role] || []
  return ok({
    user: {
      id: user.id, phone: user.phone, email: user.email, firstName: user.firstName, lastName: user.lastName,
      role: user.role, referralCode: user.referralCode, profileComplete: user.profileComplete,
      profile: user.profile, createdAt: user.createdAt,
    },
    permissions: perms,
  })
}
