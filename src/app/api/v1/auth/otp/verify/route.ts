import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, audit, getIP } from '@/lib/api'
import { rateLimit, rateLimited, LIMITS } from '@/lib/security/rate-limit'
import { verifyMfaChallenge, verifyOtp, OtpPurpose } from '@/lib/security/otp'
import { signAccessToken, issueRefreshToken, setAuthCookies } from '@/lib/auth'

// POST /api/v1/auth/otp/verify { phone?, challengeId?, purpose, code }
// PHASE 05 (ED-63): MFA step 2 / standalone verification.
// LOGIN_MFA: completing the challenge signs the user in (password already
// proven at step 1). Verification is single-use, max 5 attempts, 2min TTL.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body) return fail('درخواست نامعتبر')
  const phone = body.phone ? String(body.phone).replace(/\D/g, '') : null
  const challengeId = body.challengeId ? String(body.challengeId) : null
  const purpose = String(body.purpose || '') as OtpPurpose
  const code = String(body.code || '').replace(/\D/g, '')

  if (code.length !== 6) return fail('کد ۶ رقمی وارد کنید', 422)

  const key = phone || challengeId || 'unknown'
  const rl = rateLimit(`otp:verify:${key}`, LIMITS.otpVerify.limit, LIMITS.otpVerify.windowMs)
  if (!rl.allowed) return rateLimited(rl)

  const ip = await getIP(req)

  if (purpose === 'LOGIN_MFA') {
    if (!challengeId && !phone) return fail('شناسه چالش یا شماره موبایل لازم است', 422)
    const res = challengeId
      ? await verifyMfaChallenge(challengeId, code)
      : await verifyOtp(phone!, 'LOGIN_MFA', code)
    if (!res.ok) {
      await audit(req, null, 'OTP_VERIFY_FAILED', 'OtpChallenge', String(key), null, { reason: res.reason })
      return fail('کد نامعتبر یا منقضی است', 401)
    }
    const user = await db.user.findUnique({ where: { phone: (res as { phone?: string }).phone || phone! } })
    if (!user || !user.isActive || user.deletedAt) return fail('حساب غیرفعال است', 403)
    await db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } })
    const access = await signAccessToken({ id: user.id, phone: user.phone, role: user.role, firstName: user.firstName, lastName: user.lastName })
    const refresh = await issueRefreshToken(user.id)
    await setAuthCookies(access, refresh)
    await audit(req, user.id, 'LOGIN', 'User', user.id, null, { via: 'OTP_MFA' })
    return ok({ user: { id: user.id, phone: user.phone, firstName: user.firstName, lastName: user.lastName, role: user.role, referralCode: user.referralCode, profileComplete: user.profileComplete } })
  }

  // PASSWORD_RESET / PHONE_VERIFY: verification only — caller decides next step
  if (!phone) return fail('شماره موبایل لازم است', 422)
  const res = await verifyOtp(phone, purpose, code)
  if (!res.ok) {
    await audit(req, null, 'OTP_VERIFY_FAILED', 'OtpChallenge', phone, null, { reason: res.reason, purpose })
    return fail('کد نامعتبر یا منقضی است', 401)
  }
  await audit(req, res.userId || null, 'OTP_VERIFIED', 'OtpChallenge', phone, null, { purpose })
  return ok({ verified: true })
}
