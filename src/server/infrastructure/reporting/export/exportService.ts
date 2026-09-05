// ── Report Export Service (PHASE 14, ED-156) ───────────────────────────────
// The ONLY path that turns a report into a file (gate SR5):
//   sync  ≤ REPORT_BOUNDS.syncExportRows()   → in-memory buffer response
//   async >  sync cap, ≤ asyncExportRows()   → JobQueue job → StoredFile
//          (category DOCUMENT, class TEMPORARY, 24h TTL — the PHASE 10
//          lifecycle sweeper purges it automatically) → REPORT_READY
//          notification → owner-only download route.
import { createHash } from 'crypto'
import { db } from '@/lib/db'
import type { AuthContext } from '@/lib/auth'
import { ForbiddenError, NotFoundError, ValidationError, AppError } from '@/server/core/errors'
import { runReport } from '../runner'
import { getReportDef, canViewReport } from '../registry'
import { REPORT_BOUNDS } from '@/server/infrastructure/search/bounds'
import { toCsv, type ExportTable } from './csv'
import { toXlsx } from './xlsx'
import { toPdf } from './pdf'
import { notify } from '@/lib/notify'
import { getStorageDriver, renditionKey, ZONES } from '@/server/infrastructure/media/storage-driver'
import { enqueue } from '@/server/infrastructure/jobs'
import { logger } from '@/server/core/logger'

export const EXPORT_FORMATS = ['csv', 'xlsx', 'pdf'] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]

const MIME: Record<ExportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
}

export function parseFormat(v: string | null | undefined): ExportFormat {
  const f = (v || '').toLowerCase()
  if (!EXPORT_FORMATS.includes(f as ExportFormat)) {
    throw new ValidationError('فرمت خروجی باید csv، xlsx یا pdf باشد', { allowed: EXPORT_FORMATS })
  }
  return f as ExportFormat
}

/** ReportResult → ExportTable (columns/rows/totals + meta preamble). */
export function toExportTable(result: {
  meta: { reportId: string; from: string; to: string; generatedAt: string; groupBy?: string; truncated: boolean; totalRows: number; noteFa?: string; noteEn?: string }
  columns: { key: string; fa: string; en: string }[]
  rows: Record<string, unknown>[]
  totals?: Record<string, number>
}, def: { fa: string; en: string }, lang: 'fa' | 'en'): ExportTable {
  const m = result.meta
  const metaLines = [
    `${lang === 'fa' ? 'بازه' : 'Window'}: ${m.from.slice(0, 10)} → ${m.to.slice(0, 10)}`,
    `${lang === 'fa' ? 'تولید' : 'Generated'}: ${m.generatedAt}`,
    ...(m.groupBy && m.groupBy !== 'none' ? [`${lang === 'fa' ? 'گروه‌بندی' : 'Grouping'}: ${m.groupBy}`] : []),
    ...(m.truncated ? [`${lang === 'fa' ? `توجه: خروجی به سقف مجاز بریده شد (${m.totalRows} ردیف موجود)` : `Truncated to the export cap (${m.totalRows} rows exist)`}`] : []),
    ...(lang === 'fa' ? [m.noteFa].filter(Boolean) : [m.noteEn].filter(Boolean)) as string[],
  ]
  return {
    titleFa: def.fa,
    titleEn: def.en,
    columns: result.columns,
    rows: result.rows,
    totals: result.totals,
    metaLines,
  }
}

export function exportFilename(reportId: string, from: string, to: string, format: ExportFormat): string {
  return `${reportId}_${from.slice(0, 10)}_${to.slice(0, 10)}.${format}`
}

function buildFile(
  table: ExportTable, format: ExportFormat, lang: 'fa' | 'en', windowText: string, generatedAt: string,
): { buffer: Buffer; mime: string } {
  if (format === 'csv') return { buffer: Buffer.from(toCsv(table, lang), 'utf8'), mime: MIME.csv }
  if (format === 'xlsx') return { buffer: toXlsx(table, lang), mime: MIME.xlsx }
  // pdf is async inside toPdf
  throw new ValidationError('pdf باید از مسیر async ساخته شود')
}

// ── SYNC EXPORT (bounded) ──────────────────────────────────────────────────

export interface SyncExportResult {
  filename: string
  mime: string
  buffer: Buffer
  rows: number
  truncated: boolean
}

export async function exportReportSync(
  auth: AuthContext,
  reportId: string,
  params: Record<string, unknown>,
  format: ExportFormat,
  lang: 'fa' | 'en',
): Promise<SyncExportResult> {
  const cap = REPORT_BOUNDS.syncExportRows()
  const result = await runReport(auth, reportId, params, { maxRows: cap, noCache: true })
  const def = getReportDef(reportId)!
  const table = toExportTable(result, def, lang)
  if (result.rows.length > cap || result.meta.totalRows > cap) {
    throw new AppError('PAYLOAD_TOO_LARGE', 'خروجی بزرگ‌تر از سقف همزمان است — از خروجی ناهمزمان (async) استفاده کنید', 413, {
      limitRows: cap,
      actualRows: result.meta.totalRows,
    })
  }
  let buffer: Buffer
  if (format === 'pdf') {
    buffer = await toPdf(table, {
      lang,
      windowText: `${lang === 'fa' ? 'بازه' : 'Window'}: ${result.meta.from.slice(0, 10)} → ${result.meta.to.slice(0, 10)}`,
      generatedAt: result.meta.generatedAt,
    })
  } else {
    buffer = buildFile(table, format, lang, result.meta.from, result.meta.generatedAt).buffer
  }
  return {
    filename: exportFilename(reportId, result.meta.from, result.meta.to, format),
    mime: MIME[format],
    buffer,
    rows: result.rows.length,
    truncated: result.meta.truncated,
  }
}

// ── ASYNC EXPORT (job → StoredFile → notification) ─────────────────────────

export interface AsyncExportJobPayload {
  reportId: string
  params: Record<string, unknown>
  format: ExportFormat
  lang: 'fa' | 'en'
  requester: { id: string; phone: string; role: string; firstName: string; lastName: string; permissions: string[] }
}

export async function queueAsyncExport(
  auth: AuthContext,
  reportId: string,
  params: Record<string, unknown>,
  format: ExportFormat,
  lang: 'fa' | 'en',
): Promise<{ jobId: string }> {
  const def = getReportDef(reportId)
  if (!def) throw new NotFoundError('گزارش یافت نشد')
  if (!canViewReport(auth, def)) throw new ForbiddenError('دسترسی به این گزارش ندارید')
  const payload: AsyncExportJobPayload = {
    reportId, params, format, lang,
    requester: {
      id: auth.user.id, phone: auth.user.phone, role: auth.user.role,
      firstName: auth.user.firstName, lastName: auth.user.lastName,
      permissions: auth.permissions,
    },
  }
  const jobId = enqueue('report-export', payload, { maxAttempts: 2, backoffMs: 5_000 })
  return { jobId }
}

const EXT: Record<ExportFormat, string> = { csv: 'csv', xlsx: 'xlsx', pdf: 'pdf' }

/** job handler body (registered in bootstrap) — never throws to the caller */
export async function runExportJob(payload: AsyncExportJobPayload): Promise<void> {
  const { reportId, params, format, lang, requester } = payload
  const auth: AuthContext = {
    user: { id: requester.id, phone: requester.phone, role: requester.role, firstName: requester.firstName, lastName: requester.lastName },
    permissions: requester.permissions,
  }
  const cap = REPORT_BOUNDS.asyncExportRows
  const result = await runReport(auth, reportId, params, { maxRows: cap, noCache: true })
  const def = getReportDef(reportId)!
  const table = toExportTable(result, def, lang)

  let buffer: Buffer
  if (format === 'pdf') {
    buffer = await toPdf(table, {
      lang,
      windowText: `${lang === 'fa' ? 'بازه' : 'Window'}: ${result.meta.from.slice(0, 10)} → ${result.meta.to.slice(0, 10)}`,
      generatedAt: result.meta.generatedAt,
    })
  } else {
    buffer = buildFile(table, format, lang, result.meta.from, result.meta.generatedAt).buffer
  }

  // persist as TEMPORARY StoredFile (24h TTL, lifecycle auto-purge, ED-156)
  const sha256 = createHash('sha256').update(buffer).digest('hex')
  const key = renditionKey(ZONES.filesTemp, sha256, 1, 'original', EXT[format])
  await getStorageDriver().put(key, buffer)
  const expiresAt = new Date(Date.now() + REPORT_BOUNDS.exportTtlHours * 3_600_000)
  const file = await db.storedFile.create({
    data: {
      ownerId: requester.id,
      category: 'DOCUMENT',
      type: 'DOCUMENT',
      accessClass: 'TEMPORARY',
      lifecycleState: 'ACTIVE',
      status: 'READY',
      currentVersion: 1,
      expiresAt,
      fileName: exportFilename(reportId, result.meta.from, result.meta.to, format),
      mime: MIME[format],
      sizeBytes: buffer.length,
      sha256,
      versions: {
        create: {
          version: 1,
          fileName: exportFilename(reportId, result.meta.from, result.meta.to, format),
          mime: MIME[format],
          sizeBytes: buffer.length,
          sha256,
          storageKey: key,
          scanStatus: 'CLEAN',
          scanEngine: 'report-export',
          variants: {
            create: { variant: 'original', storageKey: key, mime: MIME[format], sizeBytes: buffer.length, ready: true },
          },
        },
      },
    },
  })
  await notify(requester.id, 'REPORT_EXPORT_READY', {
    link: `/api/v1/reports/exports/${file.id}`,
    extraFa: def.fa,
    extraEn: def.en,
  })
  logger.info('report export ready', { reportId, fileId: file.id, format, rows: result.rows.length })
}

// ── LIST + DOWNLOAD (owner-scoped, ED-157) ────────────────────────────────

export async function listMyExports(auth: AuthContext): Promise<{ exports: unknown[] }> {
  const rows = await db.storedFile.findMany({
    where: {
      ownerId: auth.user.id,
      category: 'DOCUMENT',
      accessClass: 'TEMPORARY',
      lifecycleState: 'ACTIVE',
      status: 'READY',
      fileName: { not: null },
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { id: true, fileName: true, mime: true, sizeBytes: true, createdAt: true, expiresAt: true },
  })
  return { exports: rows }
}

export async function readExportFile(auth: AuthContext, fileId: string): Promise<{ buffer: Buffer; mime: string; filename: string; fileId: string }> {
  if (!/^[a-zA-Z0-9]{10,40}$/.test(fileId)) throw new ValidationError('شناسه فایل نامعتبر است')
  const file = await db.storedFile.findUnique({ where: { id: fileId } })
  if (!file || file.lifecycleState !== 'ACTIVE') throw new NotFoundError('فایل یافت نشد')
  // owner-only (staff exports may contain cross-patient aggregates — the
  // requester earned them via the report permission; other staff did not)
  if (file.ownerId !== auth.user.id && auth.user.role !== 'ADMIN') {
    throw new ForbiddenError('این فایل خروجی متعلق به شما نیست')
  }
  if (file.expiresAt && file.expiresAt < new Date()) throw new NotFoundError('فایل منقضی شده است')
  const version = await db.storedFileVersion.findUnique({ where: { fileId_version: { fileId, version: file.currentVersion } } })
  if (!version) throw new NotFoundError('نسخه فایل یافت نشد')
  const buffer = await getStorageDriver().get(version.storageKey)
  return { buffer, mime: file.mime, filename: file.fileName || `export.${EXT.csv}`, fileId }
}
