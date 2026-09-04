import { cookies } from 'next/headers'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, audit, getIP } from '@/lib/api'
import { rotateRefreshToken, signAccessToken, setAuthCookies, setRefreshReuseDetector } from '@/lib/auth'
import { rateLimit, rateLimited, LIMITS } from '@/lib/security/rate-limit'

// POST /api/v1/auth/refresh — refresh token rotation (with reuse detection)
// PHASE 05 (ED-64): presenting an already-rotated token is treated as theft;
// the whole token family is revoked and the event is audited.
setRefreshReuseDetector(async (userId, tokenHash) => {
  await audit(
    {
      headers: new Headers(),
      method: 'POST',
      url: '/api/v1/auth/refresh',
    } as unknown as NextRequest,
    userId,
    'REFRESH_REUSE_DETECTED',
    'RefreshToken',
    tokenHash.slice(0, 12),
    null,
    { hint: 'token-family revoked' },
  ).catch(() => {})
})

export async function POST(req: NextRequest) {
  const ip = await getIP(req)
  const rl = rateLimit(`refresh:${ip}`, LIMITS.refresh.limit, LIMITS.refresh.windowMs)
  if (!rl.allowed) return rateLimited(rl)

  const store = await cookies()
  const raw = store.get('ta_refresh')?.value
  if (!raw) return fail('نشست منقضی شده است', 401)
  const rotated = await rotateRefreshToken(raw)
  if (!rotated) {
    await audit(req, null, 'REFRESH_REJECTED', 'RefreshToken', null, null, { ip })
    return fail('نشست منقضی شده است', 401)
  }
  const user = await db.user.findUnique({ where: { id: rotated.userId } })
  if (!user || !user.isActive || user.deletedAt) return fail('حساب غیرفعال است', 403)
  const access = await signAccessToken({ id: user.id, phone: user.phone, role: user.role, firstName: user.firstName, lastName: user.lastName })
  await setAuthCookies(access, rotated.raw)
  return ok({ user: { id: user.id, role: user.role } })
}
