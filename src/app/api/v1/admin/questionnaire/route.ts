import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, audit } from '@/lib/api'
import { getAuth } from '@/lib/auth'

// PUT /api/v1/admin/questionnaire — versioned questionnaire editor
// {questions: [{id?, textFa, textEn, options: [{id?, textFa, textEn, score, dimension}], active}]} → creates NEW version
export async function PUT(req: NextRequest) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  if (!['ADMIN'].includes(auth.user.role)) return fail('دسترسی غیرمجاز', 403)
  const body = await req.json().catch(() => ({}))
  const questions = body.questions as { textFa: string; textEn: string; helpFa?: string; options: { textFa: string; textEn: string; score: number; dimension: string }[] }[]
  if (!Array.isArray(questions) || questions.length < 3) return fail('پرسشنامه باید حداقل ۳ سؤال داشته باشد')

  const last = await db.questionnaire.findFirst({ orderBy: { version: 'desc' } })
  const version = (last?.version || 0) + 1
  const q = await db.questionnaire.create({
    data: { version, titleFa: `پرسشنامه مزاج‌شناسی نسخه ${version}`, titleEn: `Temperament Questionnaire v${version}`, isActive: true },
  })
  await db.questionnaire.updateMany({ where: { id: { not: q.id } }, data: { isActive: false } })

  for (let i = 0; i < questions.length; i++) {
    const qq = questions[i]
    if (!qq.textFa || !qq.options?.length) continue
    const created = await db.question.create({
      data: { questionnaireId: q.id, order: i + 1, textFa: qq.textFa, textEn: qq.textEn || qq.textFa, helpFa: qq.helpFa || null },
    })
    for (let oi = 0; oi < qq.options.length; oi++) {
      const opt = qq.options[oi]
      await db.questionOption.create({
        data: { questionId: created.id, textFa: opt.textFa, textEn: opt.textEn || opt.textFa, score: Number(opt.score) || 0, dimension: ['HOT', 'COLD', 'WET', 'DRY'].includes(opt.dimension) ? opt.dimension : 'HOT', order: oi },
      })
    }
  }
  await audit(req, auth.user.id, 'EDIT_QUESTIONNAIRE', 'Questionnaire', q.id, null, { version })
  return ok({ questionnaire: { id: q.id, version: q.version } })
}
