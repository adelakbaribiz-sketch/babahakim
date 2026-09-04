import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, audit, getIP } from '@/lib/api'
import { verifyPassword, signAccessToken, issueRefreshToken, setAuthCookies } from '@/lib/auth'
import { rateLimit, rateLimited, LIMITS, resetRateLimit } from '@/lib/security/rate-limit'
import { requestOtp } from '@/lib/security/otp'

// POST /api/v1/auth/login — phone + password
// PHASE 05 hardening: per-IP spray limit + per-account limit (5), audit on lock,
// MFA hook: accounts with mfaEnabled receive an OTP challenge (password ok first).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body) return fail('درخواست نامعتبر')
  const phone = String(body.phone || '').replace(/[۰-۹]/g, (d: string) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/\D/g, '')
  const password = String(body.password || '')
  const ip = await getIP(req)

  // Layer 1: per-IP rate limit (credential spraying across many accounts)
  const ipLimit = rateLimit(`login:ip:${ip}`, LIMITS.loginIp.limit, LIMITS.loginIp.windowMs)
  if (!ipLimit.allowed) {
    await audit(req, null, 'LOGIN_RATE_LIMITED', 'User', phone, null, { ip })
    return rateLimited(ipLimit)
  }

  const user = await db.user.findUnique({ where: { phone } })
  if (!user || user.deletedAt) {
    await audit(req, null, 'LOGIN_FAILED', 'User', phone, null, { reason: 'not found' })
    return fail('شماره موبایل یا رمز عبور اشتباه است', 401)
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return fail('حساب شما موقتاً قفل شده است. کمی بعد تلاش کنید', 429)
  }
  if (!user.isActive) return fail('حساب شما غیرفعال است', 403)

  // Layer 2: per-IP+account window (5 tries / 5min) BEFORE password check
  const acctLimit = rateLimit(`login:acct:${user.id}`, LIMITS.login.limit, LIMITS.login.windowMs)
  if (!acctLimit.allowed) {
    await audit(req, user.id, 'LOGIN_RATE_LIMITED', 'User', user.id, null, { retryAfter: acctLimit.retryAfterSec })
    return rateLimited(acctLimit)
  }

  if (!verifyPassword(password, user.passwordHash)) {
    const failed = user.failedLogins + 1
    await db.user.update({
      where: { id: user.id },
      data: { failedLogins: failed, lockedUntil: failed >= 5 ? new Date(Date.now() + 10 * 60000) : null },
    })
    await audit(req, user.id, 'LOGIN_FAILED', 'User', user.id, null, { attempts: failed })
    return fail('شماره موبایل یا رمز عبور اشتباه است', 401)
  }

  // ── MFA hook (ED-63): password verified, but account opted into OTP ──
  if (user.mfaEnabled) {
    const challenge = await requestOtp(user.phone, 'LOGIN_MFA', ip)
    return ok({ mfaRequired: true, challengeId: challenge.challengeId, expiresAt: challenge.expiresAt, devCode: challenge.devCode })
  }

  await db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } })
  resetRateLimit(`login:acct:${user.id}`) // forgive honest users
  const access = await signAccessToken({ id: user.id, phone: user.phone, role: user.role, firstName: user.firstName, lastName: user.lastName })
  const refresh = await issueRefreshToken(user.id)
  await setAuthCookies(access, refresh)
  await audit(req, user.id, 'LOGIN', 'User', user.id)

  return ok({
    user: { id: user.id, phone: user.phone, firstName: user.firstName, lastName: user.lastName, role: user.role, referralCode: user.referralCode, profileComplete: user.profileComplete },
  })
}
