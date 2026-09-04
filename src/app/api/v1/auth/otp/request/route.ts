import { NextRequest } from 'next/server'
import { ok, fail, audit, getIP } from '@/lib/api'
import { rateLimit, rateLimited, LIMITS } from '@/lib/security/rate-limit'
import { requestOtp, OTP_PURPOSES, OtpPurpose } from '@/lib/security/otp'

// POST /api/v1/auth/otp/request { phone, purpose }
// PHASE 05 (ED-63): OTP send endpoint — rate-limited 3/10min per phone.
// Delivery channel: SMS provider port (Kavenegar in prod, log in dev).
// devCode is returned ONLY in non-production for local testing.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body) return fail('درخواست نامعتبر')
  const phone = String(body.phone || '').replace(/[۰-۹]/g, (d: string) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/\D/g, '')
  const purpose = String(body.purpose || '') as OtpPurpose

  if (phone.length < 10 || phone.length > 15) return fail('شماره موبایل نامعتبر است', 422)
  if (!OTP_PURPOSES.includes(purpose)) return fail('نوع کد یک‌بارمصرف نامعتبر است', 422)

  const ip = await getIP(req)
  const rl = rateLimit(`otp:send:${phone}`, LIMITS.otpRequest.limit, LIMITS.otpRequest.windowMs)
  if (!rl.allowed) {
    await audit(req, null, 'OTP_RATE_LIMITED', 'OtpChallenge', phone, null, { purpose })
    return rateLimited(rl, 'درخواست کد بیش از حد مجاز؛ کمی بعد تلاش کنید')
  }

  const challenge = await requestOtp(phone, purpose, ip)
  await audit(req, null, 'OTP_REQUESTED', 'OtpChallenge', phone, null, { purpose, challengeId: challenge.challengeId })
  return ok({
    challengeId: challenge.challengeId,
    expiresAt: challenge.expiresAt,
    ...(challenge.devCode ? { devCode: challenge.devCode } : {}),
  })
}
