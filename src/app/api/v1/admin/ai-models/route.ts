import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, parseJSON } from '@/lib/api'
import { getAuth } from '@/lib/auth'

// GET /api/v1/admin/ai-models — model registry + dataset stats (learning loop)
export async function GET(req: NextRequest) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  if (!['ADMIN', 'EXPERT_1', 'EXPERT_2', 'DOCTOR'].includes(auth.user.role)) return fail('دسترسی غیرمجاز', 403)

  const models = await db.aIModel.findMany({ orderBy: { version: 'desc' } })
  const analyses = await db.aIAnalysis.findMany({
    orderBy: { createdAt: 'desc' }, take: 100,
    include: {
      case: { select: { code: true, status: true, patient: { select: { firstName: true, lastName: true } } } },
      image: { select: { id: true, quality: true } },
    },
  })

  // Dataset view: AI prediction vs expert final → disagreement flags (labels for continuous improvement)
  const dataset = analyses.map((a) => {
    const preds = parseJSON<{ indicator: string; value: string; confidence: number }[]>(a.predictions, [])
    const diag = null
    return {
      id: a.id, caseCode: a.case.code, modelName: a.modelName, confidence: a.confidence,
      createdAt: a.createdAt, humanReviewed: a.humanReviewed,
      imageQuality: parseJSON(a.image?.quality, null),
      topPrediction: preds[0] ? `${preds[0].labelFa}: ${preds[0].value}` : '—',
      caseStatus: a.case.status,
    }
  })

  return ok({
    models: models.map((m) => ({ ...m, metrics: parseJSON(m.metrics, null) })),
    dataset,
    datasetStats: {
      total: analyses.length,
      reviewed: analyses.filter((a) => a.humanReviewed).length,
      avgConfidence: analyses.length ? +(analyses.reduce((s, a) => s + a.confidence, 0) / analyses.length).toFixed(2) : 0,
    },
  })
}
