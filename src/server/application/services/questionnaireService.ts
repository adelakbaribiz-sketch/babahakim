// ── BabaHakim Backend · Application Service: Questionnaires (PHASE 08) ────
// Scoring/mizaj rules live in domain/policies (pure, unit-tested).
//
// 2026-10 overhaul: the mizaj form is OPTIONAL and may be answered partially.
//   - DRAFT saves keep one in-progress response per user/questionnaire
//   - COMPLETED accepts any number of answers; only admin-marked `required`
//     questions are enforced
//   - each answer stores its score+weight snapshot, and the response stores
//     questionnaireVersion + scoringVersion — later admin edits never rewrite
//     a historical result
//   - too few answers → the result is explicitly "undetermined", never a
//     confident-looking temperament (scoreMizajResponse)
import { db } from '@/lib/db'
import type { AuthContext } from '@/lib/auth'
import { NotFoundError, ValidationError } from '@/server/core/errors'
import { publish, Events } from '@/server/infrastructure/events'
import type { RequestContext } from '@/server/core/context'
import { scoreMizajResponse, MIZAJ_SCORING_VERSION } from '@/server/domain/policies'
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
  const [lastResponse, draft] = await Promise.all([
    db.questionnaireResponse.findFirst({ where: { userId, status: 'COMPLETED' }, orderBy: { createdAt: 'desc' } }),
    db.questionnaireResponse.findFirst({ where: { userId, questionnaireId: q.id, status: 'DRAFT' }, orderBy: { updatedAt: 'desc' } }),
  ])
  return {
    questionnaire: q, lastResponse,
    // resumable draft: the client re-selects these options
    draft: draft ? { id: draft.id, answers: JSON.parse(draft.answers) as { questionId: string; optionId: string }[], updatedAt: draft.updatedAt } : null,
    status: draft ? 'IN_PROGRESS' : lastResponse ? 'COMPLETED' : 'NOT_STARTED',
  }
}

export async function getHistory(userId: string) {
  const responses = await db.questionnaireResponse.findMany({ where: { userId, status: 'COMPLETED' }, orderBy: { createdAt: 'desc' }, take: 30 })
  return { responses }
}

export async function submitQuestionnaire(
  auth: AuthContext, ctx: RequestContext, input: z.infer<typeof questionnaireSubmitSchema>,
) {
  const q = await db.questionnaire.findFirst({
    where: { isActive: true },
    include: { questions: { where: { active: true }, include: { options: true } } },
  })
  if (!q) throw new NotFoundError('پرسشنامه فعال یافت نشد')

  // snapshot every valid answer with the score/weight in force right now
  const validAnswers: { questionId: string; optionId: string; score: number; weight: number; dimension: string }[] = []
  const seen = new Set<string>()
  for (const a of input.answers) {
    if (seen.has(a.questionId)) continue
    const question = q.questions.find((qq) => qq.id === a.questionId)
    const option = question?.options.find((o) => o.id === a.optionId)
    if (!question || !option) continue
    seen.add(a.questionId)
    validAnswers.push({ questionId: a.questionId, optionId: a.optionId, score: option.score, weight: question.weight, dimension: option.dimension })
  }

  const completing = input.status === 'COMPLETED'
  if (completing) {
    const missing = q.questions.filter((qq) => qq.required && !seen.has(qq.id))
    if (missing.length) {
      throw new ValidationError('به سؤالات اجباری پاسخ دهید | Required questions unanswered', {
        missing: missing.map((m) => ({ questionId: m.id, textFa: m.textFa })),
      })
    }
    if (validAnswers.length === 0) throw new ValidationError('برای ثبت نتیجه حداقل به یک سؤال پاسخ دهید')
  }

  const result = scoreMizajResponse(validAnswers, q.questions.length)
  const data = {
    answers: JSON.stringify(validAnswers), scores: JSON.stringify(result.scores),
    mizajFa: result.mizajFa, mizajEn: result.mizajEn, summary: result.summaryFa,
    status: completing ? 'COMPLETED' : 'DRAFT',
    answeredCount: validAnswers.length, totalQuestions: q.questions.length,
    questionnaireVersion: q.version, scoringVersion: MIZAJ_SCORING_VERSION,
  }

  // one draft per user+questionnaire: update it in place (or promote it)
  const draft = await db.questionnaireResponse.findFirst({ where: { userId: auth.user.id, questionnaireId: q.id, status: 'DRAFT' } })
  const resp = draft
    ? await db.questionnaireResponse.update({ where: { id: draft.id }, data })
    : await db.questionnaireResponse.create({ data: { userId: auth.user.id, questionnaireId: q.id, ...data } })

  if (completing) {
    if (result.determined) {
      await db.patientProfile.updateMany({ where: { userId: auth.user.id }, data: { mizajCurrent: `${result.mizajFa} (${result.mizajEn})` } })
    }
    await publish(Events.QuestionnaireSubmitted, auth.user.id, ctx.reqId)
  }
  return {
    response: { ...resp, scores: result.scores, mizajFa: result.mizajFa, mizajEn: result.mizajEn, summary: result.summaryFa },
    completeness: { answered: validAnswers.length, total: q.questions.length, complete: result.complete, determined: result.determined },
  }
}

// re-export for the route-level import contract
export { ValidationError }
