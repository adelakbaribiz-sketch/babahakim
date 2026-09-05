// ── BabaHakim Backend · Application Service: Admin (PHASE 08) ─────────────
// Backoffice use cases. Authorization is enforced by guards at the boundary
// (requireRole/requirePermission); catalog mutations publish cache-invalidation
// events (ED-98).
import { db } from '@/lib/db'
import type { AuthContext } from '@/lib/auth'
import { invalidateUserIdentity } from '@/lib/auth'
import { normalizeFa, parseJSON } from '@/lib/api'
import { applyQ } from '@/server/infrastructure/search/query-build'
import { AppError, ConflictError, NotFoundError, ValidationError, PayloadTooLargeError, UnsupportedMediaTypeError } from '@/server/core/errors'
import { writeAudit, toAuditReq } from '@/server/infrastructure/audit'
import { withTransaction } from '@/server/infrastructure/uow'
import { publish, Events } from '@/server/infrastructure/events'
import { notify } from '@/lib/notify'
import { listMeta } from '@/server/api/envelope'
import type { ListQuery } from '@/server/api/query'
import type { RequestContext } from '@/server/core/context'
import type { z } from 'zod'
import type { adminUserPatchSchema, productSchema, deletionRequestPatchSchema } from '@/server/application/dto'
import { acceptUpload, MediaValidationError, sanitizeFileName } from '@/server/infrastructure/media/pipeline'

// ════════════════════════════ USERS ════════════════════════════════════════

// PHASE 14 (ED-151, fixes S-1): SQL-side search + real pagination — the old
// implementation fetched EVERY user row then filtered/sliced in JS.
const USER_Q_FIELDS = ['firstName', 'lastName', 'phone', 'email', 'role', 'referralCode'] as const

export async function listAdminUsers(query: ListQuery, role: string) {
  const { where: qWhere } = applyQ(query.q, USER_Q_FIELDS)
  const where = {
    deletedAt: null,
    ...(role ? { role } : {}),
    ...(qWhere ? (qWhere as Record<string, unknown>) : {}),
  }
  const [rows, total] = await Promise.all([
    db.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: query.offset,
      take: query.limit,
      include: {
        profile: true,
        referralsReceived: { take: 1, include: { referrer: { select: { firstName: true, lastName: true, referralCode: true } } } },
      },
    }),
    db.user.count({ where }),
  ])
  return {
    users: rows.map((u) => ({
      id: u.id, firstName: u.firstName, lastName: u.lastName, phone: u.phone, email: u.email, role: u.role,
      isActive: u.isActive, referralCode: u.referralCode, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt,
      profileComplete: u.profileComplete, profile: u.profile,
      referredBy: u.referralsReceived[0]?.referrer || null,
      caseCount: 0,
    })),
    ...listMeta(query.page, query.limit, total),
  }
}

export async function patchAdminUser(
  auth: AuthContext, ctx: RequestContext, input: z.infer<typeof adminUserPatchSchema>,
) {
  const user = await db.user.findUnique({ where: { id: input.id } })
  if (!user) throw new NotFoundError('کاربر یافت نشد')
  const data: Record<string, unknown> = {}
  if (input.isActive !== undefined) data.isActive = input.isActive
  if (input.role) data.role = input.role
  if (input.deleted) data.deletedAt = new Date()
  await db.user.update({ where: { id: user.id }, data })
  invalidateUserIdentity(user.id) // ED-183: role/isActive changes must land on the next request
  await writeAudit(ctx, { userId: auth.user.id, action: 'EDIT_USER', entity: 'User', entityId: user.id, oldValues: { role: user.role, isActive: user.isActive }, newValues: data })
  return { ok: true }
}

// ════════════════════════════ DISEASES ═════════════════════════════════════

export async function listDiseases() {
  const diseases = await db.disease.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'asc' }, include: { _count: { select: { diagnoses: true } } } })
  return { diseases }
}

export async function createDisease(
  auth: AuthContext, ctx: RequestContext, input: { code: string; nameFa: string; nameEn?: string; category?: string; descriptionFa?: string; descriptionEn?: string; symptomsFa?: string; symptomsEn?: string; expertNotes?: string },
) {
  if (!input.nameFa || !input.code) throw new ValidationError('کد و نام فارسی الزامی است')
  const exists = await db.disease.findUnique({ where: { code: input.code } })
  if (exists) throw new ConflictError('این کد قبلاً ثبت شده است')
  const d = await db.disease.create({
    data: {
      code: input.code, nameFa: input.nameFa, nameEn: input.nameEn || input.nameFa,
      category: input.category || null, descriptionFa: input.descriptionFa || null, descriptionEn: input.descriptionEn || null,
      symptomsFa: input.symptomsFa || null, symptomsEn: input.symptomsEn || null, expertNotes: input.expertNotes || null,
    },
  })
  await writeAudit(ctx, { userId: auth.user.id, action: 'CREATE_DISEASE', entity: 'Disease', entityId: d.id, newValues: { code: d.code } })
  return { disease: d }
}

export async function patchDisease(auth: AuthContext, ctx: RequestContext, body: Record<string, unknown>) {
  const d = await db.disease.findUnique({ where: { id: String(body.id || '') } })
  if (!d) throw new NotFoundError('بیماری یافت نشد')
  const data: Record<string, unknown> = {}
  for (const k of ['nameFa', 'nameEn', 'category', 'descriptionFa', 'descriptionEn', 'symptomsFa', 'symptomsEn', 'expertNotes']) {
    if (body[k] !== undefined) data[k] = body[k]
  }
  if (body.active !== undefined) { data.active = Boolean(body.active); if (!body.active) data.deletedAt = new Date() }
  await db.disease.update({ where: { id: d.id }, data })
  await writeAudit(ctx, { userId: auth.user.id, action: 'EDIT_DISEASE', entity: 'Disease', entityId: d.id, oldValues: { active: d.active }, newValues: data })
  return { ok: true }
}

// ════════════════════════════ PRODUCTS (mgmt) ══════════════════════════════

export async function listAdminProducts() {
  const products = await db.product.findMany({
    where: { deletedAt: null }, orderBy: { createdAt: 'asc' },
    include: { priceHistory: { orderBy: { createdAt: 'desc' }, take: 5, include: { changedBy: { select: { firstName: true, lastName: true } } } } },
  })
  return { products }
}

export async function createProduct(
  auth: AuthContext, ctx: RequestContext,
  input: z.infer<typeof productSchema>,
  opts: { imageFile?: File } = {},
) {
  const exists = await db.product.findUnique({ where: { sku: input.sku } })
  if (exists) throw new ConflictError('این SKU قبلاً ثبت شده است')
  const p = await withTransaction(async (tx) => {
    const created = await tx.product.create({
      data: {
        sku: input.sku, nameFa: input.nameFa, nameEn: input.nameEn || input.nameFa,
        brand: input.brand || null, category: input.category || null,
        descriptionFa: input.descriptionFa || null, descriptionEn: input.descriptionEn || null,
        currentPrice: input.currentPrice, purchasePrice: input.purchasePrice ?? 0,
        stock: input.stock, requiresPrescription: input.requiresPrescription,
        usageFa: input.usageFa || null, restrictions: input.restrictions || null,
      },
    })
    await tx.productPriceHistory.create({ data: { productId: created.id, newPrice: created.currentPrice, reason: 'INITIAL', changedById: auth.user.id } })
    return created
  })
  // PHASE 10: optional PUBLIC product image via the media engine (ED-118)
  let imageFileId: string | null = null
  if (opts.imageFile) {
    imageFileId = await attachProductImage(auth, ctx, p.id, opts.imageFile)
  }
  await writeAudit(ctx, { userId: auth.user.id, action: 'CREATE_PRODUCT', entity: 'Product', entityId: p.id, newValues: { sku: p.sku, imageFileId } })
  await publish(Events.ProductCatalogChanged, { productId: p.id }, ctx.reqId)
  return { product: { ...p, imageFileId } }
}

/** Upload/replace the product image through the media engine (PUBLIC class). */
async function attachProductImage(
  auth: AuthContext, ctx: RequestContext, productId: string, file: File,
): Promise<string> {
  const buf = Buffer.from(await file.arrayBuffer())
  const existing = await db.product.findUnique({ where: { id: productId }, select: { imageFileId: true } })
  try {
    const result = await acceptUpload({
      ownerId: auth.user.id,
      role: auth.user.role,
      category: 'PRODUCT_IMAGE',
      type: 'PRODUCT',
      declaredMime: file.type,
      fileName: sanitizeFileName(file.name),
      buf,
      accessClassOverride: 'PUBLIC',
      existingFileId: existing?.imageFileId ?? undefined,
    })
    if (!existing?.imageFileId) {
      await db.product.update({ where: { id: productId }, data: { imageFileId: result.fileId } })
    }
    return result.fileId
  } catch (e) {
    if (e instanceof MediaValidationError) {
      if (e.kind === 'SIZE') throw new PayloadTooLargeError(e.message, e.details as { limitBytes: number; actualBytes: number } | undefined)
      if (e.kind === 'MIME' || e.kind === 'MAGIC') throw new UnsupportedMediaTypeError(e.message, e.details as { allowed: string[]; declared?: string } | undefined)
      throw new ValidationError(e.message, e.details)
    }
    throw e
  }
}

export async function patchProduct(auth: AuthContext, ctx: RequestContext, body: Record<string, unknown>, opts: { imageFile?: File } = {}) {
  const p = await db.product.findUnique({ where: { id: String(body.id || '') } })
  if (!p) throw new NotFoundError('محصول یافت نشد')
  const data: Record<string, unknown> = {}
  for (const k of ['nameFa', 'nameEn', 'brand', 'category', 'descriptionFa', 'descriptionEn', 'usageFa', 'restrictions']) {
    if (body[k] !== undefined) data[k] = body[k]
  }
  if (body.stock !== undefined) data.stock = Number(body.stock)
  if (body.requiresPrescription !== undefined) data.requiresPrescription = Boolean(body.requiresPrescription)
  if (body.active !== undefined) { data.active = Boolean(body.active); if (!body.active) data.deletedAt = new Date() }

  await withTransaction(async (tx) => {
    if (body.currentPrice !== undefined && Number(body.currentPrice) !== p.currentPrice) {
      const newPrice = Number(body.currentPrice)
      data.currentPrice = newPrice
      await tx.productPriceHistory.create({
        data: { productId: p.id, oldPrice: p.currentPrice, newPrice, reason: String(body.reason || 'MANUAL'), changedById: auth.user.id },
      })
    }
    await tx.product.update({ where: { id: p.id }, data })
  })
  // PHASE 10: image replacement (new immutable version when one exists)
  if (opts.imageFile) {
    await attachProductImage(auth, ctx, p.id, opts.imageFile)
    await publish(Events.ProductCatalogChanged, { productId: p.id }, ctx.reqId)
  }
  await writeAudit(ctx, { userId: auth.user.id, action: 'EDIT_PRODUCT', entity: 'Product', entityId: p.id, oldValues: { stock: p.stock, price: p.currentPrice }, newValues: data })
  await publish(Events.ProductCatalogChanged, { productId: p.id }, ctx.reqId)
  await notify(auth.user.id, 'PRICE_CHANGED', {}).catch(() => {}) // in-app ping; SMS template retained
  return { ok: true }
}

// ════════════════════════════ PRICES ═══════════════════════════════════════

export async function priceEngine(
  auth: AuthContext, ctx: RequestContext,
  input: { mode: string; csv?: string; percent?: number; category?: string | null },
) {
  const { mode } = input

  if (mode === 'preview' || mode === 'commit') {
    const csvText = String(input.csv || '').trim()
    if (!csvText) throw new ValidationError('متن CSV خالی است — فایل CSV را در Excel باز کرده و محتوا را اینجا جای‌گذاری کنید')
    const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    const delimiter = lines[0].includes('\t') ? '\t' : lines[0].includes(',') ? ',' : ';'
    const header = lines[0].split(delimiter).map((h) => normalizeFa(h))
    const skuIdx = header.findIndex((h) => ['sku', 'کد', 'کد محصول', 'کدکالا'].includes(h))
    const priceIdx = header.findIndex((h) => ['price', 'قیمت', 'قیمت فروش', 'price_new', 'قیمت جدید'].includes(h))
    if (skuIdx === -1 || priceIdx === -1) {
      throw new AppError('BUSINESS_RULE', 'ستون‌های الزامی شناسایی نشد — باید ستون «sku/کد» و «price/قیمت» وجود داشته باشد', 422, { header })
    }

    const products = await db.product.findMany({ where: { deletedAt: null } })
    const rows: { line: number; sku: string; productName: string; oldPrice: number | null; newPrice: number; valid: boolean; error?: string }[] = []

    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(delimiter)
      const sku = normalizeFa(String(cells[skuIdx] || '').replace(/"/g, ''))
      const priceRaw = String(cells[priceIdx] || '').replace(/[",\s۰-۹]/g, (d: string) => ('۰۱۲۳۴۵۶۷۸۹'.includes(d) ? String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)) : '')).replace(/[^\d]/g, '')
      const product = products.find((p) => normalizeFa(p.sku) === sku)
      const newPrice = parseInt(priceRaw || '0', 10)
      let valid = true, error: string | undefined
      if (!sku) { valid = false; error = 'SKU خالی' }
      else if (!product) { valid = false; error = 'محصول یافت نشد' }
      else if (!newPrice || newPrice < 1000) { valid = false; error = 'قیمت نامعتبر (<۱۰۰۰ تومان)' }
      rows.push({ line: i, sku, productName: product?.nameFa || '—', oldPrice: product?.currentPrice ?? null, newPrice, valid, error })
    }

    if (mode === 'preview') {
      return {
        rows,
        summary: { total: rows.length, valid: rows.filter((r) => r.valid).length, invalid: rows.filter((r) => !r.valid).length },
        detected: { header, delimiter: delimiter === '\t' ? 'TAB' : delimiter === ',' ? 'COMMA' : 'SEMICOLON' },
      }
    }

    // commit — transactional (audit A2: history rows + price updates atomic)
    let applied = 0
    await withTransaction(async (tx) => {
      for (const r of rows.filter((x) => x.valid)) {
        const product = products.find((p) => normalizeFa(p.sku) === r.sku)!
        await tx.product.update({ where: { id: product.id }, data: { currentPrice: r.newPrice } })
        await tx.productPriceHistory.create({
          data: { productId: product.id, oldPrice: product.currentPrice, newPrice: r.newPrice, reason: 'IMPORT', changedById: auth.user.id, sourceRow: JSON.stringify({ sku: r.sku, line: r.line }) },
        })
        applied++
      }
    })
    await writeAudit(ctx, { userId: auth.user.id, action: 'PRICE_CHANGE', entity: 'Product', entityId: 'import', newValues: { applied } })
    await publish(Events.PriceChanged, { applied }, ctx.reqId)
    return { applied, message: `${applied} قیمت با موفقیت به‌روزرسانی شد` }
  }

  if (mode === 'bulk') {
    const percent = Number(input.percent || 0)
    const category = input.category ? String(input.category) : null
    if (!percent || Math.abs(percent) > 100) throw new ValidationError('درصد نامعتبر است (۱ تا ۱۰۰)')
    const products = await db.product.findMany({ where: { deletedAt: null, active: true, ...(category ? { category } : {}) } })
    let applied = 0
    await withTransaction(async (tx) => {
      for (const p of products) {
        const newPrice = Math.round((p.currentPrice * (100 + percent)) / 100 / 1000) * 1000
        if (newPrice !== p.currentPrice) {
          await tx.product.update({ where: { id: p.id }, data: { currentPrice: newPrice } })
          await tx.productPriceHistory.create({
            data: { productId: p.id, oldPrice: p.currentPrice, newPrice, reason: percent > 0 ? 'BULK_INCREASE' : 'BULK_DECREASE', changedById: auth.user.id },
          })
          applied++
        }
      }
    })
    await writeAudit(ctx, { userId: auth.user.id, action: 'PRICE_CHANGE', entity: 'Product', entityId: 'bulk', newValues: { percent, applied } })
    await publish(Events.PriceChanged, { applied, percent }, ctx.reqId)
    return { applied, message: `${applied} محصول ${percent > 0 ? '+' : ''}${percent}٪ شد` }
  }

  throw new ValidationError('حالت نامعتبر است (preview | commit | bulk)')
}

export async function listPriceHistory() {
  const history = await db.productPriceHistory.findMany({
    orderBy: { createdAt: 'desc' }, take: 200,
    include: { product: { select: { sku: true, nameFa: true } }, changedBy: { select: { firstName: true, lastName: true, role: true } } },
  })
  return { history }
}

// ════════════════════════════ REPORTS ══════════════════════════════════════

export async function getReports() {
  const [payments, expenses, orders, cases, products, referrals, users] = await Promise.all([
    db.payment.findMany({ where: { status: 'PAID' }, include: { order: { include: { items: true } }, user: { select: { firstName: true, lastName: true, referralCode: true } } } }),
    db.financialTransaction.findMany({ where: { type: 'EXPENSE' } }),
    db.order.findMany({ include: { items: true } }),
    db.medicalCase.findMany({ select: { id: true, status: true, createdAt: true, patientId: true } }),
    db.product.findMany({ select: { id: true, nameFa: true, currentPrice: true, purchasePrice: true, sku: true } }),
    db.referral.findMany({ include: { referrer: { select: { firstName: true, lastName: true, referralCode: true } }, referredUser: { select: { firstName: true, lastName: true } } } }),
    db.user.findMany({ where: { role: 'PATIENT' }, select: { id: true, firstName: true, lastName: true, createdAt: true, profile: { select: { province: true, city: true } } } }),
  ])

  const income = payments.reduce((s, p) => s + p.amount, 0)
  const expenseTotal = expenses.reduce((s, e) => s + e.amount, 0)

  const byDay: Record<string, number> = {}
  for (let d = 13; d >= 0; d--) {
    const day = new Date(Date.now() - d * 864e5)
    byDay[day.toISOString().slice(0, 10)] = 0
  }
  for (const p of payments) {
    const key = p.createdAt.toISOString().slice(0, 10)
    if (byDay[key] !== undefined) byDay[key] += p.amount
  }

  const productSales: Record<string, { name: string; count: number; revenue: number }> = {}
  for (const o of orders) {
    if (!['PAID', 'SHIPPED', 'DELIVERED', 'PREPARING', 'READY_TO_SHIP'].includes(o.status)) continue
    for (const it of o.items) {
      const k = it.productId || it.nameFa
      productSales[k] = productSales[k] || { name: it.nameFa, count: 0, revenue: 0 }
      productSales[k].count += it.quantity
      productSales[k].revenue += it.total
    }
  }
  const topProducts = Object.values(productSales).sort((a, b) => b.revenue - a.revenue).slice(0, 10)

  const statusCounts: Record<string, number> = {}
  for (const c of cases) statusCounts[c.status] = (statusCounts[c.status] || 0) + 1

  const referralStats = referrals.map((r) => {
    const referredOrders = orders.filter((o) => o.userId === r.referredUserId && ['PAID', 'SHIPPED', 'DELIVERED'].includes(o.status))
    const revenue = referredOrders.reduce((s, o) => s + o.total, 0)
    return { referrer: `${r.referrer.firstName} ${r.referrer.lastName}`, code: r.referrer.referralCode, referredUser: `${r.referredUser.firstName} ${r.referredUser.lastName}`, orders: referredOrders.length, revenue, commission: Math.round(revenue * 0.05) }
  })

  const provinceStats: Record<string, number> = {}
  for (const u of users) {
    const prov = u.profile?.province || 'نامشخص'
    provinceStats[prov] = (provinceStats[prov] || 0) + 1
  }

  return {
    summary: {
      income, expenses: expenseTotal, profit: income - expenseTotal, paidCount: payments.length,
      failedCount: await db.payment.count({ where: { status: { in: ['FAILED', 'REJECTED'] } } }),
      refundTotal: payments.filter((p) => p.status === 'REFUNDED').reduce((s, p) => s + p.amount, 0),
    },
    byDay: Object.entries(byDay).map(([date, amount]) => ({ date, amount })),
    topProducts, statusCounts, referralStats, provinceStats,
    recentPayments: payments.slice(-15).reverse().map((p) => ({ code: p.code, amount: p.amount, method: p.method, refNumber: p.refNumber, user: `${p.user.firstName} ${p.user.lastName}`, createdAt: p.createdAt })),
  }
}

// ════════════════════════════ QUESTIONNAIRE (versioned editor) ═════════════

export async function putQuestionnaire(
  auth: AuthContext, ctx: RequestContext,
  questions: Array<{ textFa: string; textEn?: string; helpFa?: string; options: Array<{ textFa: string; textEn?: string; score: number; dimension: string }> }>,
) {
  if (!Array.isArray(questions) || questions.length < 3) throw new ValidationError('پرسشنامه باید حداقل ۳ سؤال داشته باشد')

  const last = await db.questionnaire.findFirst({ orderBy: { version: 'desc' } })
  const version = (last?.version || 0) + 1
  await withTransaction(async (tx) => {
    const q = await tx.questionnaire.create({
      data: { version, titleFa: `پرسشنامه مزاج‌شناسی نسخه ${version}`, titleEn: `Temperament Questionnaire v${version}`, isActive: true },
    })
    await tx.questionnaire.updateMany({ where: { id: { not: q.id } }, data: { isActive: false } })
    for (let i = 0; i < questions.length; i++) {
      const qq = questions[i]
      if (!qq.textFa || !qq.options?.length) continue
      const created = await tx.question.create({
        data: { questionnaireId: q.id, order: i + 1, textFa: qq.textFa, textEn: qq.textEn || qq.textFa, helpFa: qq.helpFa || null },
      })
      for (let oi = 0; oi < qq.options.length; oi++) {
        const opt = qq.options[oi]
        await tx.questionOption.create({
          data: { questionId: created.id, textFa: opt.textFa, textEn: opt.textEn || opt.textFa, score: Number(opt.score) || 0, dimension: ['HOT', 'COLD', 'WET', 'DRY'].includes(opt.dimension) ? opt.dimension : 'HOT', order: oi },
        })
      }
    }
  })
  const created = await db.questionnaire.findFirst({ orderBy: { version: 'desc' } })
  await writeAudit(ctx, { userId: auth.user.id, action: 'EDIT_QUESTIONNAIRE', entity: 'Questionnaire', entityId: created!.id, newValues: { version } })
  return { questionnaire: { id: created!.id, version: created!.version } }
}

// ════════════════════════════ AI MODELS + DATASET ══════════════════════════

export async function listAiModels() {
  const models = await db.aIModel.findMany({ orderBy: { version: 'desc' } })
  const analyses = await db.aIAnalysis.findMany({
    orderBy: { createdAt: 'desc' }, take: 100,
    include: {
      case: { select: { code: true, status: true, patient: { select: { firstName: true, lastName: true } } } },
      image: { select: { id: true, quality: true } },
    },
  })
  const dataset = analyses.map((a) => {
    const preds = parseJSON<{ labelFa: string; value: string; confidence: number }[]>(a.predictions, [])
    return {
      id: a.id, caseCode: a.case.code, modelName: a.modelName, confidence: a.confidence,
      createdAt: a.createdAt, humanReviewed: a.humanReviewed,
      imageQuality: parseJSON(a.image?.quality, null),
      topPrediction: preds[0] ? `${preds[0].labelFa}: ${preds[0].value}` : '—',
      caseStatus: a.case.status,
    }
  })
  return {
    models: models.map((m) => ({ ...m, metrics: parseJSON(m.metrics, null) })),
    dataset,
    datasetStats: {
      total: analyses.length,
      reviewed: analyses.filter((a) => a.humanReviewed).length,
      avgConfidence: analyses.length ? +(analyses.reduce((s, a) => s + a.confidence, 0) / analyses.length).toFixed(2) : 0,
    },
  }
}

// ════════════════════════════ AUDIT LOG / SMS LOG ══════════════════════════

// PHASE 14 (ED-151): audit-log search is SQL-side now (bounded take, exact
// page window, relation-hop needles on the acting user).
const AUDIT_Q_FIELDS = ['action', 'entity', 'entityId', 'ip', 'user.firstName', 'user.lastName'] as const

export async function listAuditLogs(query: ListQuery, action: string) {
  const { where: qWhere } = applyQ(query.q, AUDIT_Q_FIELDS)
  const where = {
    ...(action ? { action } : {}),
    ...(qWhere ? (qWhere as Record<string, unknown>) : {}),
  }
  const logs = await db.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    skip: query.offset,
    take: Math.min(query.limit, 100),
    include: { user: { select: { firstName: true, lastName: true, role: true, phone: true } } },
  })
  const total = await db.auditLog.count({ where })
  return {
    logs: logs.map((l) => ({ ...l, oldValues: parseJSON(l.oldValues, null), newValues: parseJSON(l.newValues, null) })),
    ...listMeta(query.page, query.limit, total),
  }
}

export async function listSmsLog() {
  const logs = await db.sMSLog.findMany({ orderBy: { sentAt: 'desc' }, take: 200 })
  return { logs }
}

// ════════════════════════════ DELETION REQUESTS ════════════════════════════

export async function listDeletionRequests(status: string) {
  const rows = await db.deletionRequest.findMany({
    where: status === 'ALL' ? {} : { status },
    orderBy: { requestedAt: 'desc' }, take: 100,
  })
  const withUsers = await Promise.all(rows.map(async (r) => {
    const u = await db.user.findUnique({ where: { id: r.userId }, select: { firstName: true, lastName: true, phone: true, createdAt: true } })
    return { ...r, user: u }
  }))
  return { requests: withUsers }
}

export async function patchDeletionRequest(
  auth: AuthContext, ctx: RequestContext, input: z.infer<typeof deletionRequestPatchSchema>,
) {
  const rec = await db.deletionRequest.findUnique({ where: { id: input.requestId } })
  if (!rec || !['PENDING', 'PROCESSING'].includes(rec.status)) throw new ConflictError('درخواست قابل پردازش نیست')

  // PHASE 12: state changes flow through the DELETION_REQUEST machine —
  // guarded, audited, WorkflowState-synced, privacy-deadline tracked.
  // Anonymization itself runs atomically inside COMPLETE (txEffects).
  const { executeTransition } = await import('@/lib/workflow/engine')
  const action = input.action === 'REJECT' ? 'REJECT' : 'COMPLETE'
  const res = await executeTransition({
    machine: 'DELETION_REQUEST', entityId: rec.id, action,
    actor: { id: auth.user.id, role: auth.user.role as never },
    payload: { note: input.note, confirm: input.action !== 'REJECT' },
    req: toAuditReq(ctx),
  })
  if (!res.ok) throw new AppError(mapEngineCode(res.code), res.error, res.httpStatus, res.details)
  // ED-183: COMPLETE anonymizes the user — the identity cache entry must die now
  if (input.action !== 'REJECT') invalidateUserIdentity(rec.userId)
  return { status: res.ok ? res.entity.status : '' }
}

/** Map workflow engine error codes onto API error codes (same table as paymentService). */
function mapEngineCode(code?: string): 'NOT_FOUND' | 'FORBIDDEN' | 'CONFLICT' | 'BUSINESS_RULE' | 'INTERNAL' {
  switch (code) {
    case 'NOT_FOUND': return 'NOT_FOUND'
    case 'FORBIDDEN_ROLE': case 'FORBIDDEN_PERMISSION': case 'NOT_OWNER': return 'FORBIDDEN'
    case 'INVALID_TRANSITION': case 'ALREADY_OWNED': case 'PRECONDITION': return 'CONFLICT'
    case 'VALIDATION': return 'BUSINESS_RULE'
    default: return 'INTERNAL'
  }
}
