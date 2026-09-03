import { NextRequest } from 'next/server'
import { ok } from '@/lib/api'
import { clearAuthCookies, revokeAllRefreshTokens, getAuth } from '@/lib/auth'
import { audit } from '@/lib/api'

export async function POST(req: NextRequest) {
  const auth = await getAuth()
  if (auth) {
    await revokeAllRefreshTokens(auth.user.id)
    await audit(req, auth.user.id, 'LOGOUT', 'User', auth.user.id)
  }
  await clearAuthCookies()
  return ok()
}
