// ── BabaHakim Backend · Application Service: Questionnaires (PHASE 08) ────
// Scoring/mizaj rules live in domain/policies (pure, unit-tested).
import { db } from '@/lib/db'
import type { AuthContext } from '@/lib/auth'
import { NotFoundError, ValidationError } from '@/server/core/errors'
import { publish, Events } from '@/server/infrastructure/events'
import type { RequestContext } from '@/server/core/context'
import { determineMizaj, emptyScores, assertEnoughAnswers } from '@/server/domain/policies'
import { cached, cacheKeys, cacheTtl } from '@/server/infrastructure/cache'
import type { questionnaireSubmitSchema } from '@/server/application/dto'
import type { z } from 'zod'

export async function getActiveQuestionnaire(userId: string) {
  const q = await cached(cacheKeys.questionnaire(), cacheTtl.questionnaire, async () =>
    db.questionnaire.findFirst({
      where: { isActive: true },
      include: { questions: { where: { active: true }, orderBy: { order: 'asc' }, include: { options: { orderBy: { order: 'asc' } } } } },
    }),
  )
  if (!q) return { questionnaire: null }
  const lastResponse = await db.questionnaireResponse.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } })
  return { questionnaire: q, lastResponse }
}

export async function getHistory(userId: string) {
  const responses = await db.questionnaireResponse.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 30 })
  return { responses }
}

export async function submitQuestionnaire(
  auth: AuthContext, ctx: RequestContext, input: z.infer<typeof questionnaireSubmitSchema>,
) {
  const q = await db.questionnaire.findFirst({ where: { isActive: true }, include: { questions: { include: { options: true } } } })
  if (!q) throw new NotFoundError('پرسشنامه فعال یافت نشد')

  const scores = emptyScores()
  const validAnswers: unknown[] = []
  for (const a of input.answers) {
    const question = q.questions.find((qq) => qq.id === a.questionId)
    const option = question?.options.find((o) => o.id === a.optionId)
    if (!question || !option) continue
    if (scores[option.dimension as keyof typeof scores] !== undefined) {
      scores[option.dimension as keyof typeof scores] += option.score
    }
    validAnswers.push({ questionId: a.questionId, optionId: a.optionId, score: option.score, dimension: option.dimension })
  }
  assertEnoughAnswers(validAnswers.length, q.questions.length)

  const { mizajFa, mizajEn, summaryFa } = determineMizaj(scores)
  const resp = await db.questionnaireResponse.create({
    data: {
      userId: auth.user.id, questionnaireId: q.id,
      answers: JSON.stringify(validAnswers), scores: JSON.stringify(scores),
      mizajFa, mizajEn, summary: summaryFa,
    },
  })
  await db.patientProfile.updateMany({ where: { userId: auth.user.id }, data: { mizajCurrent: `${mizajFa} (${mizajEn})` } })
  await publish(Events.QuestionnaireSubmitted, auth.user.id, ctx.reqId)
  return { response: { ...resp, scores, mizajFa, mizajEn, summary: summaryFa } }
}

// re-export for the route-level import contract
export { ValidationError }
