// ── BabaHakim Backend · Application Service: Auth (PHASE 08) ──────────────
// Ports the Phase-05 hardened flows (rate limits, MFA hook, consent capture,
// rotation family-kill) into the application layer unchanged in semantics.
import { db } from '@/lib/db'
import type { AuthContext } from '@/lib/auth'
import {
  verifyPassword, hashPassword, signAccessToken, issueRefreshToken, setAuthCookies,
  clearAuthCookies, revokeAllRefreshTokens, rotateRefreshToken, invalidateUserIdentity,
} from '@/lib/auth'
import { cookies } from 'next/headers'
import { rateLimit, LIMITS, resetRateLimit } from '@/lib/security/rate-limit'
import { requestOtp, verifyMfaChallenge, verifyOtp, OTP_PURPOSES, OTP_TTL_MS, OtpPurpose } from '@/lib/security/otp'
import { randomBytes } from 'crypto'
import { recordConsent } from '@/lib/security/privacy'
import { ROLE_PERMISSIONS } from '@/lib/constants'
import { setRefreshReuseDetector, getAuth } from '@/lib/auth'
import { AppError, NotFoundError, RateLimitError, ValidationError } from '@/server/core/errors'
import { writeAudit } from '@/server/infrastructure/audit'
import { publish, Events } from '@/server/infrastructure/events'
import type { RequestContext } from '@/server/core/context'
import type { z } from 'zod'
import type { loginSchema, registerSchema, otpRequestSchema, otpVerifySchema, passwordResetRequestSchema, passwordResetConfirmSchema } from '@/server/application/dto'
import { nationalIdHash, encryptNationalId, maskNationalId } from '@/lib/security/national-id'

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

// one message for every identity/password failure — never reveals whether a
// national ID or mobile exists, or that a mobile is shared by several accounts
const genericFail = 'نام کاربری (کد ملی) یا رمز عبور اشتباه است'

/** Audit-safe identifier: masked national ID / phone — the raw value never lands in AuditLog. */
function loginHint(input: { nationalId?: string; phone?: string }): string {
  if (input.nationalId) return `nid:${maskNationalId(input.nationalId)}`
  return `phone:${String(input.phone || '').slice(0, 4)}*****${String(input.phone || '').slice(-2)}`
}

/** Resolve the account for a login identifier. National ID is the patient
 *  username; a mobile resolves when exactly one live account uses it, or —
 *  on a shared mobile — to the single STAFF account on it. */
async function findLoginUser(input: { nationalId?: string; phone?: string }) {
  if (input.nationalId) {
    return db.user.findUnique({ where: { nationalIdHash: nationalIdHash(input.nationalId) } })
  }
  const matches = await db.user.findMany({ where: { phone: input.phone, deletedAt: null }, take: 20 })
  if (matches.length === 1) return matches[0]
  // a patient may register with any mobile — including a staff member's or a
  // pre-national-ID (legacy) relative's. Neither may be locked out by that:
  // on a shared mobile, phone login resolves to the ONE staff account, else
  // to the ONE account without a national ID; everyone else uses national ID.
  const staff = matches.filter((u) => u.role !== 'PATIENT')
  if (staff.length === 1) return staff[0]
  const legacy = matches.filter((u) => !u.nationalIdHash)
  return legacy.length === 1 ? legacy[0] : null
}

export async function login(ctx: RequestContext, input: z.infer<typeof loginSchema>) {
  const ipLimit = rateLimit(`login:ip:${ctx.ip}`, LIMITS.loginIp.limit, LIMITS.loginIp.windowMs)
  if (!ipLimit.allowed) {
    await writeAudit(ctx, { userId: null, action: 'LOGIN_RATE_LIMITED', entity: 'User', entityId: loginHint(input), newValues: { ip: ctx.ip } })
    throw new RateLimitError(undefined, { retryAfterSec: ipLimit.retryAfterSec })
  }

  const user = await findLoginUser(input)
  if (!user || user.deletedAt) {
    await writeAudit(ctx, { userId: null, action: 'LOGIN_FAILED', entity: 'User', entityId: loginHint(input), oldValues: { reason: 'not found or ambiguous' } })
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
    const challenge = await requestOtp(user.phone, 'LOGIN_MFA', ctx.ip, user.id)
    return { mfaRequired: true, challengeId: challenge.challengeId, expiresAt: challenge.expiresAt, devCode: challenge.devCode }
  }

  await db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } })
  invalidateUserIdentity(user.id) // ED-183: role/status may have changed since the cached entry
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

  // national ID is the patient identity (unique); the mobile may be shared by a family
  const nidHash = nationalIdHash(input.nationalId)
  const existing = await db.user.findUnique({ where: { nationalIdHash: nidHash }, select: { id: true } })
  if (existing) throw new AppError('CONFLICT', 'این کد ملی قبلاً ثبت شده است', 409)

  let user
  try {
    user = await db.user.create({
      data: {
        phone: input.phone, passwordHash: hashPassword(input.password),
        firstName: input.firstName, lastName: input.lastName,
        role: 'PATIENT',
        nationalIdHash: nidHash, nationalIdEnc: encryptNationalId(input.nationalId),
        // birth date wins when both are sent (age is then derived, not stored twice)
        birthDate: input.birthDate ?? null,
        ageYears: input.birthDate ? null : input.ageYears ?? null,
        ageRecordedAt: !input.birthDate && input.ageYears ? new Date() : null,
        gender: input.gender ?? null,
        referralCode: `BH${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 900 + 100)}`,
        ...(input.province || input.city
          ? { profile: { create: { province: input.province || null, city: input.city || null } } }
          : {}),
      },
    })
  } catch (e) {
    // concurrent registration with the same national ID lost the unique race
    if ((e as { code?: string }).code === 'P2002') throw new AppError('CONFLICT', 'این کد ملی قبلاً ثبت شده است', 409)
    throw e
  }

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
    invalidateUserIdentity(auth.user.id) // ED-183: identity cache dies with the session
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
    // the challenge is bound to one account (shared phones make phone lookup ambiguous)
    const user = res.userId ? await db.user.findUnique({ where: { id: res.userId } }) : null
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

// ── Account recovery (shared-phone safe) ─────────────────────────────────────
// The account is identified by national ID; the mobile on file must match.
// The OTP challenge is bound to that single account (OtpChallenge.userId), so
// two family members sharing one mobile can never reset each other's password.
// The response is identical whether or not the pair matched (no enumeration).

export async function requestPasswordReset(ctx: RequestContext, input: z.infer<typeof passwordResetRequestSchema>) {
  const rl = rateLimit(`pwreset:ip:${ctx.ip}`, LIMITS.otpRequest.limit, LIMITS.otpRequest.windowMs)
  if (!rl.allowed) throw new RateLimitError(undefined, { retryAfterSec: rl.retryAfterSec })

  const user = await db.user.findUnique({ where: { nationalIdHash: nationalIdHash(input.nationalId) } })
  const matches = !!user && user.isActive && !user.deletedAt && user.phone === input.phone
  if (matches) {
    const challenge = await requestOtp(user.phone, 'PASSWORD_RESET', ctx.ip, user.id)
    await writeAudit(ctx, { userId: user.id, action: 'PASSWORD_RESET_REQUESTED', entity: 'User', entityId: user.id })
    return {
      challengeId: challenge.challengeId, expiresAt: challenge.expiresAt,
      ...(challenge.devCode ? { devCode: challenge.devCode } : {}),
    }
  }
  await writeAudit(ctx, { userId: null, action: 'PASSWORD_RESET_NO_MATCH', entity: 'User', entityId: `nid:${maskNationalId(input.nationalId)}` })
  // decoy challenge id: same shape as a real one, verifies as not-found
  return { challengeId: `c${randomBytes(12).toString('hex')}`, expiresAt: new Date(Date.now() + OTP_TTL_MS) }
}

export async function confirmPasswordReset(ctx: RequestContext, input: z.infer<typeof passwordResetConfirmSchema>) {
  const rl = rateLimit(`pwreset:verify:${input.challengeId}`, LIMITS.otpVerify.limit, LIMITS.otpVerify.windowMs)
  if (!rl.allowed) throw new RateLimitError(undefined, { retryAfterSec: rl.retryAfterSec })

  const rec = await db.otpChallenge.findUnique({ where: { id: input.challengeId } })
  const fail = () => new AppError('AUTH_REQUIRED', 'کد نامعتبر یا منقضی است', 401)
  if (!rec || rec.purpose !== 'PASSWORD_RESET' || !rec.userId) throw fail()
  const res = await verifyOtp(rec.phone, 'PASSWORD_RESET', input.code, rec.id)
  if (!res.ok || res.userId !== rec.userId) {
    await writeAudit(ctx, { userId: rec.userId, action: 'PASSWORD_RESET_FAILED', entity: 'User', entityId: rec.userId, newValues: { reason: res.ok ? 'mismatch' : res.reason } })
    throw fail()
  }
  await db.user.update({
    where: { id: rec.userId },
    data: { passwordHash: hashPassword(input.newPassword), failedLogins: 0, lockedUntil: null },
  })
  await revokeAllRefreshTokens(rec.userId) // every existing session dies with the old password
  invalidateUserIdentity(rec.userId)
  await writeAudit(ctx, { userId: rec.userId, action: 'PASSWORD_RESET', entity: 'User', entityId: rec.userId })
  return { ok: true }
}
