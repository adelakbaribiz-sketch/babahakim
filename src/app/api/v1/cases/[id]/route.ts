import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, audit, parseJSON } from '@/lib/api'
import { getAuth, signImageUrl } from '@/lib/auth'
import { buildTimeline } from '@/lib/caseService'
import { STATUS_META } from '@/lib/constants'

// GET /api/v1/cases/[id] — full case detail (role-scoped)
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  const { id } = await ctx.params

  const c = await db.medicalCase.findUnique({
    where: { id },
    include: {
      patient: { select: { id: true, firstName: true, lastName: true, phone: true, email: true, gender: true, birthDate: true, createdAt: true, profileComplete: true } },
      expert1: { select: { id: true, firstName: true, lastName: true } },
      expert2: { select: { id: true, firstName: true, lastName: true } },
      doctor: { select: { id: true, firstName: true, lastName: true } },
      images: true,
      aiAnalyses: { orderBy: { createdAt: 'desc' } },
      diagnoses: { include: { disease: true, expert: { select: { firstName: true, lastName: true } } } },
      prescriptions: { orderBy: { version: 'desc' }, include: { items: { include: { product: true } }, createdBy: { select: { firstName: true, lastName: true, role: true } }, approvedBy: { select: { firstName: true, lastName: true } } } },
      events: { orderBy: { createdAt: 'asc' }, include: { actor: { select: { firstName: true, lastName: true, role: true } } } },
      followUps: { orderBy: { dueDate: 'asc' } },
    },
  })
  if (!c || c.deletedAt) return fail('پرونده یافت نشد', 404)
  if (auth.user.role === 'PATIENT' && c.patientId !== auth.user.id) return fail('دسترسی غیرمجاز', 403)

  if (['DOCTOR', 'EXPERT_1', 'EXPERT_2'].includes(auth.user.role)) {
    await audit(req, auth.user.id, 'VIEW_MEDICAL_FILE', 'MedicalCase', c.id)
  }

  const images = c.images.map((img) => ({
    id: img.id, type: img.type, status: img.status, createdAt: img.createdAt,
    quality: parseJSON(img.quality, null), sizeOriginal: img.sizeOriginal, sizeCompressed: img.sizeCompressed,
    sha256: img.sha256.slice(0, 16), width: img.width, height: img.height,
    urls: {
      thumb: signImageUrl(img.id, 600),
      compressed: signImageUrl(img.id, 600),
      ai: signImageUrl(img.id, 600),
    },
  }))

  const aiAnalyses = c.aiAnalyses.map((a) => ({
    id: a.id, modelName: a.modelName, modelVersion: a.modelVersion, confidence: a.confidence,
    quality: a.quality, processingMs: a.processingMs, createdAt: a.createdAt, humanReviewed: a.humanReviewed,
    predictions: parseJSON(a.predictions, []), explainability: parseJSON(a.explainability, { fa: [], en: [] }),
    features: parseJSON(a.features, null),
  }))

  // orders linked to this case through invoices
  const invoiceRows = await db.invoice.findMany({ where: { caseId: id }, select: { orderId: true } })
  const orders = invoiceRows.length
    ? await db.order.findMany({
        where: { id: { in: invoiceRows.map((i) => i.orderId) } },
        orderBy: { createdAt: 'desc' },
        include: { items: true, payments: true, invoices: { take: 1 }, shipment: true },
      })
    : []
  ;(c as unknown as { orders: unknown[] }).orders = orders.map((o) => ({ ...o, invoice: o.invoices?.[0] || null }))

  const patientProfile = await db.patientProfile.findUnique({ where: { userId: c.patientId } })
  const mizajHistory = await db.questionnaireResponse.findMany({ where: { userId: c.patientId }, orderBy: { createdAt: 'desc' }, take: 3 })

  return ok({
    case: {
      ...c,
      mizajSnapshot: parseJSON(c.mizajSnapshot, null),
      statusMeta: STATUS_META[c.status as keyof typeof STATUS_META] || null,
      images, aiAnalyses,
      timeline: buildTimeline(c),
      patientProfile, mizajHistory,
      prescriptions: c.prescriptions.map((p) => ({ ...p })),
      orders: c.orders.map((o) => ({ ...o, items: o.items, payments: o.payments })),
    },
  })
}
