// PHASE 05 — OTP/MFA architecture (ED-63).
//
// Lifecycle: request -> SMS -> verify (single-use, 2min TTL, 5 attempts,
// hashed storage). Send-rate: 3 per phone / 10min. Purposes: LOGIN_MFA,
// PASSWORD_RESET, PHONE_VERIFY. Provider port keeps Kavenegar pluggable.
//
// The OTP code is NEVER stored plaintext (sha256 with per-challenge salt);
// delivery logs go through the SMS pipeline (notifications context).
import { createHash, randomInt, randomBytes, timingSafeEqual } from 'crypto'
import { db } from '@/lib/db'

export const OTP_TTL_MS = 2 * 60_000
export const OTP_MAX_ATTEMPTS = 5
export const OTP_LENGTH = 6

export type OtpPurpose = 'LOGIN_MFA' | 'PASSWORD_RESET' | 'PHONE_VERIFY'
export const OTP_PURPOSES: OtpPurpose[] = ['LOGIN_MFA', 'PASSWORD_RESET', 'PHONE_VERIFY']

export interface OtpSendResult {
  ok: boolean
  challengeId: string
  expiresAt: Date
  devCode?: string // exposed ONLY in non-production for local testing
  reason?: string
}

function hashCode(challengeSalt: string, code: string): string {
  return createHash('sha256').update(`${challengeSalt}:${code}`).digest('hex')
}

/** Provider port — Kavenegar adapter in prod; log adapter in dev. */
export interface OtpSmsSender {
  send(phone: string, message: string): Promise<{ ok: boolean; providerId?: string; error?: string }>
}

const logSender: OtpSmsSender = {
  async send(phone, message) {
    console.info(`[OTP:DEV] -> ${phone}: ${message}`)
    return { ok: true }
  },
}

export function getOtpSender(): OtpSmsSender {
  // Production: Kavenegar adapter via env-configured API key (ADR-0009 port style)
  return (globalThis as Record<string, unknown>).__otpSender as OtpSmsSender || logSender
}

export function setOtpSender(sender: OtpSmsSender) {
  ;(globalThis as Record<string, unknown>).__otpSender = sender
}

export async function requestOtp(
  phone: string,
  purpose: OtpPurpose,
  ip: string | null,
): Promise<OtpSendResult> {
  // kill previous live challenges for this phone+purpose (latest wins)
  await db.otpChallenge.updateMany({
    where: { phone, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date() },
  })
  const code = String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0')
  const salt = randomBytes(16).toString('hex')
  const expiresAt = new Date(Date.now() + OTP_TTL_MS)
  const rec = await db.otpChallenge.create({
    data: { phone, purpose, codeHash: `${salt}:${hashCode(salt, code)}`, expiresAt, ip },
  })
  const message = `باباحکیم | کد تأیید شما: ${code} — ${'۲ دقیقه اعتبار دارد'}`
  await getOtpSender().send(phone, message)
  const res: OtpSendResult = { ok: true, challengeId: rec.id, expiresAt }
  if (process.env.NODE_ENV !== 'production') res.devCode = code
  return res
}

export type OtpVerifyResult =
  | { ok: true; userId?: string }
  | { ok: false; reason: 'NOT_FOUND' | 'EXPIRED' | 'CONSUMED' | 'TOO_MANY_ATTEMPTS' | 'WRONG' }

export async function verifyOtp(phone: string, purpose: OtpPurpose, code: string): Promise<OtpVerifyResult> {
  const rec = await db.otpChallenge.findFirst({
    where: { phone, purpose, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  })
  if (!rec) return { ok: false, reason: 'NOT_FOUND' }
  if (rec.expiresAt < new Date()) return { ok: false, reason: 'EXPIRED' }
  if (rec.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, reason: 'TOO_MANY_ATTEMPTS' }

  const [salt, digest] = rec.codeHash.split(':')
  const expect = Buffer.from(digest, 'hex')
  const got = Buffer.from(hashCode(salt, code), 'hex')
  const good = expect.length === got.length && timingSafeEqual(expect, got)

  if (!good) {
    await db.otpChallenge.update({ where: { id: rec.id }, data: { attempts: rec.attempts + 1 } })
    return { ok: false, reason: 'WRONG' }
  }
  await db.otpChallenge.update({ where: { id: rec.id }, data: { consumedAt: new Date() } })
  const user = await db.user.findUnique({ where: { phone }, select: { id: true } })
  return { ok: true, userId: user?.id }
}

/** MFA login step 2: challenge id issued at step 1 (password already verified). */
export async function verifyMfaChallenge(challengeId: string, code: string): Promise<OtpVerifyResult & { phone?: string }> {
  const rec = await db.otpChallenge.findUnique({ where: { id: challengeId } })
  if (!rec || rec.purpose !== 'LOGIN_MFA') return { ok: false, reason: 'NOT_FOUND' }
  if (rec.consumedAt) return { ok: false, reason: 'CONSUMED' }
  const res = await verifyOtp(rec.phone, 'LOGIN_MFA', code)
  return { ...res, phone: rec.phone }
}
