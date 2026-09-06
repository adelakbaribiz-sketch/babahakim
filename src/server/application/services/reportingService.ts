// ── BabaHakim Backend · Application Service: Reporting (PHASE 14) ──────────
// Thin orchestration over the reporting engine: guards, rate limits, audit,
// response shaping. The engine (infrastructure/reporting) owns bounded
// execution; this layer owns the API contract.
import { NextResponse } from 'next/server'
import type { AuthContext } from '@/lib/auth'
import type { RequestContext } from '@/server/core/context'
import { NotFoundError } from '@/server/core/errors'
import { RateLimitError } from '@/server/core/errors'
import { writeAudit } from '@/server/infrastructure/audit'
import { rateLimit } from '@/lib/security/rate-limit'
import { reportCatalogFor, getReportDef, canViewReport } from '@/server/infrastructure/reporting/registry'
import { runReport } from '@/server/infrastructure/reporting/runner'
import {
  exportReportSync, queueAsyncExport, listMyExports, readExportFile,
  parseFormat, type ExportFormat,
} from '@/server/infrastructure/reporting/export/exportService'
import { clampWindow } from '@/server/infrastructure/search/bounds'
import { num } from '@/server/infrastructure/reporting/sql'
import { db } from '@/lib/db'

// ── bounded budgets (ED-153): reports 30/min, exports 10/min, downloads 30/min
function assertBudget(key: string, limit: number, windowMs: number, faMsg: string): void {
  const rl = rateLimit(key, limit, windowMs)
  if (!rl.allowed) throw new RateLimitError(faMsg, { retryAfterSec: rl.retryAfterSec })
}

export function reportCatalog(auth: AuthContext) {
  return { reports: reportCatalogFor(auth) }
}

export async function runReportFor(auth: AuthContext, ctx: RequestContext, reportId: string, params: Record<string, unknown>) {
  assertBudget(`reports:${auth.user.id}`, 30, 60_000, 'درخواست گزارش‌ها بیش از حد مجاز است؛ کمی بعد تلاش کنید')
  const result = await runReport(auth, reportId, params)
  return { report: result }
}

export async function exportReport(
  auth: AuthContext, ctx: RequestContext, reportId: string,
  params: Record<string, unknown>, format: ExportFormat, lang: 'fa' | 'en', mode: 'sync' | 'async',
) {
  const def = getReportDef(reportId)
  if (!def) throw new NotFoundError('گزارش یافت نشد')
  if (!canViewReport(auth, def)) throw new NotFoundError('گزارش یافت نشد') // 404 not 403: don't reveal catalog

  if (mode === 'async') {
    // async spawns jobs + stored artifacts: tight budget
    assertBudget(`report-export-async:${auth.user.id}`, 10, 60_000, 'درخواست خروجی ناهمزمان بیش از حد مجاز است؛ کمی بعد تلاش کنید')
    const { jobId } = await queueAsyncExport(auth, reportId, params, format, lang)
    await writeAudit(ctx, {
      userId: auth.user.id, action: 'REPORT_EXPORT_ASYNC', entity: 'Report', entityId: reportId,
      newValues: { format, params: Object.keys(params).length, jobId },
    })
    return { queued: true, jobId, format }
  }

  // sync exports are in-memory + bounded by row caps: 30/min interactive wall
  assertBudget(`report-export-sync:${auth.user.id}`, 30, 60_000, 'درخواست خروجی بیش از حد مجاز است؛ کمی بعد تلاش کنید')
  const out = await exportReportSync(auth, reportId, params, format, lang)
  await writeAudit(ctx, {
    userId: auth.user.id, action: 'REPORT_EXPORT', entity: 'Report', entityId: reportId,
    newValues: { format, rows: out.rows, truncated: out.truncated, filename: out.filename },
  })
  // binary response with proper disposition (JSON envelope skipped by design)
  return new NextResponse(new Uint8Array(out.buffer), {
    status: 200,
    headers: {
      'Content-Type': out.mime,
      'Content-Disposition': `attachment; filename="${out.filename}"; filename*=UTF-8''${encodeURIComponent(out.filename)}`,
      'Cache-Control': 'no-store',
      'X-Rows': String(out.rows),
      'X-Truncated': String(out.truncated),
    },
  })
}

export { parseFormat }

export function myExports(auth: AuthContext) {
  return listMyExports(auth)
}

export async function downloadExport(auth: AuthContext, ctx: RequestContext, fileId: string) {
  assertBudget(`report-dl:${auth.user.id}`, 30, 60_000, 'دانلود بیش از حد مکرر است؛ کمی بعد تلاش کنید')
  const out = await readExportFile(auth, fileId)
  await writeAudit(ctx, {
    userId: auth.user.id, action: 'REPORT_DOWNLOAD', entity: 'StoredFile', entityId: fileId,
    newValues: { filename: out.filename, sizeBytes: out.buffer.length },
  })
  return new NextResponse(new Uint8Array(out.buffer), {
    status: 200,
    headers: {
      'Content-Type': out.mime,
      'Content-Disposition': `attachment; filename="${out.filename}"; filename*=UTF-8''${encodeURIComponent(out.filename)}`,
      'Cache-Control': 'no-store',
    },
  })
}

// ── LEGACY adapter (ED-159): v1 /admin/reports response shape, now bounded ─
// Preserved for the SPA quick-view + pentest contract; the rich center is
// /api/v1/reports*. All aggregations are SQL-side over a CLAMPED window
// (S-4/S-5 fix — the old implementation loaded 7 full tables into JS and
// ignored ?from/?to).
export async function legacyAdminReports(auth: AuthContext, fromRaw: string | null, toRaw: string | null) {
  const w = clampWindow(fromRaw, toRaw)
  const fromMs = w.from.getTime()
  const toMs = w.to.getTime()
  const params = { from: w.from.toISOString().slice(0, 10), to: w.to.toISOString().slice(0, 10) }

  const [revenue, paymentsR] = await Promise.all([
    runReport(auth, 'financial.revenue-summary', { ...params, groupBy: 'day' }),
    runReport(auth, 'financial.payments', { ...params, groupBy: 'day' }),
  ])

  const topProducts = await db.$queryRawUnsafe<{ name: string; count: number; revenue: number }[]>(
    `SELECT COALESCE(oi.nameFa, '?') AS name, SUM(oi.quantity) AS count, SUM(oi.total) AS revenue
     FROM OrderItem oi JOIN "Order" o ON oi.orderId = o.id
     WHERE o.status IN ('PAID','PREPARING','READY_TO_SHIP','SHIPPED','DELIVERED')
       AND o.createdAt >= ? AND o.createdAt <= ?
     GROUP BY name ORDER BY revenue DESC LIMIT 10`,
    fromMs, toMs,
  )
  const statusCounts = await db.$queryRawUnsafe<{ g: string; c: number }[]>(
    `SELECT status AS g, COUNT(*) AS c FROM MedicalCase
     WHERE deletedAt IS NULL AND createdAt >= ? AND createdAt <= ? GROUP BY g`,
    fromMs, toMs,
  )
  const referralStats = await db.$queryRawUnsafe<{ referrer: string; code: string; referredUser: string; orders: number; revenue: number }[]>(
    `SELECT rf.firstName || ' ' || rf.lastName AS referrer, rf.referralCode AS code,
            ru.firstName || ' ' || ru.lastName AS referredUser,
            (SELECT COUNT(*) FROM "Order" o WHERE o.userId = r.referredUserId
               AND o.status IN ('PAID','SHIPPED','DELIVERED')) AS orders,
            (SELECT COALESCE(SUM(o.total), 0) FROM "Order" o WHERE o.userId = r.referredUserId
               AND o.status IN ('PAID','SHIPPED','DELIVERED')) AS revenue
     FROM Referral r JOIN User rf ON r.referrerId = rf.id JOIN User ru ON r.referredUserId = ru.id
     ORDER BY revenue DESC LIMIT 20`,
  )
  const provinceStats = await db.$queryRawUnsafe<{ g: string; c: number }[]>(
    `SELECT COALESCE(NULLIF(pr.province, ''), 'نامشخص') AS g, COUNT(*) AS c
     FROM PatientProfile pr JOIN User u ON pr.userId = u.id
     WHERE u.deletedAt IS NULL GROUP BY g ORDER BY c DESC LIMIT 31`,
  )
  const recentPayments = await db.payment.findMany({
    where: { createdAt: { gte: w.from, lte: w.to } },
    orderBy: { createdAt: 'desc' }, take: 15,
    select: { code: true, amount: true, method: true, refNumber: true, createdAt: true, user: { select: { firstName: true, lastName: true } } },
  })

  const summary = revenue.summary ?? []
  const byDay = (revenue.rows as { bucket: string; income: number; expenses: number }[]).map((r) => ({ date: r.bucket, amount: r.income }))

  return {
    summary: {
      income: Number(summary.find((s) => s.key === 'income')?.value ?? 0),
      expenses: Number(summary.find((s) => s.key === 'expenses')?.value ?? 0),
      profit: Number(summary.find((s) => s.key === 'profit')?.value ?? 0),
      paidCount: Number((paymentsR.summary ?? []).find((s) => s.key === 'paidCount')?.value ?? 0),
      failedCount: Number((paymentsR.summary ?? []).find((s) => s.key === 'failedCount')?.value ?? 0),
      refundTotal: 0, // window-scoped refunds live in financial.payments rows
    },
    byDay,
    topProducts: topProducts.map((r) => ({ name: r.name, count: num(r.count), revenue: num(r.revenue) })),
    statusCounts: Object.fromEntries(statusCounts.map((r) => [r.g, num(r.c)])),
    referralStats: referralStats.map((r) => ({
      referrer: r.referrer, code: r.code, referredUser: r.referredUser,
      orders: num(r.orders), revenue: num(r.revenue), commission: Math.round(num(r.revenue) * 0.05),
    })),
    provinceStats: Object.fromEntries(provinceStats.map((r) => [r.g, num(r.c)])),
    recentPayments: recentPayments.map((p) => ({
      code: p.code, amount: p.amount, method: p.method, refNumber: p.refNumber,
      user: `${p.user.firstName} ${p.user.lastName}`, createdAt: p.createdAt.toISOString(),
    })),
  }
}
