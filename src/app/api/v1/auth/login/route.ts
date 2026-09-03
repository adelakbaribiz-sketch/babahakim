import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, audit } from '@/lib/api'
import { verifyPassword, signAccessToken, issueRefreshToken, setAuthCookies } from '@/lib/auth'

// POST /api/v1/auth/login — phone + password (brute-force protected)
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body) return fail('درخواست نامعتبر')
  const phone = String(body.phone || '').replace(/[۰-۹]/g, (d: string) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/\D/g, '')
  const password = String(body.password || '')

  const user = await db.user.findUnique({ where: { phone } })
  if (!user || user.deletedAt) {
    await audit(req, null, 'LOGIN_FAILED', 'User', phone, null, { reason: 'not found' })
    return fail('شماره موبایل یا رمز عبور اشتباه است', 401)
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return fail('حساب شما موقتاً قفل شده است. کمی بعد تلاش کنید', 429)
  }
  if (!user.isActive) return fail('حساب شما غیرفعال است', 403)

  if (!verifyPassword(password, user.passwordHash)) {
    const failed = user.failedLogins + 1
    await db.user.update({
      where: { id: user.id },
      data: { failedLogins: failed, lockedUntil: failed >= 5 ? new Date(Date.now() + 10 * 60000) : null },
    })
    await audit(req, user.id, 'LOGIN_FAILED', 'User', user.id, null, { attempts: failed })
    return fail('شماره موبایل یا رمز عبور اشتباه است', 401)
  }

  await db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } })
  const access = await signAccessToken({ id: user.id, phone: user.phone, role: user.role, firstName: user.firstName, lastName: user.lastName })
  const refresh = await issueRefreshToken(user.id)
  await setAuthCookies(access, refresh)
  await audit(req, user.id, 'LOGIN', 'User', user.id)

  return ok({
    user: { id: user.id, phone: user.phone, firstName: user.firstName, lastName: user.lastName, role: user.role, referralCode: user.referralCode, profileComplete: user.profileComplete },
  })
}
