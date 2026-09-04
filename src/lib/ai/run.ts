// AI analysis runner — persists AIAnalysis, marks image PROCESSED
// (In production this runs in a Celery worker; here it runs as an in-process job with DB persistence.)
import { db } from '@/lib/db'
import { parseJSON } from '@/lib/api'
import { getActiveProvider } from '@/lib/ai/provider'

export async function runAIAnalysis(caseId: string, imageId: string) {
  const image = await db.medicalImage.findUnique({ where: { id: imageId } })
  if (!image || !image.aiPath) throw new Error('image not found')

  const quality = parseJSON(image.quality, { score: 70, issues: [] as string[] }) as { score: number; issues: string[] }
  const provider = getActiveProvider()
  const result = await provider.analyze(image.aiPath, { ...quality, score: quality.score } as never)

  const model = await db.aIModel.findFirst({ where: { isActive: true } })

  const analysis = await db.aIAnalysis.create({
    data: {
      caseId, imageId, modelId: model?.id || null,
      modelName: result.model, modelVersion: result.version,
      predictions: JSON.stringify(result.predictions),
      confidence: result.confidence, quality: result.quality,
      features: JSON.stringify(result.features),
      explainability: JSON.stringify(result.explainability),
      processingMs: result.processingMs,
    },
  })

  await db.medicalImage.update({ where: { id: imageId }, data: { status: 'PROCESSED' } })
  await db.medicalCase.update({ where: { id: caseId }, data: { aiAnalysisId: analysis.id } })
  return analysis
}
