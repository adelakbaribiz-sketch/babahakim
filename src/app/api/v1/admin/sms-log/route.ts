import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { getAuth } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  if (!['ADMIN', 'OPERATOR'].includes(auth.user.role)) return fail('دسترسی غیرمجاز', 403)
  const logs = await db.smsLog.findMany({ orderBy: { sentAt: 'desc' }, take: 200 })
  return ok({ logs })
}
