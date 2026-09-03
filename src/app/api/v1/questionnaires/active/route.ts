import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { getAuth } from '@/lib/auth'

// GET /api/v1/questionnaires/active — active questionnaire with questions+options
export async function GET(req: NextRequest) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  const q = await db.questionnaire.findFirst({
    where: { isActive: true },
    include: { questions: { where: { active: true }, orderBy: { order: 'asc' }, include: { options: { orderBy: { order: 'asc' } } } } },
  })
  if (!q) return ok({ questionnaire: null })
  const lastResp = await db.questionnaireResponse.findFirst({ where: { userId: auth.user.id }, orderBy: { createdAt: 'desc' } })
  return ok({ questionnaire: q, lastResponse: lastResp })
}
