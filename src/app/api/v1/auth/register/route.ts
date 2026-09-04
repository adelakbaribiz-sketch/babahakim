import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, audit, getIP } from '@/lib/api'
import { hashPassword, signAccessToken, issueRefreshToken, setAuthCookies } from '@/lib/auth'
import { rateLimit, rateLimited, LIMITS } from '@/lib/security/rate-limit'
import { recordConsent } from '@/lib/security/privacy'

// POST /api/v1/auth/register — patient self-registration (PHASE 05 rebuild)
// Hardening: input validation (phone/password policy), per-IP rate limit,
// optional terms/privacy acceptance recorded as versioned consent (ED-67).
const PHONE_RE = /^09\d{9}$/

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body) return fail('درخواست نامعتبر')

  const phone = String(body.phone || '').replace(/[۰-۹]/g, (d: string) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/\D/g, '')
  const password = String(body.password || '')
  const firstName = String(body.firstName || '').trim().slice(0, 100)
  const lastName = String(body.lastName || '').trim().slice(0, 100)
  const referredByCode = body.referralCode ? String(body.referralCode).trim().slice(0, 24) : null
  const acceptTerms = Boolean(body.acceptTerms)

  if (!PHONE_RE.test(phone)) return fail('شماره موبایل معتبر نیست (۰۹xxxxxxxxx)', 422)
  if (password.length < 8) return fail('رمز عبور باید حداقل ۸ کاراکتر باشد', 422)
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return fail('رمز عبور باید شامل حرف و رقم باشد', 422)
  if (!firstName || !lastName) return fail('نام و نام خانوادگی الزامی است', 422)

  const ip = await getIP(req)
  const rl = rateLimit(`register:${ip}`, 5, 3600_000) // 5 registrations/hour per IP
  if (!rl.allowed) return rateLimited(rl)

  const existing = await db.user.findFirst({ where: { phone, deletedAt: null } })
  if (existing) return fail('این شماره موبایل قبلاً ثبت شده است', 409)

  const user = await db.user.create({
    data: {
      phone,
      passwordHash: hashPassword(password),
      firstName,
      lastName,
      role: 'PATIENT',
      referralCode: `BH${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 900 + 100)}`,
    },
  })

  // optional referral linkage
  if (referredByCode) {
    const referrer = await db.user.findFirst({ where: { referralCode: referredByCode } })
    if (referrer && referrer.id !== user.id) {
      await db.user.update({ where: { id: user.id }, data: { referredById: referrer.id } })
      await db.referral.create({ data: { referrerId: referrer.id, referredUserId: user.id } }).catch(() => {})
    }
  }

  // terms/privacy acceptance captured at registration when provided (ED-67)
  if (acceptTerms) {
    await recordConsent(user.id, 'TERMS', ip, 'Web')
    await recordConsent(user.id, 'PRIVACY', ip, 'Web')
    await recordConsent(user.id, 'DATA_PROCESSING', ip, 'Web')
  }

  const access = await signAccessToken({ id: user.id, phone: user.phone, role: user.role, firstName: user.firstName, lastName: user.lastName })
  const refresh = await issueRefreshToken(user.id)
  await setAuthCookies(access, refresh)
  await audit(req, user.id, 'REGISTER', 'User', user.id, null, { acceptTerms })

  return ok({
    user: { id: user.id, phone: user.phone, firstName: user.firstName, lastName: user.lastName, role: user.role, referralCode: user.referralCode, profileComplete: false },
  })
}
