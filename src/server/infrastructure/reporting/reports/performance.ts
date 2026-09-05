// ── Performance reports (PHASE 14) ─────────────────────────────────────────
// Surfaces the telemetry streams previous phases built:
//   • AIInferenceLog        (PHASE 11 MLOps monitoring)
//   • IntegrationCallLog    (PHASE 13 integration telemetry)
//   • job queue + governance + audit volume (system pulse)
// These existed but had no reporting surface (audit S-10).
import { z } from 'zod'
import { db } from '@/lib/db'
import { bucketAggregate, num } from '../sql'
import { baseParams, windowFor, buildMeta, VIEW_ROWS } from './common'
import { REPORT_IDS, type ReportDef, type ReportResult } from '../types'
import { queueStats } from '@/server/infrastructure/jobs'
import { workflowHealthSnapshot } from '@/lib/workflow/governance'

async function aiPerformanceReport(params: z.infer<typeof baseParams>): Promise<ReportResult> {
  const start = Date.now()
  const w = windowFor(params)
  const groupBy = params.groupBy === 'none' ? 'day' : (params.groupBy ?? 'day')

  const [byDay, agg, p95row] = await Promise.all([
    bucketAggregate('AIInferenceLog', `COUNT(*) AS c, SUM(CASE WHEN status='OK' THEN 1 ELSE 0 END) AS ok, AVG(CASE WHEN status='OK' THEN processingMs END) AS avgMs`,
      'createdAt', groupBy, w.fromMs, w.toMs),
    db.$queryRawUnsafe<{ c: number; ok: number; avgConfidence: number | null; avgQuality: number | null; replays: number; cost: number | null; avgMs: number | null }[]>(
      `SELECT COUNT(*) AS c,
              SUM(CASE WHEN status='OK' THEN 1 ELSE 0 END) AS ok,
              AVG(CASE WHEN status='OK' THEN confidence END) AS avgConfidence,
              AVG(CASE WHEN status='OK' THEN quality END) AS avgQuality,
              SUM(CASE WHEN replay=1 THEN 1 ELSE 0 END) AS replays,
              SUM(costUnits) AS cost,
              AVG(CASE WHEN status='OK' THEN processingMs END) AS avgMs
       FROM AIInferenceLog WHERE createdAt >= ? AND createdAt <= ?`,
      w.fromMs, w.toMs,
    ),
    db.$queryRawUnsafe<{ processingMs: number | null }[]>(
      `SELECT processingMs FROM AIInferenceLog
       WHERE createdAt >= ? AND createdAt <= ? AND status='OK' AND processingMs IS NOT NULL
       ORDER BY processingMs LIMIT 1
       OFFSET (SELECT CAST(COUNT(*) * 0.95 AS INTEGER) FROM AIInferenceLog
               WHERE createdAt >= ? AND createdAt <= ? AND status='OK' AND processingMs IS NOT NULL)`,
      w.fromMs, w.toMs, w.fromMs, w.toMs,
    ),
  ])

  const a = agg[0] ?? { c: 0, ok: 0, avgConfidence: null, avgQuality: null, replays: 0, cost: null, avgMs: null }
  const chartRows = byDay.slice(0, VIEW_ROWS).map((r) => ({ bucket: r.bucket, c: num(r.c), ok: num(r.ok), avgMs: Math.round(num(r.avgMs)) }))
  return {
    columns: [
      { key: 'bucket', fa: 'بازه', en: 'Period', type: 'date' },
      { key: 'c', fa: 'استنتاج', en: 'Inferences', type: 'number' },
      { key: 'ok', fa: 'موفق', en: 'OK', type: 'number' },
      { key: 'avgMs', fa: 'میانگین زمان (ms)', en: 'Avg latency (ms)', type: 'number' },
    ],
    rows: chartRows,
    totals: { c: num(a.c) },
    summary: [
      { key: 'inferences', fa: 'کل استنتاج‌ها', en: 'Total inferences', value: num(a.c), type: 'number' },
      { key: 'successRate', fa: 'نرخ موفقیت (٪)', en: 'Success rate (%)', value: num(a.c) ? Math.round((num(a.ok) / num(a.c)) * 100) : 0, type: 'percent' },
      { key: 'p95ms', fa: 'p95 تأخیر (ms)', en: 'p95 latency (ms)', value: num(p95row[0]?.processingMs), type: 'number' },
      { key: 'avgConfidence', fa: 'میانگین اطمینان (٪)', en: 'Avg confidence (%)', value: Math.round(num(a.avgConfidence) * 100), type: 'percent' },
      { key: 'avgQuality', fa: 'میانگین کیفیت تصویر (٪)', en: 'Avg image quality (%)', value: Math.round(num(a.avgQuality) * 100), type: 'percent' },
      { key: 'cost', fa: 'واحد هزینه', en: 'Cost units', value: Math.round(num(a.cost) * 100) / 100, type: 'number' },
      { key: 'replays', fa: 'Replay', en: 'Replays', value: num(a.replays), type: 'number' },
    ],
    chart: {
      bucketKey: 'bucket',
      series: [{ key: 'c', fa: 'استنتاج', en: 'Inferences' }, { key: 'ok', fa: 'موفق', en: 'OK' }],
      rows: chartRows,
    },
    meta: buildMeta(REPORT_IDS.aiPerformance, 'PERFORMANCE', w, { groupBy, totalRows: chartRows.length, viewRows: chartRows.length, ms: Date.now() - start }),
  }
}

async function integrationsPerformanceReport(params: z.infer<typeof baseParams>): Promise<ReportResult> {
  const start = Date.now()
  const w = windowFor(params)
  const groupBy = params.groupBy === 'none' ? 'day' : (params.groupBy ?? 'day')
  const [rows, byDay] = await Promise.all([
    db.$queryRawUnsafe<{ g: string; provider: string; status: string; c: number; avgLat: number | null; minLat: number | null; maxLat: number | null }[]>(
      `SELECT kind AS g, provider, status,
              COUNT(*) AS c, AVG(latencyMs) AS avgLat, MIN(latencyMs) AS minLat, MAX(latencyMs) AS maxLat
       FROM IntegrationCallLog WHERE createdAt >= ? AND createdAt <= ?
       GROUP BY g, provider, status ORDER BY c DESC LIMIT 200`,
      w.fromMs, w.toMs,
    ),
    bucketAggregate('IntegrationCallLog', `COUNT(*) AS c, SUM(CASE WHEN status='SUCCESS' THEN 1 ELSE 0 END) AS ok`,
      'createdAt', groupBy, w.fromMs, w.toMs),
  ])
  const mapped = rows.map((r) => ({
    kind: r.g, provider: r.provider, status: r.status, calls: num(r.c),
    avgLat: Math.round(num(r.avgLat)), minLat: Math.round(num(r.minLat)), maxLat: Math.round(num(r.maxLat)),
  }))
  const total = mapped.reduce((s, r) => s + r.calls, 0)
  const ok = mapped.filter((r) => r.status === 'SUCCESS' || r.status === 'REPLAYED').reduce((s, r) => s + r.calls, 0)
  const chartRows = byDay.slice(0, VIEW_ROWS).map((r) => ({ bucket: r.bucket, c: num(r.c), ok: num(r.ok) }))
  return {
    columns: [
      { key: 'kind', fa: 'سرویس', en: 'Kind', type: 'enum' },
      { key: 'provider', fa: 'Provider', en: 'Provider', type: 'text' },
      { key: 'status', fa: 'وضعیت', en: 'Status', type: 'enum' },
      { key: 'calls', fa: 'فراخوانی', en: 'Calls', type: 'number' },
      { key: 'avgLat', fa: 'میانگین (ms)', en: 'Avg (ms)', type: 'number' },
      { key: 'maxLat', fa: 'بیشینه (ms)', en: 'Max (ms)', type: 'number' },
    ],
    rows: mapped,
    totals: { calls: total },
    summary: [
      { key: 'calls', fa: 'کل فراخوانی‌ها', en: 'Total calls', value: total, type: 'number' },
      { key: 'successRate', fa: 'نرخ موفقیت (٪)', en: 'Success rate (%)', value: total ? Math.round((ok / total) * 100) : 100, type: 'percent' },
    ],
    chart: {
      bucketKey: 'bucket',
      series: [{ key: 'c', fa: 'فراخوانی', en: 'Calls' }, { key: 'ok', fa: 'موفق', en: 'OK' }],
      rows: chartRows,
    },
    meta: buildMeta(REPORT_IDS.integrationsPerformance, 'PERFORMANCE', w, { groupBy, totalRows: mapped.length, viewRows: mapped.length, ms: Date.now() - start }),
  }
}

async function systemPerformanceReport(params: z.infer<typeof baseParams>): Promise<ReportResult> {
  const start = Date.now()
  const w = windowFor(params)
  const groupBy = params.groupBy === 'none' ? 'day' : (params.groupBy ?? 'day')
  const [auditByDay, stuck, auditAgg] = await Promise.all([
    bucketAggregate('AuditLog', `COUNT(*) AS c`, 'createdAt', groupBy, w.fromMs, w.toMs),
    workflowHealthSnapshot(),
    db.$queryRawUnsafe<{ c: number; actors: number; sensitive: number }[]>(
      `SELECT COUNT(*) AS c, COUNT(DISTINCT userId) AS actors, SUM(CASE WHEN sensitive=1 THEN 1 ELSE 0 END) AS sensitive
       FROM AuditLog WHERE createdAt >= ? AND createdAt <= ?`,
      w.fromMs, w.toMs,
    ),
  ])
  const q = queueStats()
  const a = auditAgg[0] ?? { c: 0, actors: 0, sensitive: 0 }
  const chartRows = auditByDay.slice(0, VIEW_ROWS).map((r) => ({ bucket: r.bucket, c: num(r.c) }))
  const rows = [
    { component: 'job-queue', metricFa: 'شغل در صف / مرده', value: q.pending, extra: q.dead },
    { component: 'workflow-sla', metricFa: 'نمونه‌های SLA-دار', value: stuck.length, extra: 0 },
    { component: 'audit', metricFa: 'رویداد حساس', value: num(a.sensitive), extra: num(a.c) },
    { component: 'audit-actors', metricFa: 'بازیگران فعال', value: num(a.actors), extra: 0 },
    { component: 'job-types', metricFa: 'انواع شغل ثبت‌شده', value: q.types.length, extra: 0 },
  ]
  return {
    columns: [
      { key: 'component', fa: 'مؤلفه', en: 'Component', type: 'text' },
      { key: 'metricFa', fa: 'سنجه', en: 'Metric', type: 'text' },
      { key: 'value', fa: 'مقدار', en: 'Value', type: 'number' },
      { key: 'extra', fa: 'مکمل', en: 'Extra', type: 'number' },
    ],
    rows,
    totals: {},
    summary: [
      { key: 'pendingJobs', fa: 'شغل‌های در صف', en: 'Pending jobs', value: q.pending, type: 'number' },
      { key: 'deadJobs', fa: 'DLQ', en: 'Dead-letter queue', value: q.dead, type: 'number' },
      { key: 'auditEvents', fa: 'رویدادهای Audit', en: 'Audit events', value: num(a.c), type: 'number' },
      { key: 'slaFlagged', fa: 'SLA-دار', en: 'SLA-flagged', value: stuck.length, type: 'number' },
    ],
    chart: {
      bucketKey: 'bucket',
      series: [{ key: 'c', fa: 'رویداد Audit', en: 'Audit events' }],
      rows: chartRows,
    },
    meta: buildMeta(REPORT_IDS.systemPerformance, 'PERFORMANCE', w, { groupBy, totalRows: rows.length, viewRows: rows.length, ms: Date.now() - start }),
  }
}

export const performanceReports: ReportDef[] = [
  {
    id: REPORT_IDS.aiPerformance, category: 'PERFORMANCE',
    fa: 'عملکرد AI', en: 'AI performance',
    descFa: 'استنتاج‌ها، تأخیر p95، اطمینان، هزینه', descEn: 'Inferences, p95 latency, confidence, cost',
    permission: 'view_ai_analyses', timeScoped: true, hasChart: true, defaultGroupBy: 'day',
    params: baseParams, run: (p) => aiPerformanceReport(p),
  },
  {
    id: REPORT_IDS.integrationsPerformance, category: 'PERFORMANCE',
    fa: 'عملکرد یکپارچه‌سازی‌ها', en: 'Integrations performance',
    descFa: 'فراخوانی سرویس‌های خارجی با تأخیر و نرخ موفقیت', descEn: 'External calls with latency and success rate',
    permission: 'view_audit_logs', timeScoped: true, hasChart: true, defaultGroupBy: 'day',
    params: baseParams, run: (p) => integrationsPerformanceReport(p),
  },
  {
    id: REPORT_IDS.systemPerformance, category: 'PERFORMANCE',
    fa: 'ضربان سیستم', en: 'System pulse',
    descFa: 'صف شغل‌ها، SLA گردش کار، حجم Audit', descEn: 'Job queue, workflow SLA, audit volume',
    permission: 'view_reports', timeScoped: true, hasChart: true, defaultGroupBy: 'day',
    params: baseParams, run: (p) => systemPerformanceReport(p),
  },
]
