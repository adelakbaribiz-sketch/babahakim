// Authentication: scrypt password hashing + JWT (jose) + refresh token rotation
import { randomBytes, scryptSync, timingSafeEqual, createHash, createHmac } from 'crypto'
import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'tongueai-dev-secret-change-in-production-2024')
const ACCESS_TTL = '12h'
const REFRESH_TTL_DAYS = 30

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
    .setExpirationTime(ACCESS_TTL)
    .sign(SECRET)
}

export async function verifyAccessToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET, { issuer: 'tongueai' })
    return payload as unknown as SessionUser
  } catch {
    return null
  }
}

// ── Refresh tokens (rotation + revocation) ──────────────────────────────
export async function issueRefreshToken(userId: string): Promise<string> {
  const raw = randomBytes(48).toString('hex')
  await db.refreshToken.create({
    data: { userId, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 864e5) },
  })
  return raw
}

export async function rotateRefreshToken(raw: string): Promise<{ userId: string; raw: string } | null> {
  const hash = sha256(raw)
  const rec = await db.refreshToken.findUnique({ where: { tokenHash: hash } })
  if (!rec || rec.revoked || rec.expiresAt < new Date()) return null
  await db.refreshToken.update({ where: { id: rec.id }, data: { revoked: true } })
  const fresh = randomBytes(48).toString('hex')
  await db.refreshToken.create({
    data: { userId: rec.userId, tokenHash: sha256(fresh), expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 864e5) },
  })
  return { userId: rec.userId, raw: fresh }
}

export async function revokeAllRefreshTokens(userId: string) {
  await db.refreshToken.updateMany({ where: { userId, revoked: false }, data: { revoked: true } })
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

// ── Signed image URLs (expiring, HMAC) ──────────────────────────────────
const SIGN_SECRET = process.env.JWT_SECRET || 'tongueai-dev-secret-change-in-production-2024'

export function signImageUrl(imageId: string, ttlSeconds = 300): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds
  const sig = createHmac('sha256', SIGN_SECRET).update(`${imageId}.${exp}`).digest('hex').slice(0, 32)
  return `/api/v1/images/${imageId}/file?exp=${exp}&sig=${sig}`
}

export function verifyImageSig(imageId: string, exp: string, sig: string): boolean {
  if (!exp || !sig) return false
  const expNum = parseInt(exp, 10)
  if (isNaN(expNum) || expNum < Math.floor(Date.now() / 1000)) return false
  const expect = createHmac('sha256', SIGN_SECRET).update(`${imageId}.${expNum}`).digest('hex').slice(0, 32)
  return expect === sig
}
