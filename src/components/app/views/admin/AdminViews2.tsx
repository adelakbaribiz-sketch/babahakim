'use client'
// Admin: Prices (Excel/CSV import + bulk %) · Reports (charts) · Audit logs · Questionnaire editor · AI models · SMS log
import React, { useEffect, useState } from 'react'
import { useApp } from '@/contexts/app'
import { ApiError } from '@/lib/api-error'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'
import { SectionCard, StatCard, JalaliDate, LoadingRows, EmptyState, ErrorState, Money, StatusBadge } from '../../shared/atoms'
import { fmtMoney } from '@/lib/i18n'
import { Tags, BarChart3, ShieldCheck, FileText, Bot, MessageSquareText, Upload, Percent, CheckCircle2, XCircle, Download } from 'lucide-react'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar } from 'recharts'
// PHASE 07 (§22/§27): chart colors ONLY via design-system tokens
import { chartTheme } from '@/design-system/tokens'

// ── Prices: import + bulk + history ─────────────────────────────────────
export function AdminPricesPage() {
  const { t, lang, api } = useApp()
  const [csv, setCsv] = useState('')
  const [preview, setPreview] = useState<{ rows: { line: number; sku: string; productName: string; oldPrice: number | null; newPrice: number; valid: boolean; error?: string }[]; summary: { total: number; valid: number; invalid: number }; detected: { header: string[]; delimiter: string } } | null>(null)
  const [percent, setPercent] = useState('10')
  const [history, setHistory] = useState<{ id: string; oldPrice?: number; newPrice: number; reason: string; createdAt: string; product: { sku: string; nameFa: string }; changedBy: { firstName: string; lastName: string; role: string } }[]>([])
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const [historyError, setHistoryError] = useState<string | null>(null)

  // PHASE 09 (F04): price history errors surface with retry — not swallowed
  const loadHistory = () => { api<{ history: typeof history }>('/api/v1/admin/prices').then((d) => { setHistory(d.history); setHistoryError(null) }).catch((e) => setHistoryError((e as ApiError).supportRef)) }
  useEffect(loadHistory, [api, reload])

  async function doPreview() {
    try {
      const d = await api<NonNullable<typeof preview>>('/api/v1/admin/prices', { method: 'POST', json: { mode: 'preview', csv } })
      setPreview(d)
    } catch (e) { toast.error((e as Error).message) }
  }
  async function doCommit() {
    setBusy(true)
    try {
      await api('/api/v1/admin/prices', { method: 'POST', json: { mode: 'commit', csv } })
      toast.success('قیمت‌ها اعمال شد ✓'); setPreview(null); setCsv(''); setReload((x) => x + 1)
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  async function doBulk() {
    setBusy(true)
    try {
      const d = await api<{ message: string }>('/api/v1/admin/prices', { method: 'POST', json: { mode: 'bulk', percent: Number(percent) } })
      toast.success(d.message); setReload((x) => x + 1)
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-5">
      <h1 className="page-title"><Tags size={22} />{t('prices')}</h1>
      <Tabs defaultValue="import">
        <TabsList>
          <TabsTrigger value="import" className="gap-1.5"><Upload size={14} />{t('importCsv')}</TabsTrigger>
          <TabsTrigger value="bulk" className="gap-1.5"><Percent size={14} />{t('bulkChange')}</TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5"><BarChart3 size={14} />{t('history')}</TabsTrigger>
        </TabsList>

        <TabsContent value="import" className="space-y-4 mt-4">
          <SectionCard title={t('importCsv')}>
            <p className="text-xs text-muted-foreground mb-3 leading-relaxed">{t('csvHint')}</p>
            <Textarea rows={6} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'sku,price\nP-1001,160000\nP-1002,105000'} dir="ltr" className="font-mono text-xs" />
            <div className="flex gap-2 mt-3">
              <Button variant="outline" onClick={doPreview} disabled={!csv.trim()}>{t('preview')}</Button>
              {preview && <Button onClick={doCommit} disabled={busy || preview.summary.valid === 0}>{t('commit')}</Button>}
            </div>
          </SectionCard>

          {preview && (
            <SectionCard title={`${t('preview')} — ${preview.summary.valid} ✓ / ${preview.summary.invalid} ✗ (${preview.detected.delimiter})`}>
              <div className="max-h-80 overflow-y-auto text-xs">
                <table className="w-full">
                  <thead><tr className="border-b text-muted-foreground"><th className="text-start p-1.5">#</th><th className="text-start p-1.5">SKU</th><th className="text-start p-1.5">{lang === 'fa' ? 'محصول' : 'Product'}</th><th className="text-start p-1.5">{t('oldPrice')}</th><th className="text-start p-1.5">{t('newPrice')}</th><th className="text-start p-1.5">{t('status')}</th></tr></thead>
                  <tbody>
                    {preview.rows.map((r) => (
                      <tr key={r.line} className={`border-b border-border/40 ${r.valid ? '' : 'bg-destructive/10'}`}>
                        <td className="p-1.5 tabular-nums text-muted-foreground">{r.line}</td>
                        <td className="p-1.5 font-mono" dir="ltr">{r.sku}</td>
                        <td className="p-1.5">{r.productName}</td>
                        <td className="p-1.5 tabular-nums text-muted-foreground">{r.oldPrice ? new Intl.NumberFormat('fa-IR').format(r.oldPrice) : '—'}</td>
                        <td className="p-1.5 tabular-nums font-bold">{new Intl.NumberFormat('fa-IR').format(r.newPrice)}</td>
                        <td className="p-1.5">{r.valid ? <CheckCircle2 size={14} className="text-status-success" /> : <span className="text-destructive flex items-center gap-1"><XCircle size={13} />{r.error}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          )}
        </TabsContent>

        <TabsContent value="bulk" className="mt-4">
          <SectionCard title={t('bulkChange')}>
            <div className="flex items-end gap-3 flex-wrap">
              <div className="space-y-1 w-32">
                <Label className="text-xs">±٪</Label>
                <Input type="number" value={percent} onChange={(e) => setPercent(e.target.value)} dir="ltr" />
              </div>
              <div className="flex gap-2">
                <Button onClick={doBulk} disabled={busy || !percent} className="btn-brand-hover gap-1">+٪ افزایش</Button>
                <Button onClick={() => doBulkWithSign(false)} variant="outline" className="gap-1">−٪ کاهش</Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-3 leading-relaxed">{lang === 'fa' ? 'هیچ قیمت قدیمی حذف نمی‌شود؛ همه تغییرات در تاریخچه قیمت ثبت می‌شوند.' : 'No old price is ever destroyed; every change is recorded in price history.'}</p>
          </SectionCard>
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          {historyError ? <ErrorState message={historyError} onRetry={() => setReload((x) => x + 1)} /> : history.length === 0 ? <EmptyState /> : (
            <div className="space-y-1.5 text-xs">
              {history.map((h) => (
                <div key={h.id} className="flex items-center gap-3 flex-wrap rounded-lg border p-2.5">
                  <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">{h.product.sku}</span>
                  <span className="font-medium">{h.product.nameFa}</span>
                  <span className="tabular-nums text-muted-foreground">{h.oldPrice ? `${new Intl.NumberFormat('fa-IR').format(h.oldPrice)} → ` : ''}<b>{new Intl.NumberFormat('fa-IR').format(h.newPrice)}</b></span>
                  <Badge variant="outline" className="text-[9px]">{h.reason}</Badge>
                  <span className="text-muted-foreground">{h.changedBy.firstName} {h.changedBy.lastName}</span>
                  <span className="ms-auto text-muted-foreground"><JalaliDate date={h.createdAt} /></span>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )

  async function doBulkWithSign(positive: boolean) {
    setBusy(true)
    try {
      const d = await api<{ message: string }>('/api/v1/admin/prices', { method: 'POST', json: { mode: 'bulk', percent: -Math.abs(Number(percent)) } })
      toast.success(d.message); setReload((x) => x + 1)
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
}

// ── Reports ─────────────────────────────────────────────────────────────
export function AdminReportsPage() {
  const { t, lang, api } = useApp()
  const [data, setData] = useState<{
    summary: { income: number; expenses: number; profit: number; paidCount: number; failedCount: number; refundTotal: number }
    byDay: { date: string; amount: number }[]
    topProducts: { name: string; count: number; revenue: number }[]
    statusCounts: Record<string, number>
    referralStats: { referrer: string; code: string; referredUser: string; orders: number; revenue: number; commission: number }[]
    provinceStats: Record<string, number>
    recentPayments: { code: string; amount: number; method: string; refNumber?: string; user: string; createdAt: string }[]
  } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => { api('/api/v1/admin/reports').then((d) => { setData(d as NonNullable<typeof data>); setLoadError(null) }).catch((e) => setLoadError((e as ApiError).supportRef)) }, [api])
  if (loadError) return <ErrorState message={loadError} onRetry={() => { setLoadError(null); window.location.reload() }} />
  if (!data) return <LoadingRows rows={6} />

  const chartData = data.byDay.map((d) => ({ date: d.date.slice(5), amount: d.amount / 1000000 }))

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="page-title"><BarChart3 size={22} />{t('reports')}</h1>
        <Button size="sm" variant="outline" className="ms-auto gap-1.5" onClick={() => exportCSV(data.recentPayments)}>
          <Download size={14} />CSV {t('exportData')}
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard title={t('revenue')} value={fmtMoney(data.summary.income, lang)} tone="bg-brand-light/15 text-brand-dark dark:text-brand-light" icon={<BarChart3 size={18} />} />
        <StatCard title={t('expenses')} value={fmtMoney(data.summary.expenses, lang)} tone="bg-destructive/10 text-destructive" icon={<BarChart3 size={18} />} />
        <StatCard title={t('profit')} value={fmtMoney(data.summary.profit, lang)} tone="bg-brand-dark/10 text-brand-dark dark:bg-brand-light/15 dark:text-brand-light" icon={<BarChart3 size={18} />} />
        <StatCard title={lang === 'fa' ? 'پرداخت موفق / ناموفق' : 'Paid / failed'} value={`${data.summary.paidCount} / ${data.summary.failedCount}`} icon={<BarChart3 size={18} />} />
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <SectionCard title={lang === 'fa' ? 'درآمد ۱۴ روز اخیر (میلیون تومان)' : 'Revenue last 14 days (M Toman)'}>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={chartData}>
              <defs><linearGradient id="rev" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.35} /><stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid strokeDasharray={chartTheme.grid.strokeDasharray} stroke={chartTheme.grid.stroke} vertical={chartTheme.grid.vertical} />
              <XAxis dataKey="date" {...chartTheme.axis} />
              <YAxis {...chartTheme.axis} />
              <Tooltip contentStyle={{ ...chartTheme.tooltip }} cursor={{ stroke: 'var(--chart-2)', strokeDasharray: '4 4' }} />
              <Area type="monotone" dataKey="amount" stroke="var(--chart-1)" fill="url(#rev)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard title={lang === 'fa' ? 'پرفروش‌ترین محصولات' : 'Top products'}>
          {data.topProducts.length === 0 ? <EmptyState /> : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.topProducts.slice(0, 6).map((p) => ({ name: p.name.slice(0, 14), revenue: p.revenue / 1000000 }))}>
                <CartesianGrid strokeDasharray={chartTheme.grid.strokeDasharray} stroke={chartTheme.grid.stroke} vertical={chartTheme.grid.vertical} />
                <XAxis dataKey="name" interval={0} angle={-20} textAnchor="end" height={50} {...chartTheme.axis} />
                <YAxis {...chartTheme.axis} />
                <Tooltip contentStyle={{ ...chartTheme.tooltip }} cursor={{ fill: 'var(--chart-1)', opacity: 0.06 }} />
                <Bar dataKey="revenue" fill="var(--chart-2)" radius={[4, 4, 0, 0]} name="M" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionCard>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <SectionCard title={lang === 'fa' ? 'بازاریاب‌ها (رفرال)' : 'Referrals'}>
          {data.referralStats.length === 0 ? <EmptyState /> : (
            <div className="space-y-2 text-sm">
              {data.referralStats.map((r, i) => (
                <div key={i} className="tile-row">
                  <span className="font-medium">{r.referrer}</span>
                  <code className="text-[10px] text-muted-foreground" dir="ltr">{r.code.slice(0, 14)}</code>
                  <span className="text-xs text-muted-foreground">→ {r.referredUser}</span>
                  <span className="ms-auto text-xs tabular-nums">{r.orders} {t('orders')}</span>
                  <span className="tabular-nums text-xs"><Money amount={r.revenue} /></span>
                  <Badge variant="secondary" className="text-[10px]">٪5: <Money amount={r.commission} /></Badge>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title={lang === 'fa' ? 'آخرین تراکنش‌ها' : 'Recent payments'}>
          {data.recentPayments.length === 0 ? <EmptyState /> : (
            <div className="max-h-72 overflow-y-auto space-y-1.5 text-xs">
              {data.recentPayments.map((p) => (
                <div key={p.code} className="tile-row">
                  <span className="font-mono" dir="ltr">{p.code}</span>
                  <Badge variant="outline" className="text-[9px]">{p.method}</Badge>
                  <span>{p.user}</span>
                  <span className="ms-auto tabular-nums"><Money amount={p.amount} /></span>
                  <span className="text-muted-foreground"><JalaliDate date={p.createdAt} /></span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <SectionCard title={lang === 'fa' ? 'پراکندگی جغرافیایی بیماران' : 'Patients by province'}>
        <div className="flex flex-wrap gap-2">
          {Object.entries(data.provinceStats).map(([prov, n]) => (
            <Badge key={prov} variant="outline" className="text-xs">{prov}: {new Intl.NumberFormat('fa-IR').format(n)}</Badge>
          ))}
        </div>
      </SectionCard>
    </div>
  )
}

function exportCSV(rows: Record<string, unknown>[]) {
  if (rows.length === 0) return
  const header = Object.keys(rows[0])
  const csv = [header.join(','), ...rows.map((r) => header.map((h) => String(r[h] ?? '')).join(','))].join('\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = 'payments.csv'; a.click()
  URL.revokeObjectURL(url)
}

// ── Audit logs ──────────────────────────────────────────────────────────
export function AdminAuditPage() {
  const { t, api } = useApp()
  const [logs, setLogs] = useState<{ id: string; action: string; entity: string; entityId?: string; ip?: string; device?: string; sensitive: boolean; createdAt: string; user?: { firstName: string; lastName: string; role: string; phone: string } | null; oldValues?: Record<string, unknown>; newValues?: Record<string, unknown> }[]>([])
  const [q, setQ] = useState('')
  const [reload, setReload] = useState(0)
  const [loading, setLoading] = useState(true) // PHASE 09 (F05): no flash-of-empty
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    queueMicrotask(() => setLoading(true)) // lint-safe: not a synchronous setState in effect body
    api<{ logs: typeof logs }>(`/api/v1/admin/audit-logs?q=${encodeURIComponent(q)}`).then((d) => { setLogs(d.logs); setLoadError(null) }).catch((e) => setLoadError((e as ApiError).supportRef)).finally(() => setLoading(false))
  }, [api, q, reload])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="page-title"><ShieldCheck size={22} />{t('auditLogs')}</h1>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search')} className="w-64 ms-auto" />
      </div>
      {loading ? <LoadingRows /> : loadError ? <ErrorState message={loadError} onRetry={() => setReload((x) => x + 1)} /> : logs.length === 0 ? <EmptyState /> : (
        <div className="space-y-1.5">
          {logs.map((l) => (
            <details key={l.id} className={`rounded-lg border p-3 text-xs ${l.sensitive ? 'border-status-warning/40' : ''}`}>
              <summary className="cursor-pointer flex items-center gap-2 flex-wrap">
                {l.sensitive && <Badge className="bg-status-warning text-status-warning-fg text-[9px]">حساس</Badge>}
                <Badge variant="outline" className="font-mono text-[10px]">{l.action}</Badge>
                <span className="text-muted-foreground">{l.entity}</span>
                {l.user && <span className="font-medium">{l.user.firstName} {l.user.lastName} <span className="text-muted-foreground">({l.user.role})</span></span>}
                <span className="text-muted-foreground" dir="ltr">{l.ip}</span>
                <span className="ms-auto text-muted-foreground"><JalaliDate date={l.createdAt} withTime /></span>
              </summary>
              <div className="mt-2 grid sm:grid-cols-2 gap-2 ps-3">
                {l.oldValues && <pre className="bg-muted/60 rounded p-2 overflow-x-auto text-[10px]" dir="ltr">{JSON.stringify(l.oldValues, null, 1)}</pre>}
                {l.newValues && <pre className="bg-muted/60 rounded p-2 overflow-x-auto text-[10px]" dir="ltr">{JSON.stringify(l.newValues, null, 1)}</pre>}
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Questionnaire editor (versioned) ────────────────────────────────────
// 2026-10: per-question required / weight / category + reorder; new questions
// start with the five default options (editable, never fixed in code).
// Saving always writes a NEW version — historical answers keep their snapshot.
type QOpt = { textFa: string; textEn: string; score: number; dimension: string }
type QDraft = { textFa: string; textEn: string; required: boolean; weight: number; category: string; options: QOpt[] }
const DEFAULT_OPTIONS: QOpt[] = [
  { textFa: 'خیلی کم', textEn: 'Very low', score: 0, dimension: 'HOT' },
  { textFa: 'کم', textEn: 'Low', score: 1, dimension: 'HOT' },
  { textFa: 'متوسط', textEn: 'Medium', score: 2, dimension: 'HOT' },
  { textFa: 'زیاد', textEn: 'High', score: 3, dimension: 'HOT' },
  { textFa: 'خیلی زیاد', textEn: 'Very high', score: 4, dimension: 'HOT' },
]
const newQuestion = (): QDraft => ({ textFa: '', textEn: '', required: false, weight: 1, category: '', options: DEFAULT_OPTIONS.map((o) => ({ ...o })) })

export function AdminQuestionnairePage() {
  const { t, lang, api } = useApp()
  const [questions, setQuestions] = useState<QDraft[]>([newQuestion()])
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    api<{ questionnaire: { questions: { textFa: string; textEn: string; required?: boolean; weight?: number; category?: string | null; options: QOpt[] }[] } | null }>('/api/v1/questionnaires/active').then((d) => {
      if (d.questionnaire && d.questionnaire.questions.length > 0) {
        setQuestions(d.questionnaire.questions.map((q) => ({
          textFa: q.textFa, textEn: q.textEn, required: !!q.required, weight: q.weight ?? 1, category: q.category || '',
          options: q.options.map((o) => ({ textFa: o.textFa, textEn: o.textEn, score: o.score, dimension: o.dimension })),
        })))
      }
    }).catch((e) => setLoadError((e as ApiError).supportRef))
  }, [api])

  const invalid = questions.length < 1 || questions.some((q) => !q.textFa.trim() || q.options.length < 2 || q.options.length > 10 || q.options.some((o) => !o.textFa.trim()))

  async function save() {
    setBusy(true)
    try {
      await api('/api/v1/admin/questionnaire', { method: 'PUT', json: { questions: questions.map((q) => ({ ...q, category: q.category || null })) } })
      toast.success('نسخه جدید ایجاد شد ✓')
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }

  const patchQ = (i: number, p: Partial<QDraft>) => setQuestions(questions.map((q, idx) => idx === i ? { ...q, ...p } : q))
  const setO = (i: number, j: number, k: keyof QOpt, v: string | number) =>
    setQuestions(questions.map((q, idx) => idx === i ? { ...q, options: q.options.map((o, oidx) => oidx === j ? { ...o, [k]: v } as QOpt : o) } : q))
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= questions.length) return
    const next = [...questions]; [next[i], next[j]] = [next[j], next[i]]; setQuestions(next)
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center gap-3">
        <h1 className="page-title"><FileText size={22} />{t('questionnaireEditor')}</h1>
        <Button className="ms-auto" disabled={busy || invalid} onClick={save}>{lang === 'fa' ? 'ایجاد نسخه جدید' : 'Create new version'}</Button>
      </div>
      {loadError && <ErrorState message={loadError} />}
      <p className="text-xs text-muted-foreground leading-relaxed">{lang === 'fa' ? 'ذخیره، نسخه جدیدی از پرسشنامه ایجاد می‌کند و نسخه قبلی غیرفعال می‌شود — نتایج قبلی بیماران با امتیاز زمان پاسخ‌گویی حفظ می‌شوند. حذف سؤال در نسخه جدید، حذف منطقی است.' : 'Saving creates a new version and deactivates the old one — past results keep the scores in force when answered. Removing a question only affects the new version.'}</p>
      {questions.map((q, i) => (
        <Card key={i}>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{i + 1}</Badge>
              <Input value={q.textFa} onChange={(e) => patchQ(i, { textFa: e.target.value })} placeholder="متن سؤال (فارسی)" className="flex-1" aria-label="متن سؤال" />
              <Button variant="ghost" size="sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label={lang === 'fa' ? 'بالا' : 'Up'}>↑</Button>
              <Button variant="ghost" size="sm" disabled={i === questions.length - 1} onClick={() => move(i, 1)} aria-label={lang === 'fa' ? 'پایین' : 'Down'}>↓</Button>
              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setQuestions(questions.filter((_, x) => x !== i))} aria-label={lang === 'fa' ? 'حذف سؤال' : 'Remove question'}>×</Button>
            </div>
            <Input value={q.textEn} onChange={(e) => patchQ(i, { textEn: e.target.value })} placeholder="Question text (English)" dir="ltr" className="text-xs" />
            <div className="flex gap-3 flex-wrap items-center text-xs">
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={q.required} onChange={(e) => patchQ(i, { required: e.target.checked })} className="size-4 accent-primary" />{lang === 'fa' ? 'اجباری' : 'Required'}</label>
              <label className="flex items-center gap-1.5">{lang === 'fa' ? 'وزن' : 'Weight'}
                <Input type="number" step="0.1" min={0} max={10} value={q.weight} onChange={(e) => patchQ(i, { weight: Math.max(0, Math.min(10, Number(e.target.value) || 0)) })} className="w-20 h-8 text-xs" dir="ltr" />
              </label>
              <label className="flex items-center gap-1.5">{lang === 'fa' ? 'دسته' : 'Category'}
                <Input value={q.category} onChange={(e) => patchQ(i, { category: e.target.value })} className="w-40 h-8 text-xs" />
              </label>
            </div>
            <div className="space-y-2 ps-4 border-s-2 border-border">
              {q.options.map((o, j) => (
                <div key={j} className="flex gap-2 items-center flex-wrap">
                  <Input value={o.textFa} onChange={(e) => setO(i, j, 'textFa', e.target.value)} placeholder="گزینه" className="flex-1 min-w-32 h-8 text-xs" aria-label="متن گزینه" />
                  <Input type="number" value={o.score} onChange={(e) => setO(i, j, 'score', Number(e.target.value))} className="w-16 h-8 text-xs" dir="ltr" aria-label={lang === 'fa' ? 'امتیاز' : 'Score'} />
                  <select value={o.dimension} onChange={(e) => setO(i, j, 'dimension', e.target.value)} className="h-8 text-xs rounded-md border bg-background px-2" aria-label={lang === 'fa' ? 'بُعد' : 'Dimension'}>
                    {['HOT', 'COLD', 'WET', 'DRY'].map((d) => <option key={d} value={d}>{({ HOT: 'گرما', COLD: 'برودت', WET: 'رطوبت', DRY: 'خشکی' } as Record<string, string>)[d]}</option>)}
                  </select>
                  <Button variant="ghost" size="sm" className="text-destructive h-7" disabled={q.options.length <= 2} onClick={() => patchQ(i, { options: q.options.filter((_, x) => x !== j) })}>×</Button>
                </div>
              ))}
              <Button variant="outline" size="sm" className="h-7 text-xs" disabled={q.options.length >= 10} onClick={() => patchQ(i, { options: [...q.options, { textFa: '', textEn: '', score: 2, dimension: 'HOT' }] })}>+ گزینه</Button>
            </div>
          </CardContent>
        </Card>
      ))}
      <Button variant="outline" onClick={() => setQuestions([...questions, newQuestion()])}>+ سؤال</Button>
    </div>
  )
}

// PHASE 09 (F04): lang2 removed — components use the reactive `lang` from useApp()

// ── AI/ML Ops dashboard (PHASE 11): registry · dataset · monitoring · prompts ──
type AiOverview = {
  models: { id: string; name: string; version: number; provider: string; isActive: boolean; approvalStatus: string; metrics?: Record<string, unknown> | null; trainingDataset?: string | null; trainingDatasetVersion?: string | null; preprocessingVersion?: string | null; promptKey?: string | null; promptVersion?: number | null; confidenceThreshold?: number | null; hasDriftBaseline?: boolean; trainingDate?: string | null }[]
  dataset: {
    datasets: { id: string; name: string; version: number; status: string; itemCount: number; frozenAt?: string | null }[]
    activeDraft: { id: string; name: string; version: number } | null
    items: { id: string; caseCode?: string | null; aiConfidence?: number | null; expert1Label?: string | null; expert2Label?: string | null; finalLabel?: string | null; disagreement: boolean; reviewStatus: string; createdAt: string }[]
    stats: { total: number; labeled: number; finalized: number; disagreement: number; excluded: number; withFinalLabel: number }
  }
  monitoring: { total: number; ok: number; failed: number; replayed: number; avgConfidence?: number | null; avgProcessingMs?: number | null; lowConfidenceRate?: number | null; failureRate: number; totalCostUnits: number; windowHours: number }
  bias: { total: number; maxClassRatio?: number | null; flagged: string[]; classes: { class: string; count: number; ratio: number }[] }
  cost: { month: string; total: number; cap: number; ratio: number; byModel: Record<string, number>; alert: boolean }
  reports: { id: string; summary?: string | null; createdAt: string; model?: { name: string; version: number } | null; dataset?: { name: string; version: number } | null }[]
}

export function AdminAIModelsPage() {
  const { t, lang, api } = useApp()
  const [data, setData] = useState<AiOverview | null>(null)
  const [prompts, setPrompts] = useState<{ prompts: { id: string; key: string; version: number; nameFa: string; nameEn: string; status: string; createdAt: string }[]; codeRegistryCount: number } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const fa = lang === 'fa'

  useEffect(() => {
    api<AiOverview>('/api/v1/admin/ai/overview').then((d) => { setData(d); setLoadError(null) }).catch((e) => setLoadError((e as ApiError).supportRef))
    api<typeof prompts>('/api/v1/admin/ai/prompts').then(setPrompts).catch(() => { /* prompts tab is optional */ })
  }, [api, reload])

  async function runEvaluation() {
    setBusy(true)
    try {
      await api('/api/v1/admin/ai/evaluate', { method: 'POST', json: { includeDraft: true } })
      toast.success(fa ? 'ارزیابی در صف اجرا قرار گرفت (غیرهمزمان)' : 'Evaluation queued (async)')
      setTimeout(() => setReload((x) => x + 1), 2500)
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }

  async function freezeDataset() {
    setBusy(true)
    try {
      await api('/api/v1/admin/ai/datasets', { method: 'POST', json: { action: 'freeze' } })
      toast.success(fa ? 'دیتاست فریز شد و پیش‌نویس جدید باز شد' : 'Dataset frozen; new draft opened')
      setReload((x) => x + 1)
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }

  if (loadError) return <ErrorState message={loadError} onRetry={() => { setLoadError(null); setReload((x) => x + 1) }} />
  if (!data) return <LoadingRows rows={4} />

  const m = data.monitoring
  const ds = data.dataset.stats
  const pct = (v?: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`)

  return (
    <div className="space-y-5">
      <h1 className="page-title"><Bot size={22} />{t('aiModels')}</h1>

      <Tabs defaultValue="registry">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="registry" className="gap-1.5"><Bot size={14} />{fa ? 'رجیستری مدل' : 'Model registry'}</TabsTrigger>
          <TabsTrigger value="dataset" className="gap-1.5"><BarChart3 size={14} />{fa ? 'دیتاست' : 'Dataset'}</TabsTrigger>
          <TabsTrigger value="monitor" className="gap-1.5"><ShieldCheck size={14} />{fa ? 'پایش و Drift' : 'Monitoring & drift'}</TabsTrigger>
          <TabsTrigger value="prompts" className="gap-1.5"><FileText size={14} />{fa ? 'پرامپت‌ها' : 'Prompts'}</TabsTrigger>
        </TabsList>

        {/* ── Tab: model registry + evaluation reports ── */}
        <TabsContent value="registry" className="space-y-4 pt-4">
          <div className="flex items-center gap-3 flex-wrap">
            <p className="text-xs text-muted-foreground flex-1 min-w-60">
              {fa ? 'انتخاب مدل فعال از رجیستری دیتابیس انجام می‌شود (ED-121) — تعویض مدل بدون تغییر کد.' : 'The active model resolves from the DB registry (ED-121) — swapping models needs no code change.'}
            </p>
            <Button size="sm" variant="outline" onClick={runEvaluation} disabled={busy} className="gap-1.5">
              <Tags size={14} />{fa ? 'اجرای ارزیابی' : 'Run evaluation'}
            </Button>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            {data.models.map((mo) => (
              <Card key={mo.id} className={mo.isActive ? 'border-primary/40' : 'opacity-70'}>
                <CardContent className="p-4 space-y-2.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Bot size={18} className={mo.isActive ? 'text-primary' : 'text-muted-foreground'} />
                    <span className="font-bold">{mo.name} <span className="text-muted-foreground font-normal">v{mo.version}</span></span>
                    {mo.isActive && <Badge className="bg-status-success text-status-success-fg text-[10px]">{fa ? 'فعال' : 'Active'}</Badge>}
                    <Badge variant="outline" className="text-[10px] ms-auto">{mo.approvalStatus}</Badge>
                  </div>
                  {mo.metrics && (
                    <div className="flex flex-wrap gap-2 text-xs">
                      {/* numeric scalar metrics only — nested suites live in the evaluation report */}
                      {Object.entries(mo.metrics).filter(([, v]) => typeof v === 'number').slice(0, 8).map(([k, v]) => (
                        <Badge key={k} variant="secondary" className="text-[10px] tabular-nums">{k}: {new Intl.NumberFormat('fa-IR').format(v as number)}</Badge>
                      ))}
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground space-y-0.5" dir="ltr">
                    {mo.trainingDataset && <div>dataset: <code>{mo.trainingDataset}</code>{mo.trainingDatasetVersion ? <code className="ms-1">{mo.trainingDatasetVersion}</code> : null}</div>}
                    <div className="flex gap-3 flex-wrap">
                      {mo.promptKey && <span>prompt: <code>{mo.promptKey}@v{mo.promptVersion ?? '?'}</code></span>}
                      {mo.preprocessingVersion && <span>preproc: <code>v{mo.preprocessingVersion}</code></span>}
                      <span>baseline: {mo.hasDriftBaseline ? '✓' : '—'}</span>
                    </div>
                  </div>
                  {mo.trainingDate && <div className="text-xs text-muted-foreground">{fa ? 'آموزش:' : 'Trained:'} <JalaliDate date={mo.trainingDate} /></div>}
                </CardContent>
              </Card>
            ))}
          </div>

          <SectionCard title={fa ? 'گزارش‌های ارزیابی (متریک کامل — نه فقط Accuracy)' : 'Evaluation reports (full metric suite — never accuracy-only)'}>
            {data.reports.length === 0 ? <EmptyState /> : (
              <div className="max-h-72 overflow-y-auto space-y-1.5 text-xs">
                {data.reports.map((r) => (
                  <div key={r.id} className="tile-row">
                    <span className="font-medium">{r.model ? `${r.model.name}@v${r.model.version}` : '—'}</span>
                    <span className="text-muted-foreground" dir="ltr">{r.summary}</span>
                    <span className="ms-auto text-muted-foreground"><JalaliDate date={r.createdAt} /></span>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </TabsContent>

        {/* ── Tab: dataset (feedback loop) ── */}
        <TabsContent value="dataset" className="space-y-4 pt-4">
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            <StatCard title={fa ? 'کل آیتم‌ها' : 'Items'} value={ds.total} />
            <StatCard title={fa ? 'برچسب‌خورده' : 'Labeled'} value={ds.labeled} />
            <StatCard title={fa ? 'نهایی‌شده' : 'Finalized'} value={ds.finalized} tone="bg-status-success/15 text-status-success" />
            <StatCard title={fa ? 'اختلاف خبره‌ها' : 'Disagreement'} value={ds.disagreement} tone="bg-status-warning/15 text-status-warning" />
            <StatCard title={fa ? 'حذف‌شده' : 'Excluded'} value={ds.excluded} />
            <StatCard title={fa ? 'نسخه جاری' : 'Draft'} value={data.dataset.activeDraft ? `v${data.dataset.activeDraft.version}` : '—'} />
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <p className="text-xs text-muted-foreground flex-1 min-w-60">
              {fa ? 'چرخه بازخورد: هر بازبینی انسانی → برچسب دیتاست (تفکیک بیمار-محور — §63).' : 'Feedback loop: every human review becomes a dataset label (patient-level splits — §63).'}
            </p>
            <Button size="sm" variant="outline" onClick={freezeDataset} disabled={busy || !data.dataset.activeDraft} className="gap-1.5">
              <CheckCircle2 size={14} />{fa ? 'فریز نسخه جاری' : 'Freeze draft'}
            </Button>
          </div>
          <SectionCard title={fa ? 'نسخه‌های دیتاست' : 'Dataset versions'}>
            <div className="space-y-1.5 text-xs">
              {data.dataset.datasets.map((d) => (
                <div key={d.id} className="tile-row">
                  <span className="font-medium" dir="ltr">{d.name}@v{d.version}</span>
                  <Badge variant={d.status === 'FROZEN' ? 'secondary' : 'outline'} className="text-[10px]">{d.status}</Badge>
                  <span className="tabular-nums text-muted-foreground">{fa ? `${d.itemCount} آیتم` : `${d.itemCount} items`}</span>
                  {d.frozenAt && <span className="ms-auto text-muted-foreground"><JalaliDate date={d.frozenAt} /></span>}
                </div>
              ))}
            </div>
          </SectionCard>
          <SectionCard title={fa ? 'آیتم‌های یادگیری (پیش‌بینی AI ↔ برچسب انسان)' : 'Learning items (AI prediction ↔ human label)'}>
            {data.dataset.items.length === 0 ? <EmptyState /> : (
              <div className="max-h-96 overflow-y-auto space-y-1.5 text-xs">
                {data.dataset.items.map((it) => (
                  <div key={it.id} className="tile-row">
                    <span className="tabular-nums text-muted-foreground">{it.caseCode || '—'}</span>
                    <Badge variant="outline" className="text-[10px]">{it.reviewStatus}</Badge>
                    {it.expert1Label && <span className="max-w-40 truncate" dir="ltr" title={it.expert1Label}>E1: {labelShort(it.expert1Label)}</span>}
                    {it.expert2Label && <span className="max-w-40 truncate" dir="ltr" title={it.expert2Label}>E2: {labelShort(it.expert2Label)}</span>}
                    {it.finalLabel && <span className="max-w-32 truncate" dir="ltr">F: {labelShort(it.finalLabel)}</span>}
                    {it.disagreement && <Badge className="bg-status-warning text-status-warning-fg text-[9px]">{fa ? 'اختلاف' : 'disagree'}</Badge>}
                    <span className="ms-auto text-muted-foreground tabular-nums">{it.aiConfidence != null ? `${Math.round(it.aiConfidence * 100)}%` : '—'}</span>
                    <span className="text-muted-foreground"><JalaliDate date={it.createdAt} /></span>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </TabsContent>

        {/* ── Tab: monitoring / drift / bias / cost ── */}
        <TabsContent value="monitor" className="space-y-4 pt-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard title={fa ? 'استنتاج‌ها (۷ روز)' : `Inferences (${m.windowHours}h)`} value={m.total} />
            <StatCard title={fa ? 'میانگین اطمینان' : 'Avg confidence'} value={pct(m.avgConfidence)} />
            <StatCard title={fa ? 'میانگین زمان' : 'Avg latency'} value={m.avgProcessingMs != null ? `${m.avgProcessingMs}ms` : '—'} />
            <StatCard title={fa ? 'نرخ خطا' : 'Failure rate'} value={pct(m.failureRate)} tone={m.failureRate > 0.1 ? 'bg-status-danger/15 text-status-danger' : undefined} />
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <SectionCard title={fa ? 'سوگیری کلاس پیش‌بینی (Bias)' : 'Prediction class bias'}>
              {data.bias.total === 0 ? <EmptyState /> : (
                <div className="space-y-1.5 text-xs">
                  {data.bias.classes.slice(0, 8).map((c) => (
                    <div key={c.class} className="tile-row" dir="ltr">
                      <span className="font-medium truncate">{c.class}</span>
                      <span className="ms-auto tabular-nums text-muted-foreground">{c.count} · {Math.round(c.ratio * 100)}%</span>
                    </div>
                  ))}
                  {data.bias.flagged.length > 0 && (
                    <p className="text-status-warning text-xs pt-1">{fa ? 'هشدار: کلاس غالب >۸۰٪' : 'Warning: dominant class >80%'} — {data.bias.flagged.join('، ')}</p>
                  )}
                </div>
              )}
            </SectionCard>
            <SectionCard title={fa ? 'هزینه AI (واحد هزینه)' : 'AI cost (cost units)'}>
              <div className="space-y-2 text-xs">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 bg-muted rounded overflow-hidden">
                    <div className={data.cost.alert ? 'h-full bg-status-danger' : 'h-full bg-primary'} style={{ width: `${Math.min(100, Math.round(data.cost.ratio * 100))}%` }} />
                  </div>
                  <span className="tabular-nums" dir="ltr">{data.cost.total} / {data.cost.cap}</span>
                </div>
                {Object.entries(data.cost.byModel).map(([name, units]) => (
                  <div key={name} className="tile-row" dir="ltr">
                    <span className="font-medium">{name}</span>
                    <span className="ms-auto tabular-nums text-muted-foreground">{units}</span>
                  </div>
                ))}
                <p className="text-muted-foreground">{fa ? 'بودجه ماهانه: در ۸۰٪ هشدار صادر می‌شود (ED-128).' : 'Monthly budget: alert fires at 80% (ED-128).'}</p>
              </div>
            </SectionCard>
          </div>
          <SectionCard title={fa ? 'Drift (شاخص PSI — پایداری توزیع)' : 'Drift (PSI — population stability)'}>
            <p className="text-xs text-muted-foreground mb-2">
              {fa ? 'آستانه‌ها: Ψ < 0.1 پایدار · 0.1-0.25 هشدار · > 0.25 هشدار شدید + اعلان ادمین. خط پایه پس از ۱۰ تحلیل ثبت می‌شود.' : 'Thresholds: Ψ < 0.1 stable · 0.1-0.25 warn · > 0.25 alarm + admin notification. Baseline captured after 10 analyses.'}
            </p>
            <p className="text-xs">{fa ? 'پایش خودکار هر ۵ دقیقه در JobQueue اجرا می‌شود؛ جزئیات در لاگ ساختاریافته.' : 'Automatic check runs every 5 minutes in the JobQueue; details live in structured logs.'}</p>
          </SectionCard>
        </TabsContent>

        {/* ── Tab: prompt registry ── */}
        <TabsContent value="prompts" className="space-y-4 pt-4">
          <p className="text-xs text-muted-foreground">
            {fa ? 'نسخه‌های پرامپت تغییرناپذیرند (ED-122) — تغییر متن یعنی نسخه جدید؛ نسخه‌های قدیمی Deprecated می‌شوند.' : 'Prompt versions are immutable (ED-122) — a text change is a NEW version; old versions become Deprecated.'}
          </p>
          <SectionCard title={fa ? 'رجیستری پرامپت' : 'Prompt registry'}>
            {!prompts || prompts.prompts.length === 0 ? <EmptyState /> : (
              <div className="space-y-1.5 text-xs">
                {prompts.prompts.map((p) => (
                  <div key={p.id} className="tile-row">
                    <span className="font-medium" dir="ltr">{p.key}@v{p.version}</span>
                    <span>{fa ? p.nameFa : p.nameEn}</span>
                    <Badge variant={p.status === 'ACTIVE' ? 'secondary' : 'outline'} className="text-[10px]">{p.status}</Badge>
                    <span className="ms-auto text-muted-foreground"><JalaliDate date={p.createdAt} /></span>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function labelShort(label: string): string {
  try {
    const v = JSON.parse(label)
    if (Array.isArray(v)) return v.map((x) => `${x.indicator}:${x.value}`).join(' ')
  } catch { /* plain code label */ }
  return label.length > 28 ? label.slice(0, 28) + '…' : label
}

// ── SMS log ─────────────────────────────────────────────────────────────
export function AdminSMSPage() {
  const { t, api } = useApp()
  const [logs, setLogs] = useState<{ id: string; recipient: string; template: string; content: string; provider: string; status: string; deliveryStatus?: string; sentAt: string }[]>([])
  const [loading, setLoading] = useState(true) // PHASE 09 (F05): no flash-of-empty
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    api<{ logs: typeof logs }>('/api/v1/admin/sms-log').then((d) => { setLogs(d.logs); setLoadError(null) }).catch((e) => setLoadError((e as ApiError).supportRef)).finally(() => setLoading(false))
  }, [api, reload])

  return (
    <div className="space-y-4">
      <h1 className="page-title"><MessageSquareText size={22} />{t('smsLog')}</h1>
      {loading ? <LoadingRows /> : loadError ? <ErrorState message={loadError} onRetry={() => setReload((x) => x + 1)} /> : logs.length === 0 ? <EmptyState /> : (
        <div className="space-y-1.5 text-xs">
          {logs.map((l) => (
            <div key={l.id} className="tile-row">
              <span dir="ltr" className="tabular-nums text-muted-foreground">{l.recipient}</span>
              <Badge variant="outline" className="text-[9px]">{l.template}</Badge>
              <span className="flex-1 min-w-40">{l.content}</span>
              <Badge variant={l.status === 'DELIVERED' || l.status === 'SENT' ? 'secondary' : 'destructive'} className="text-[9px]">{l.status}</Badge>
              <span className="text-muted-foreground"><JalaliDate date={l.sentAt} withTime /></span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
