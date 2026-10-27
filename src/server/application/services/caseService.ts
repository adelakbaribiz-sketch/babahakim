// ── BabaHakim Backend · Application Service: Cases (PHASE 08) ─────────────
// Business logic for patient-case reads and creation. Controllers orchestrate
// only; every rule, write, notification and audit lives here or below.
import { db } from '@/lib/db'
import type { AuthContext } from '@/lib/auth'
import { parseJSON } from '@/lib/api'
import { applyQ } from '@/server/infrastructure/search/query-build'
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
import { assertCaseImageUsable } from '@/server/domain/policies'
import type { caseCreateSchema, caseArchiveSchema } from '@/server/application/dto'
import type { z } from 'zod'
import { queueStatuses } from '@/lib/workflow/queues'
import { displayAge } from '@/lib/national-id-format'
import { invalidateDashboards } from '@/lib/workflow/engine'
import { BusinessRuleError } from '@/server/core/errors'

// ── ARCHIVE / RESTORE (ADMIN) — archive is a view filter, never a delete ──
export async function archiveCase(
  auth: AuthContext, ctx: RequestContext, caseId: string, input: z.infer<typeof caseArchiveSchema>,
) {
  const c = await db.medicalCase.findUnique({ where: { id: caseId } })
  if (!c || c.deletedAt) throw new NotFoundError('پرونده یافت نشد')
  if (input.action === 'ARCHIVE' && c.archivedAt) throw new BusinessRuleError('پرونده قبلاً بایگانی شده است')
  if (input.action === 'RESTORE' && !c.archivedAt) throw new BusinessRuleError('پرونده بایگانی نشده است')
  const data = input.action === 'ARCHIVE'
    ? { archivedAt: new Date(), archivedById: auth.user.id, archiveReason: input.reason }
    : { archivedAt: null, archivedById: null, archiveReason: null }
  await withTransaction(async (tx) => {
    await tx.medicalCase.update({ where: { id: caseId }, data })
    // timeline keeps the archive history even after a restore clears the columns
    await tx.caseEvent.create({
      data: {
        caseId, actorId: auth.user.id, action: input.action === 'ARCHIVE' ? 'ARCHIVED' : 'RESTORED',
        reason: input.reason, comment: input.action === 'ARCHIVE' ? 'پرونده بایگانی شد' : 'پرونده از بایگانی بازگردانده شد',
      },
    })
  })
  await writeAudit(ctx, {
    userId: auth.user.id, action: input.action === 'ARCHIVE' ? 'CASE_ARCHIVE' : 'CASE_RESTORE',
    entity: 'MedicalCase', entityId: caseId, oldValues: { archivedAt: c.archivedAt }, newValues: { reason: input.reason },
  })
  invalidateDashboards()
  return { ok: true, archived: input.action === 'ARCHIVE' }
}

// ── LIST (role-scoped queue, paginated — ED-100) ──────────────────────────
// Iran has had no DST since 2022: Asia/Tehran is a fixed UTC+03:30, so
// "today"/"last 7 days" boundaries are computed at Tehran midnight.
const TEHRAN_OFFSET_MS = 210 * 60_000
function tehranMidnight(daysAgo = 0): Date {
  const local = new Date(Date.now() + TEHRAN_OFFSET_MS)
  local.setUTCHours(0, 0, 0, 0)
  return new Date(local.getTime() - TEHRAN_OFFSET_MS - daysAgo * 864e5)
}

export interface CaseListFilters {
  status: string
  queue?: string // QUEUES key (expert1 | returned | expert2 | doctor | …)
  range?: string // today | 7d | 30d | 90d
  from?: string // ISO date (inclusive)
  to?: string // ISO date (inclusive)
  year?: number // Gregorian year of createdAt
  expertId?: string // assigned expert 1 / 2 / doctor
  priority?: string
  archived?: boolean // true → archive only; default → active only
}

export async function listCases(auth: AuthContext, query: ListQuery, filters: CaseListFilters | string) {
  const f: CaseListFilters = typeof filters === 'string' ? { status: filters } : filters
  const where: Record<string, unknown> = { deletedAt: null }
  const and: unknown[] = []
  if (f.status) where.status = f.status
  if (f.queue) {
    const statuses = queueStatuses(f.queue)
    if (statuses) and.push({ status: { in: [...statuses] } })
  }
  if (auth.user.role === 'PATIENT') where.patientId = auth.user.id
  else where.archivedAt = f.archived ? { not: null } : null // archive is a staff-side view

  const created: Record<string, Date> = {}
  if (f.range === 'today') created.gte = tehranMidnight(0)
  else if (f.range === '7d') created.gte = tehranMidnight(6)
  else if (f.range === '30d') created.gte = tehranMidnight(29)
  else if (f.range === '90d') created.gte = tehranMidnight(89)
  if (f.year) { created.gte = new Date(Date.UTC(f.year, 0, 1) - TEHRAN_OFFSET_MS); created.lt = new Date(Date.UTC(f.year + 1, 0, 1) - TEHRAN_OFFSET_MS) }
  if (f.from) created.gte = new Date(new Date(f.from).getTime() - TEHRAN_OFFSET_MS)
  if (f.to) created.lt = new Date(new Date(f.to).getTime() + 864e5 - TEHRAN_OFFSET_MS)
  if (Object.keys(created).length) where.createdAt = created
  if (f.priority) where.priority = f.priority
  if (f.expertId) and.push({ OR: [{ assignedExpert1Id: f.expertId }, { assignedExpert2Id: f.expertId }, { assignedDoctorId: f.expertId }] })
  if (and.length) where.AND = and

  // PHASE 14 (ED-151, fixes S-1): full-text needles are pushed INTO the SQL
  // where — code/status on the case row + patient identity via one relation
  // hop. No over-fetch, no post-filter: pagination counts stay exact.
  const { where: qWhere } = applyQ(query.q, [
    'code', 'status',
    'patient.firstName', 'patient.lastName', 'patient.phone',
  ])
  if (qWhere) where.AND = [...(where.AND as unknown[] ?? []), qWhere]

  const [rows, total] = await Promise.all([
    db.medicalCase.findMany({
      where,
      orderBy: { [query.sort]: query.order },
      skip: query.offset,
      take: query.limit,
      include: {
        // identity columns for staff lists — national ID deliberately NOT here
        // (only the audited admin reveal endpoint exposes it)
        patient: {
          select: {
            id: true, firstName: true, lastName: true, phone: true, birthDate: true, ageYears: true,
            profile: { select: { province: true, city: true } },
          },
        },
        expert1: { select: { firstName: true, lastName: true } },
        expert2: { select: { firstName: true, lastName: true } },
        doctor: { select: { firstName: true, lastName: true } },
        images: { select: { id: true, type: true, status: true, createdAt: true } },
        events: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
        _count: { select: { prescriptions: true, invoices: true } },
      },
    }),
    db.medicalCase.count({ where }),
  ])

  return {
    cases: rows.map(({ events, patient, ...c }) => ({
      ...c,
      patient: {
        id: patient.id, firstName: patient.firstName, lastName: patient.lastName, phone: patient.phone,
        age: displayAge(patient), province: patient.profile?.province ?? null, city: patient.profile?.city ?? null,
      },
      lastActivityAt: events[0]?.createdAt ?? c.updatedAt,
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
  // mizaj is optional (2026-10): a case may be opened without it; the
  // snapshot is the latest COMPLETED response, or null ("not recorded")
  const lastMizaj = await db.questionnaireResponse.findFirst({
    where: { userId: auth.user.id, status: 'COMPLETED' }, orderBy: { createdAt: 'desc' },
  })

  const profile = await db.patientProfile.findUnique({ where: { userId: auth.user.id } })
  const mizajSnapshot = {
    mizajFa: lastMizaj?.mizajFa ?? null, mizajEn: lastMizaj?.mizajEn ?? null,
    scores: lastMizaj ? parseJSON(lastMizaj.scores, {}) : null,
    recorded: !!lastMizaj,
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
