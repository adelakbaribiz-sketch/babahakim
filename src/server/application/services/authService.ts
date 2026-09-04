// ── BabaHakim Backend · Application Service: Auth (PHASE 08) ──────────────
// Ports the Phase-05 hardened flows (rate limits, MFA hook, consent capture,
// rotation family-kill) into the application layer unchanged in semantics.
import { db } from '@/lib/db'
import type { AuthContext } from '@/lib/auth'
import {
  verifyPassword, hashPassword, signAccessToken, issueRefreshToken, setAuthCookies,
  clearAuthCookies, revokeAllRefreshTokens, rotateRefreshToken,
} from '@/lib/auth'
import { cookies } from 'next/headers'
import { rateLimit, LIMITS, resetRateLimit } from '@/lib/security/rate-limit'
import { requestOtp, verifyMfaChallenge, verifyOtp, OTP_PURPOSES, OtpPurpose } from '@/lib/security/otp'
import { recordConsent } from '@/lib/security/privacy'
import { ROLE_PERMISSIONS } from '@/lib/constants'
import { setRefreshReuseDetector, getAuth } from '@/lib/auth'
import { AppError, NotFoundError, RateLimitError, ValidationError } from '@/server/core/errors'
import { writeAudit } from '@/server/infrastructure/audit'
import { publish, Events } from '@/server/infrastructure/events'
import type { RequestContext } from '@/server/core/context'
import type { z } from 'zod'
import type { loginSchema, registerSchema, otpRequestSchema, otpVerifySchema } from '@/server/application/dto'

// reuse-detection side effect (ED-64): presenting an already-rotated token
// revokes the whole family — the event is audited via the system stream.
setRefreshReuseDetector(async (userId, tokenHash) => {
  try {
    await db.auditLog.create({
      data: {
        userId, action: 'REFRESH_REUSE_DETECTED', entity: 'RefreshToken', entityId: tokenHash.slice(0, 12),
        oldValues: null, newValues: JSON.stringify({ hint: 'token-family revoked' }),
        ip: 'system', device: 'System', sensitive: true,
      },
    })
  } catch { /* best-effort */ }
})

const genericFail = 'شماره موبایل یا رمز عبور اشتباه است'

export async function login(ctx: RequestContext, input: z.infer<typeof loginSchema>) {
  const ipLimit = rateLimit(`login:ip:${ctx.ip}`, LIMITS.loginIp.limit, LIMITS.loginIp.windowMs)
  if (!ipLimit.allowed) {
    await writeAudit(ctx, { userId: null, action: 'LOGIN_RATE_LIMITED', entity: 'User', entityId: input.phone, newValues: { ip: ctx.ip } })
    throw new RateLimitError(undefined, { retryAfterSec: ipLimit.retryAfterSec })
  }

  const user = await db.user.findUnique({ where: { phone: input.phone } })
  if (!user || user.deletedAt) {
    await writeAudit(ctx, { userId: null, action: 'LOGIN_FAILED', entity: 'User', entityId: input.phone, oldValues: { reason: 'not found' } })
    throw new AppError('AUTH_REQUIRED', genericFail, 401)
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError('RATE_LIMITED', 'حساب شما موقتاً قفل شده است. کمی بعد تلاش کنید', 429)
  }
  if (!user.isActive) throw new AppError('FORBIDDEN', 'حساب شما غیرفعال است', 403)

  const acctLimit = rateLimit(`login:acct:${user.id}`, LIMITS.login.limit, LIMITS.login.windowMs)
  if (!acctLimit.allowed) {
    await writeAudit(ctx, { userId: user.id, action: 'LOGIN_RATE_LIMITED', entity: 'User', entityId: user.id, newValues: { retryAfter: acctLimit.retryAfterSec } })
    throw new RateLimitError(undefined, { retryAfterSec: acctLimit.retryAfterSec })
  }

  if (!verifyPassword(input.password, user.passwordHash)) {
    const failed = user.failedLogins + 1
    await db.user.update({
      where: { id: user.id },
      data: { failedLogins: failed, lockedUntil: failed >= 5 ? new Date(Date.now() + 10 * 60000) : null },
    })
    await writeAudit(ctx, { userId: user.id, action: 'LOGIN_FAILED', entity: 'User', entityId: user.id, newValues: { attempts: failed } })
    throw new AppError('AUTH_REQUIRED', genericFail, 401)
  }

  // MFA hook (ED-63): password proven, account opted into OTP
  if (user.mfaEnabled) {
    const challenge = await requestOtp(user.phone, 'LOGIN_MFA', ctx.ip)
    return { mfaRequired: true, challengeId: challenge.challengeId, expiresAt: challenge.expiresAt, devCode: challenge.devCode }
  }

  await db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } })
  resetRateLimit(`login:acct:${user.id}`)
  const access = await signAccessToken({ id: user.id, phone: user.phone, role: user.role, firstName: user.firstName, lastName: user.lastName })
  const refresh = await issueRefreshToken(user.id)
  await setAuthCookies(access, refresh)
  await writeAudit(ctx, { userId: user.id, action: 'LOGIN', entity: 'User', entityId: user.id })
  await publish(Events.UserLogin, { userId: user.id }, ctx.reqId)

  // PHASE 09 (S1): permissions at session start — client permission-aware UI needs
  // the authoritative set without a second /me round-trip (ED-108).
  const perms = user.role === 'ADMIN' ? ROLE_PERMISSIONS.ADMIN : (ROLE_PERMISSIONS as Record<string, string[]>)[user.role] || []
  return {
    user: { id: user.id, phone: user.phone, firstName: user.firstName, lastName: user.lastName, role: user.role, referralCode: user.referralCode, profileComplete: user.profileComplete },
    permissions: perms,
  }
}

export async function register(ctx: RequestContext, input: z.infer<typeof registerSchema>) {
  const rl = rateLimit(`register:${ctx.ip}`, 5, 3600_000)
  if (!rl.allowed) throw new RateLimitError(undefined, { retryAfterSec: rl.retryAfterSec })

  const existing = await db.user.findFirst({ where: { phone: input.phone, deletedAt: null } })
  if (existing) throw new AppError('CONFLICT', 'این شماره موبایل قبلاً ثبت شده است', 409)

  const user = await db.user.create({
    data: {
      phone: input.phone, passwordHash: hashPassword(input.password),
      firstName: input.firstName, lastName: input.lastName,
      role: 'PATIENT',
      referralCode: `BH${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 900 + 100)}`,
    },
  })

  // optional referral linkage
  if (input.referralCode) {
    const referrer = await db.user.findFirst({ where: { referralCode: input.referralCode } })
    if (referrer && referrer.id !== user.id) {
      await db.user.update({ where: { id: user.id }, data: { referredById: referrer.id } })
      await db.referral.create({ data: { referrerId: referrer.id, referredUserId: user.id } }).catch(() => {})
    }
  }

  if (input.acceptTerms) {
    await recordConsent(user.id, 'TERMS', ctx.ip, ctx.device)
    await recordConsent(user.id, 'PRIVACY', ctx.ip, ctx.device)
    await recordConsent(user.id, 'DATA_PROCESSING', ctx.ip, ctx.device)
  }

  const access = await signAccessToken({ id: user.id, phone: user.phone, role: user.role, firstName: user.firstName, lastName: user.lastName })
  const refresh = await issueRefreshToken(user.id)
  await setAuthCookies(access, refresh)
  await writeAudit(ctx, { userId: user.id, action: 'REGISTER', entity: 'User', entityId: user.id, newValues: { acceptTerms: input.acceptTerms } })
  await publish(Events.UserRegistered, user.id, ctx.reqId)

  // PHASE 09 (S1): register also returns permissions (patient ⇒ [] by design).
  return {
    user: { id: user.id, phone: user.phone, firstName: user.firstName, lastName: user.lastName, role: user.role, referralCode: user.referralCode, profileComplete: false },
    permissions: [] as string[],
  }
}

export async function me(auth: AuthContext) {
  const user = await db.user.findUnique({ where: { id: auth.user.id }, include: { profile: true } })
  if (!user) throw new NotFoundError('کاربر یافت نشد')
  const perms = user.role === 'ADMIN' ? ROLE_PERMISSIONS.ADMIN : (ROLE_PERMISSIONS as Record<string, string[]>)[user.role] || []
  return {
    user: {
      id: user.id, phone: user.phone, email: user.email, firstName: user.firstName, lastName: user.lastName,
      role: user.role, referralCode: user.referralCode, profileComplete: user.profileComplete,
      profile: user.profile, createdAt: user.createdAt,
    },
    permissions: perms,
  }
}

export async function logout(auth: AuthContext | null, ctx: RequestContext) {
  if (auth) {
    await revokeAllRefreshTokens(auth.user.id)
    await writeAudit(ctx, { userId: auth.user.id, action: 'LOGOUT', entity: 'User', entityId: auth.user.id })
  }
  await clearAuthCookies()
  return { ok: true }
}

/** Route helper — resolves the current session, then logs it out. */
export async function logoutCurrent(ctx: RequestContext) {
  const auth = await getAuth()
  return logout(auth, ctx)
}

export async function refresh(ctx: RequestContext) {
  const rl = rateLimit(`refresh:${ctx.ip}`, LIMITS.refresh.limit, LIMITS.refresh.windowMs)
  if (!rl.allowed) throw new RateLimitError(undefined, { retryAfterSec: rl.retryAfterSec })

  const store = await cookies()
  const raw = store.get('ta_refresh')?.value
  if (!raw) throw new AppError('AUTH_REQUIRED', 'نشست منقضی شده است', 401)
  const rotated = await rotateRefreshToken(raw)
  if (!rotated) {
    await writeAudit(ctx, { userId: null, action: 'REFRESH_REJECTED', entity: 'RefreshToken', newValues: { ip: ctx.ip } })
    throw new AppError('AUTH_REQUIRED', 'نشست منقضی شده است', 401)
  }
  const user = await db.user.findUnique({ where: { id: rotated.userId } })
  if (!user || !user.isActive || user.deletedAt) throw new AppError('FORBIDDEN', 'حساب غیرفعال است', 403)
  const access = await signAccessToken({ id: user.id, phone: user.phone, role: user.role, firstName: user.firstName, lastName: user.lastName })
  await setAuthCookies(access, rotated.raw)
  return { user: { id: user.id, role: user.role } }
}

export async function requestOtpChallenge(ctx: RequestContext, rawPhone: string, purpose: string) {
  // normalize Persian/Arabic digits → plain digits (same rule as login/register)
  const phone = rawPhone.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/\D/g, '')
  if (phone.length < 10 || phone.length > 15) throw new AppError('BUSINESS_RULE', 'شماره موبایل نامعتبر است', 422)
  if (!OTP_PURPOSES.includes(purpose as OtpPurpose)) throw new AppError('BUSINESS_RULE', 'نوع کد یک‌بارمصرف نامعتبر است', 422)

  const rl = rateLimit(`otp:send:${phone}`, LIMITS.otpRequest.limit, LIMITS.otpRequest.windowMs)
  if (!rl.allowed) {
    await writeAudit(ctx, { userId: null, action: 'OTP_RATE_LIMITED', entity: 'OtpChallenge', entityId: phone, newValues: { purpose } })
    throw new RateLimitError('درخواست کد بیش از حد مجاز؛ کمی بعد تلاش کنید', { retryAfterSec: rl.retryAfterSec })
  }

  const challenge = await requestOtp(phone, purpose as OtpPurpose, ctx.ip)
  await writeAudit(ctx, { userId: null, action: 'OTP_REQUESTED', entity: 'OtpChallenge', entityId: phone, newValues: { purpose, challengeId: challenge.challengeId } })
  return {
    challengeId: challenge.challengeId, expiresAt: challenge.expiresAt,
    ...(challenge.devCode ? { devCode: challenge.devCode } : {}),
  }
}

export async function verifyOtpChallenge(ctx: RequestContext, input: {
  phone?: string; challengeId?: string; purpose: string; code: string
}) {
  const code = input.code.replace(/\D/g, '')
  if (code.length !== 6) throw new AppError('BUSINESS_RULE', 'کد ۶ رقمی وارد کنید', 422)

  const key = input.phone || input.challengeId || 'unknown'
  const rl = rateLimit(`otp:verify:${key}`, LIMITS.otpVerify.limit, LIMITS.otpVerify.windowMs)
  if (!rl.allowed) throw new RateLimitError(undefined, { retryAfterSec: rl.retryAfterSec })

  if (input.purpose === 'LOGIN_MFA') {
    if (!input.challengeId && !input.phone) throw new AppError('BUSINESS_RULE', 'شناسه چالش یا شماره موبایل لازم است', 422)
    const res = input.challengeId
      ? await verifyMfaChallenge(input.challengeId, code)
      : await verifyOtp(input.phone!, 'LOGIN_MFA', code)
    if (!res.ok) {
      await writeAudit(ctx, { userId: null, action: 'OTP_VERIFY_FAILED', entity: 'OtpChallenge', entityId: String(key), newValues: { reason: res.reason } })
      throw new AppError('AUTH_REQUIRED', 'کد نامعتبر یا منقضی است', 401)
    }
    const user = await db.user.findUnique({ where: { phone: (res as { phone?: string }).phone || input.phone! } })
    if (!user || !user.isActive || user.deletedAt) throw new AppError('FORBIDDEN', 'حساب غیرفعال است', 403)
    await db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } })
    const access = await signAccessToken({ id: user.id, phone: user.phone, role: user.role, firstName: user.firstName, lastName: user.lastName })
    const refresh = await issueRefreshToken(user.id)
    await setAuthCookies(access, refresh)
    await writeAudit(ctx, { userId: user.id, action: 'LOGIN', entity: 'User', entityId: user.id, newValues: { via: 'OTP_MFA' } })
    return {
      user: { id: user.id, phone: user.phone, firstName: user.firstName, lastName: user.lastName, role: user.role, referralCode: user.referralCode, profileComplete: user.profileComplete },
    }
  }

  if (!input.phone) throw new AppError('BUSINESS_RULE', 'شماره موبایل لازم است', 422)
  const res = await verifyOtp(input.phone, input.purpose as OtpPurpose, code)
  if (!res.ok) {
    await writeAudit(ctx, { userId: null, action: 'OTP_VERIFY_FAILED', entity: 'OtpChallenge', entityId: input.phone, newValues: { reason: res.reason, purpose: input.purpose } })
    throw new AppError('AUTH_REQUIRED', 'کد نامعتبر یا منقضی است', 401)
  }
  await writeAudit(ctx, { userId: res.userId || null, action: 'OTP_VERIFIED', entity: 'OtpChallenge', entityId: input.phone, newValues: { purpose: input.purpose } })
  return { verified: true }
}

export { ValidationError }
