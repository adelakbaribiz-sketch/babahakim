// ── BabaHakim Backend · Application Service: Cases (PHASE 08) ─────────────
// Business logic for patient-case reads and creation. Controllers orchestrate
// only; every rule, write, notification and audit lives here or below.
import { db } from '@/lib/db'
import type { AuthContext } from '@/lib/auth'
import { parseJSON, textMatches } from '@/lib/api'
import { STATUS_META } from '@/lib/constants'
import { buildTimeline } from '@/lib/caseService'
import { signImageUrl } from '@/lib/auth'
import { genCode } from '@/server/core/ids'
import type { RequestContext } from '@/server/core/context'
import { ForbiddenError, NotFoundError } from '@/server/core/errors'
import { writeAudit } from '@/server/infrastructure/audit'
import { withTransaction } from '@/server/infrastructure/uow'
import { enqueue } from '@/server/infrastructure/jobs'
import { publish, Events } from '@/server/infrastructure/events'
import { listMeta } from '@/server/api/envelope'
import type { ListQuery } from '@/server/api/query'
import { assertCaseImageUsable, assertQuestionnaireCompleted } from '@/server/domain/policies'
import type { caseCreateSchema } from '@/server/application/dto'
import type { z } from 'zod'

// ── LIST (role-scoped queue, paginated — ED-100) ──────────────────────────
export async function listCases(auth: AuthContext, query: ListQuery, statusFilter: string) {
  const where: Record<string, unknown> = { deletedAt: null }
  if (statusFilter) where.status = statusFilter
  if (auth.user.role === 'PATIENT') where.patientId = auth.user.id

  const [rows, totalRaw] = await Promise.all([
    db.medicalCase.findMany({
      where,
      orderBy: { [query.sort]: query.order },
      skip: query.offset,
      take: query.limit + 200, // over-fetch for post-filter search, then clamp to page
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
        expert1: { select: { firstName: true, lastName: true } },
        expert2: { select: { firstName: true, lastName: true } },
        doctor: { select: { firstName: true, lastName: true } },
        images: { select: { id: true, type: true, status: true, createdAt: true } },
        _count: { select: { prescriptions: true, invoices: true } },
      },
    }),
    db.medicalCase.count({ where }),
  ])

  // Persian-normalized full-text search (matches code/patient/status)
  const filtered = query.q
    ? rows.filter((c) => textMatches(query.q, c.code, c.patient.firstName, c.patient.lastName, c.patient.phone, c.status))
    : rows

  const pageRows = filtered.slice(0, query.limit)
  const total = query.q ? filtered.length + Math.max(0, totalRaw - rows.length) : totalRaw

  return {
    cases: pageRows.map((c) => ({
      ...c,
      mizajSnapshot: parseJSON(c.mizajSnapshot, null),
      waitingHours: Math.round((Date.now() - c.createdAt.getTime()) / 36e5),
    })),
    ...listMeta(query.page, query.limit, total),
  }
}

// ── CREATE (atomic + evented + async AI, ED-103/99/102) ───────────────────
export async function createCase(
  auth: AuthContext, ctx: RequestContext, input: z.infer<typeof caseCreateSchema>,
) {
  if (auth.user.role !== 'PATIENT' && auth.user.role !== 'ADMIN') {
    throw new ForbiddenError('فقط کاربران بیمار می‌توانند پرونده ایجاد کنند')
  }

  // ── domain guards (pure policies) ──
  const image = await db.medicalImage.findUnique({ where: { id: input.imageId } })
  assertCaseImageUsable(image, auth.user.id)
  const lastMizaj = await db.questionnaireResponse.findFirst({
    where: { userId: auth.user.id }, orderBy: { createdAt: 'desc' },
  })
  assertQuestionnaireCompleted(Boolean(lastMizaj))

  const profile = await db.patientProfile.findUnique({ where: { userId: auth.user.id } })
  const mizajSnapshot = {
    mizajFa: lastMizaj!.mizajFa, mizajEn: lastMizaj!.mizajEn,
    scores: parseJSON(lastMizaj!.scores, {}),
    province: profile?.province || null, city: profile?.city || null,
  }

  // ── atomic write: case + image binding + timeline event ──
  const c = await withTransaction(async (tx) => {
    const created = await tx.medicalCase.create({
      data: {
        code: genCode('TC'), patientId: auth.user.id, status: 'WAITING_FOR_EXPERT_1',
        priority: input.priority, description: input.description,
        mizajSnapshot: JSON.stringify(mizajSnapshot),
      },
    })
    await tx.medicalImage.update({ where: { id: input.imageId }, data: { caseId: created.id } })
    await tx.caseEvent.create({
      data: {
        caseId: created.id, actorId: auth.user.id, action: 'STATUS_CHANGE',
        fromStatus: 'NEW', toStatus: 'WAITING_FOR_EXPERT_1',
        comment: 'ایجاد پرونده و ورود به صف کارشناسان',
      },
    })
    return created
  })

  // ── post-commit side effects (decoupled via events + jobs) ──
  if (image?.aiPath) {
    enqueue('ai-analysis', { caseId: c.id, imageId: image.id }, { maxAttempts: 3, backoffMs: 3000 })
  }
  await publish(Events.CaseCreated, {
    caseId: c.id, code: c.code, patientId: auth.user.id, patientPhone: auth.user.phone,
  }, ctx.reqId)
  await writeAudit(ctx, {
    userId: auth.user.id, action: 'CREATE_CASE', entity: 'MedicalCase', entityId: c.id,
    newValues: { code: c.code },
  })

  return { case: { id: c.id, code: c.code, status: c.status } }
}

// ── DETAIL (role-scoped aggregate with signed image URLs) ─────────────────
export async function getCaseDetail(auth: AuthContext, ctx: RequestContext, id: string) {
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
  if (!c || c.deletedAt) throw new NotFoundError('پرونده یافت نشد')
  if (auth.user.role === 'PATIENT' && c.patientId !== auth.user.id) throw new ForbiddenError('دسترسی غیرمجاز')

  if (['DOCTOR', 'EXPERT_1', 'EXPERT_2'].includes(auth.user.role)) {
    await writeAudit(ctx, { userId: auth.user.id, action: 'VIEW_MEDICAL_FILE', entity: 'MedicalCase', entityId: c.id })
  }

  const images = c.images.map((img) => ({
    id: img.id, type: img.type, status: img.status, createdAt: img.createdAt,
    quality: parseJSON(img.quality, null), sizeOriginal: img.sizeOriginal, sizeCompressed: img.sizeCompressed,
    sha256: img.sha256.slice(0, 16), width: img.width, height: img.height,
    urls: { thumb: signImageUrl(img.id, 600), compressed: signImageUrl(img.id, 600), ai: signImageUrl(img.id, 600) },
  }))
  const aiAnalyses = c.aiAnalyses.map((a) => ({
    id: a.id, modelName: a.modelName, modelVersion: a.modelVersion, confidence: a.confidence,
    quality: a.quality, processingMs: a.processingMs, createdAt: a.createdAt, humanReviewed: a.humanReviewed,
    reviewStatus: a.reviewStatus, reviewComment: a.reviewComment, reviewedAt: a.reviewedAt,
    predictions: parseJSON(a.predictions, []), explainability: parseJSON(a.explainability, { fa: [], en: [] }),
    features: parseJSON(a.features, null),
  }))

  const invoiceRows = await db.invoice.findMany({ where: { caseId: id }, select: { orderId: true } })
  const orders = invoiceRows.length
    ? await db.order.findMany({
        where: { id: { in: invoiceRows.map((i) => i.orderId) } },
        orderBy: { createdAt: 'desc' },
        include: { items: true, payments: true, invoices: { take: 1 }, shipment: true },
      })
    : []
  const ordersView = orders.map((o) => ({ ...o, invoice: o.invoices?.[0] || null }))

  const patientProfile = await db.patientProfile.findUnique({ where: { userId: c.patientId } })
  const mizajHistory = await db.questionnaireResponse.findMany({ where: { userId: c.patientId }, orderBy: { createdAt: 'desc' }, take: 3 })

  return {
    case: {
      ...c,
      mizajSnapshot: parseJSON(c.mizajSnapshot, null),
      statusMeta: STATUS_META[c.status as keyof typeof STATUS_META] || null,
      images, aiAnalyses,
      timeline: buildTimeline(c),
      patientProfile, mizajHistory,
      prescriptions: c.prescriptions.map((p) => ({ ...p })),
      orders: ordersView.map((o) => ({ ...o, items: o.items, payments: o.payments })),
    },
  }
}
