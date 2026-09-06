// ── Operational reports (PHASE 14) ─────────────────────────────────────────
// Queue/SLA/follow-up/workflow-health views for EXPERT_1, EXPERT_2, OPERATOR
// (view_reports holders) — operational pulse, no financial P&L.
import { z } from 'zod'
import { db } from '@/lib/db'
import { bucketAggregate, groupAggregate, num } from '../sql'
import { baseParams, windowFor, buildMeta, VIEW_ROWS } from './common'
import { REPORT_IDS, type ReportDef, type ReportResult } from '../types'
import { workflowHealthSnapshot } from '@/lib/workflow/governance'
import { queueStats } from '@/server/infrastructure/jobs'

async function caseStatusReport(params: z.infer<typeof baseParams>): Promise<ReportResult> {
  const start = Date.now()
  const w = windowFor(params)
  const rows = await groupAggregate(
    'MedicalCase', `COUNT(*) AS c`, 'status',
    'deletedAt IS NULL AND createdAt >= ? AND createdAt <= ?', [w.fromMs, w.toMs],
    'c DESC', VIEW_ROWS,
  )
  const total = rows.reduce((s, r) => s + num(r.c), 0)
  return {
    columns: [
      { key: 'status', fa: 'وضعیت پرونده', en: 'Case status', type: 'enum' },
      { key: 'c', fa: 'تعداد', en: 'Count', type: 'number' },
    ],
    rows: rows.map((r) => ({ status: r.g, c: num(r.c) })),
    totals: { c: total },
    meta: buildMeta(REPORT_IDS.caseStatus, 'OPERATIONAL', w, { totalRows: rows.length, viewRows: rows.length, ms: Date.now() - start }),
  }
}

async function queueSlaReport(params: z.infer<typeof baseParams>): Promise<ReportResult> {
  const start = Date.now()
  const w = windowFor(params)
  // live queue: open cases + hours spent in CURRENT status (WorkflowState
  // projection — PHASE 12), aggregated per status. Bounded to the window's
  // created cases; statuses without a projection fall back to createdAt.
  const rows = await db.$queryRawUnsafe<{ g: string; c: number; avgHours: number | null }[]>(
    `SELECT c.status AS g, COUNT(*) AS c,
            AVG(CASE WHEN ws.enteredAt IS NOT NULL
                 THEN (julianday('now') - julianday(ws.enteredAt / 1000, 'unixepoch')) * 24
                 ELSE (julianday('now') - julianday(c.createdAt / 1000, 'unixepoch')) * 24 END) AS avgHours
     FROM MedicalCase c
     LEFT JOIN WorkflowState ws ON ws.entityType = 'CASE' AND ws.entityId = c.id
     WHERE c.deletedAt IS NULL AND c.createdAt >= ? AND c.createdAt <= ?
       AND c.status NOT IN ('CLOSED', 'CANCELLED', 'REJECTED')
     GROUP BY g ORDER BY c DESC LIMIT 200`,
    w.fromMs, w.toMs,
  )
  const total = rows.reduce((s, r) => s + num(r.c), 0)
  const worstWait = rows.reduce((m, r) => Math.max(m, num(r.avgHours)), 0)
  return {
    columns: [
      { key: 'status', fa: 'وضعیت (صف فعال)', en: 'Status (live queue)', type: 'enum' },
      { key: 'c', fa: 'تعداد پرونده', en: 'Cases', type: 'number' },
      { key: 'avgHours', fa: 'میانگین انتظار (ساعت)', en: 'Avg wait (h)', type: 'number' },
    ],
    rows: rows.map((r) => ({ status: r.g, c: num(r.c), avgHours: Math.round(num(r.avgHours) * 10) / 10 })),
    totals: { c: total },
    summary: [
      { key: 'queue', fa: 'پرونده‌های در جریان', en: 'Open cases in window', value: total, type: 'number' },
      { key: 'worstWait', fa: 'طولانی‌ترین انتظار (ساعت)', en: 'Worst avg wait (h)', value: Math.round(worstWait * 10) / 10, type: 'number' },
    ],
    meta: buildMeta(REPORT_IDS.queueSla, 'OPERATIONAL', w, {
      totalRows: rows.length, viewRows: rows.length, ms: Date.now() - start,
      noteFa: 'انتظار بر پایهٔ زمان ورود به وضعیت فعلی (پروجکشن PHASE 12) محاسبه می‌شود.',
      noteEn: 'Wait time uses the current-status projection (PHASE 12 WorkflowState).',
    }),
  }
}

async function followupComplianceReport(params: z.infer<typeof baseParams>): Promise<ReportResult> {
  const start = Date.now()
  const w = windowFor(params)
  const rows = await groupAggregate(
    'FollowUp', `COUNT(*) AS c`, 'status',
    'dueDate >= ? AND dueDate <= ?', [w.fromMs, w.toMs],
    'c DESC', VIEW_ROWS,
  )
  const byStatus: Record<string, number> = {}
  for (const r of rows) byStatus[String(r.g)] = num(r.c)
  const done = byStatus['COMPLETED'] ?? 0
  const overdue = byStatus['OVERDUE'] ?? 0
  const due = done + overdue + (byStatus['DUE'] ?? 0)
  return {
    columns: [
      { key: 'status', fa: 'وضعیت پیگیری', en: 'Follow-up status', type: 'enum' },
      { key: 'c', fa: 'تعداد', en: 'Count', type: 'number' },
    ],
    rows: rows.map((r) => ({ status: r.g, c: num(r.c) })),
    totals: { c: rows.reduce((s, r) => s + num(r.c), 0) },
    summary: [
      { key: 'compliance', fa: 'نرخ تکمیل به‌موقع (٪)', en: 'On-time completion (%)', value: due > 0 ? Math.round((done / due) * 100) : 0, type: 'percent' },
      { key: 'overdue', fa: 'پیگیری‌های عقب‌افتاده', en: 'Overdue follow-ups', value: overdue, type: 'number' },
    ],
    meta: buildMeta(REPORT_IDS.followupCompliance, 'OPERATIONAL', w, { totalRows: rows.length, viewRows: rows.length, ms: Date.now() - start }),
  }
}

async function workflowHealthReport(): Promise<ReportResult> {
  const start = Date.now()
  const stuck = await workflowHealthSnapshot()
  const q = queueStats()
  // aggregate stuck instances per machine
  const byMachine: Record<string, { count: number; worstHours: number; example: string }> = {}
  for (const s of stuck) {
    const m = (byMachine[s.entityType] ??= { count: 0, worstHours: 0, example: s.entityId })
    m.count += 1
    m.worstHours = Math.max(m.worstHours, Math.round((Date.now() - s.enteredAt.getTime()) / 36e5))
  }
  const rows = Object.entries(byMachine).map(([entity, m]) => ({ entity, count: m.count, worstHours: m.worstHours }))
  return {
    columns: [
      { key: 'entity', fa: 'ماشین گردش کار', en: 'Workflow machine', type: 'enum' },
      { key: 'count', fa: 'نمونه‌های در حالت هشدار', en: 'SLA-flagged', type: 'number' },
      { key: 'worstHours', fa: 'بدترین سن (ساعت)', en: 'Worst age (h)', type: 'number' },
    ],
    rows,
    totals: { count: stuck.length },
    summary: [
      { key: 'stuck', fa: 'کل نمونه‌های SLA-دار', en: 'Total SLA-flagged', value: stuck.length, type: 'number' },
      { key: 'queuePending', fa: 'شغل‌های در صف', en: 'Pending jobs', value: q.pending, type: 'number' },
      { key: 'queueDead', fa: 'شغل‌های مرده (DLQ)', en: 'Dead-letter jobs', value: q.dead, type: 'number' },
    ],
    meta: buildMeta(REPORT_IDS.workflowHealth, 'OPERATIONAL', windowFor({}), {
      totalRows: rows.length, viewRows: rows.length, ms: Date.now() - start,
      noteFa: 'سنجه‌های زندهٔ Governance Runtime (PHASE 12) — بازهٔ زمانی اعمال نمی‌شود.',
      noteEn: 'Live governance runtime metrics (PHASE 12) — not time-windowed.',
    }),
  }
}

export const operationalReports: ReportDef[] = [
  {
    id: REPORT_IDS.caseStatus, category: 'OPERATIONAL',
    fa: 'توزیع وضعیت پرونده‌ها', en: 'Case status distribution',
    descFa: 'تعداد پرونده‌های ایجادشده در بازه به تفکیک وضعیت', descEn: 'Cases created in window, by status',
    permission: 'view_reports', timeScoped: true, hasChart: false,
    params: baseParams, run: (p) => caseStatusReport(p),
  },
  {
    id: REPORT_IDS.queueSla, category: 'OPERATIONAL',
    fa: 'صف فعال و SLA انتظار', en: 'Live queue & wait SLA',
    descFa: 'پرونده‌های در جریان با میانگین ساعت انتظار در وضعیت فعلی', descEn: 'Open cases with avg hours in current status',
    permission: 'view_reports', timeScoped: true, hasChart: false,
    params: baseParams, run: (p) => queueSlaReport(p),
  },
  {
    id: REPORT_IDS.followupCompliance, category: 'OPERATIONAL',
    fa: 'انطباق پیگیری درمان', en: 'Follow-up compliance',
    descFa: 'وضعیت پیگیری‌های سررسید در بازه + نرخ تکمیل به‌موقع', descEn: 'Follow-ups due in window + on-time rate',
    permission: 'view_reports', timeScoped: true, hasChart: false,
    params: baseParams, run: (p) => followupComplianceReport(p),
  },
  {
    id: REPORT_IDS.workflowHealth, category: 'OPERATIONAL',
    fa: 'سلامت گردش کار', en: 'Workflow health',
    descFa: 'نمونه‌های دارای هشدار SLA و صف شغل‌ها (زنده)', descEn: 'SLA-flagged instances + job queue (live)',
    permission: 'manage_workflow_recovery', roles: ['ADMIN'], timeScoped: false, hasChart: false,
    params: baseParams, run: () => workflowHealthReport(),
  },
]
