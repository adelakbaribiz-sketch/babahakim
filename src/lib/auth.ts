// Authentication: scrypt password hashing + JWT (jose) + refresh token rotation
// PHASE 05: secrets from env (fail-fast in prod), rotation-chain + reuse detection,
// timing-safe signed-URL verification.
import { randomBytes, scryptSync, timingSafeEqual, createHash, createHmac } from 'crypto'
import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { getSecrets } from '@/lib/security/env'

const ACCESS_TTL = '12h'
const REFRESH_TTL_DAYS = 30

// Reuse-detection hook — set by routes that persist audits (avoids import cycle)
type ReuseDetector = (userId: string, tokenHash: string) => Promise<void>
let onReuse: ReuseDetector = async () => {}
export function setRefreshReuseDetector(fn: ReuseDetector) { onReuse = fn }

// ── Password hashing (scrypt) ───────────────────────────────────────────
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const test = scryptSync(password, salt, 64)
  const orig = Buffer.from(hash, 'hex')
  return test.length === orig.length && timingSafeEqual(test, orig)
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

// ── Access token ────────────────────────────────────────────────────────
export interface SessionUser {
  id: string
  phone: string
  role: string
  firstName: string
  lastName: string
}

export async function signAccessToken(user: SessionUser): Promise<string> {
  return new SignJWT({ ...user })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer('tongueai')
    .setAudience('babahakim-web')
    .setExpirationTime(ACCESS_TTL)
    .sign(getSecrets().jwtSecret)
}

export async function verifyAccessToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, getSecrets().jwtSecret, {
      issuer: 'tongueai',
      audience: 'babahakim-web',
      algorithms: ['HS256'], // alg-none / RS-confusion rejected (T-TAM-02)
    })
    return payload as unknown as SessionUser
  } catch {
    return null
  }
}

// ── Refresh tokens (rotation + chain + reuse detection) ─────────────────
export async function issueRefreshToken(userId: string): Promise<string> {
  const raw = randomBytes(48).toString('hex')
  await db.refreshToken.create({
    data: { userId, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 864e5) },
  })
  return raw
}

/**
 * Rotate with token-family protection (ED-64):
 * - valid token -> marked ROTATED (chain kept) + fresh successor issued atomically
 * - REVOKED token presented again = THEFT SIGNAL -> entire family killed,
 *   reuse hook fires (audit REFRESH_REUSE_DETECTED), returns null
 */
export async function rotateRefreshToken(raw: string): Promise<{ userId: string; raw: string } | null> {
  const hash = sha256(raw)
  const rec = await db.refreshToken.findUnique({ where: { tokenHash: hash } })
  if (!rec || rec.expiresAt < new Date()) return null
  if (rec.revoked) {
    // Replay of a rotated/revoked token: assume theft, kill all sessions
    await db.refreshToken.updateMany({
      where: { userId: rec.userId, revoked: false },
      data: { revoked: true, revokedAt: new Date(), revokedReason: 'REUSE_DETECTED' },
    })
    await onReuse(rec.userId, hash)
    return null
  }
  const fresh = randomBytes(48).toString('hex')
  const freshHash = sha256(fresh)
  await db.$transaction([
    db.refreshToken.update({
      where: { id: rec.id },
      data: { revoked: true, revokedAt: new Date(), revokedReason: 'ROTATED', replacedByToken: freshHash },
    }),
    db.refreshToken.create({
      data: { userId: rec.userId, tokenHash: freshHash, expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 864e5) },
    }),
  ])
  return { userId: rec.userId, raw: fresh }
}

export async function revokeAllRefreshTokens(userId: string, reason = 'LOGOUT') {
  await db.refreshToken.updateMany({
    where: { userId, revoked: false },
    data: { revoked: true, revokedAt: new Date(), revokedReason: reason },
  })
}

// ── Cookies ─────────────────────────────────────────────────────────────
const isProd = process.env.NODE_ENV === 'production'
export async function setAuthCookies(access: string, refresh: string) {
  const store = await cookies()
  store.set('ta_access', access, { httpOnly: true, secure: isProd, sameSite: 'lax', path: '/', maxAge: 12 * 3600 })
  store.set('ta_refresh', refresh, { httpOnly: true, secure: isProd, sameSite: 'lax', path: '/', maxAge: 30 * 86400 })
}

export async function clearAuthCookies() {
  const store = await cookies()
  store.delete('ta_access')
  store.delete('ta_refresh')
}

// ── Current user (request-level) ────────────────────────────────────────
export interface AuthContext {
  user: SessionUser
  permissions: string[]
}

export async function getAuth(): Promise<AuthContext | null> {
  const store = await cookies()
  const token = store.get('ta_access')?.value
  if (!token) return null
  const payload = await verifyAccessToken(token)
  if (!payload) return null
  const dbUser = await db.user.findUnique({ where: { id: payload.id } })
  if (!dbUser || !dbUser.isActive || dbUser.deletedAt) return null
  const role = dbUser.role as keyof typeof import('@/lib/constants').ROLE_PERMISSIONS
  const { ROLE_PERMISSIONS } = await import('@/lib/constants')
  const permissions = ROLE_PERMISSIONS[role] || []
  return { user: { id: dbUser.id, phone: dbUser.phone, role: dbUser.role, firstName: dbUser.firstName, lastName: dbUser.lastName }, permissions: permissions as string[] }
}

// ── Signed image URLs (expiring, HMAC, timing-safe) ────────────────────

export function signImageUrl(imageId: string, ttlSeconds = 300): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds
  const sig = createHmac('sha256', getSecrets().signSecret).update(`${imageId}.${exp}`).digest('hex').slice(0, 32)
  return `/api/v1/images/${imageId}/file?exp=${exp}&sig=${sig}`
}

export function verifyImageSig(imageId: string, exp: string, sig: string): boolean {
  if (!exp || !sig) return false
  const expNum = parseInt(exp, 10)
  if (isNaN(expNum) || expNum < Math.floor(Date.now() / 1000)) return false
  const expect = createHmac('sha256', getSecrets().signSecret).update(`${imageId}.${expNum}`).digest('hex').slice(0, 32)
  const a = Buffer.from(expect)
  const b = Buffer.from(String(sig))
  return a.length === b.length && timingSafeEqual(a, b)
}
