import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { getAuth } from '@/lib/auth'
import { notify } from '@/lib/notify'

// POST /api/v1/questionnaires/submit — score & persist temperament (history never deleted)
export async function POST(req: NextRequest) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  const body = await req.json().catch(() => null)
  const answers: { questionId: string; optionId: string }[] = body?.answers || []
  if (!Array.isArray(answers) || answers.length === 0) return fail('پاسخ‌ها ارسال نشده است')

  const q = await db.questionnaire.findFirst({ where: { isActive: true }, include: { questions: { include: { options: true } } } })
  if (!q) return fail('پرسشنامه فعال یافت نشد', 404)

  const scores: Record<string, number> = { HOT: 0, COLD: 0, WET: 0, DRY: 0 }
  const validAnswers: unknown[] = []
  for (const a of answers) {
    const question = q.questions.find((qq) => qq.id === a.questionId)
    const option = question?.options.find((o) => o.id === a.optionId)
    if (!question || !option) continue
    if (scores[option.dimension] !== undefined) scores[option.dimension] += option.score
    validAnswers.push({ questionId: a.questionId, optionId: a.optionId, score: option.score, dimension: option.dimension })
  }
  if (validAnswers.length < Math.ceil(q.questions.length * 0.6)) {
    return fail('لطفاً به همه سؤالات پاسخ دهید | Please answer all questions')
  }

  const heat = scores.HOT, cold = scores.COLD, wet = scores.WET, dry = scores.DRY
  const temp = Math.abs(heat - cold) <= 3 ? 'BALANCED' : (heat > cold ? 'HOT' : 'COLD')
  const moist = Math.abs(wet - dry) <= 3 ? 'BALANCED' : (wet > dry ? 'WET' : 'DRY')

  let mizajFa = 'معتدل', mizajEn = 'Balanced'
  if (temp === 'HOT' && moist === 'DRY') { mizajFa = 'گرم و خشک'; mizajEn = 'Hot & Dry' }
  else if (temp === 'HOT' && moist === 'WET') { mizajFa = 'گرم و تر'; mizajEn = 'Hot & Wet' }
  else if (temp === 'COLD' && moist === 'DRY') { mizajFa = 'سرد و خشک'; mizajEn = 'Cold & Dry' }
  else if (temp === 'COLD' && moist === 'WET') { mizajFa = 'سرد و تر'; mizajEn = 'Cold & Wet' }
  else if (temp === 'HOT') { mizajFa = 'غالباً گرم'; mizajEn = 'Predominantly Hot' }
  else if (temp === 'COLD') { mizajFa = 'غالباً سرد'; mizajEn = 'Predominantly Cold' }
  else if (moist === 'DRY') { mizajFa = 'غالباً خشک'; mizajEn = 'Predominantly Dry' }
  else if (moist === 'WET') { mizajFa = 'غالباً تر'; mizajEn = 'Predominantly Wet' }

  const summaryFa = `امتیازها — گرما: ${heat}، برودت: ${cold}، رطوبت: ${wet}، خشکی: ${dry}`
  const resp = await db.questionnaireResponse.create({
    data: {
      userId: auth.user.id, questionnaireId: q.id,
      answers: JSON.stringify(validAnswers), scores: JSON.stringify(scores),
      mizajFa, mizajEn, summary: summaryFa,
    },
  })
  await db.patientProfile.updateMany({ where: { userId: auth.user.id }, data: { mizajCurrent: `${mizajFa} (${mizajEn})` } })
  await notify(auth.user.id, 'QUESTIONNAIRE_DONE', { link: '/records' })
  return ok({ response: { ...resp, scores, mizajFa, mizajEn, summary: summaryFa } })
}
