import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { getAuth } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  const history = await db.questionnaireResponse.findMany({ where: { userId: auth.user.id }, orderBy: { createdAt: 'desc' } })
  return ok({ history })
}
