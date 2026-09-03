import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { rotateRefreshToken, signAccessToken, setAuthCookies } from '@/lib/auth'

// POST /api/v1/auth/refresh — refresh token rotation
export async function POST() {
  const store = await cookies()
  const raw = store.get('ta_refresh')?.value
  if (!raw) return fail('نشست منقضی شده است', 401)
  const rotated = await rotateRefreshToken(raw)
  if (!rotated) return fail('نشست منقضی شده است', 401)
  const user = await db.user.findUnique({ where: { id: rotated.userId } })
  if (!user || !user.isActive || user.deletedAt) return fail('حساب غیرفعال است', 403)
  const access = await signAccessToken({ id: user.id, phone: user.phone, role: user.role, firstName: user.firstName, lastName: user.lastName })
  await setAuthCookies(access, rotated.raw)
  return ok({ user: { id: user.id, role: user.role } })
}
