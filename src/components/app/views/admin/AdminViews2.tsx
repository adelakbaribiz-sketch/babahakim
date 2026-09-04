'use client'
// Admin: Prices (Excel/CSV import + bulk %) · Reports (charts) · Audit logs · Questionnaire editor · AI models · SMS log
import React, { useEffect, useState } from 'react'
import { useApp } from '@/contexts/app'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'
import { SectionCard, StatCard, JalaliDate, LoadingRows, EmptyState, Money, StatusBadge } from '../../shared/atoms'
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

  const loadHistory = () => { api<{ history: typeof history }>('/api/v1/admin/prices').then((d) => setHistory(d.history)).catch(() => {}) }
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
          {history.length === 0 ? <EmptyState /> : (
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

  useEffect(() => { api('/api/v1/admin/reports').then(setData).catch(() => {}) }, [api])
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

  useEffect(() => {
    api<{ logs: typeof logs }>(`/api/v1/admin/audit-logs?q=${encodeURIComponent(q)}`).then((d) => setLogs(d.logs)).catch(() => {})
  }, [api, q, reload])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="page-title"><ShieldCheck size={22} />{t('auditLogs')}</h1>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search')} className="w-64 ms-auto" />
      </div>
      {logs.length === 0 ? <EmptyState /> : (
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
export function AdminQuestionnairePage() {
  const { t, api } = useApp()
  const [questions, setQuestions] = useState<{ textFa: string; textEn: string; options: { textFa: string; textEn: string; score: number; dimension: string }[] }[]>([{ textFa: '', textEn: '', options: [{ textFa: '', textEn: '', score: 2, dimension: 'HOT' }] }])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<{ questionnaire: { questions: { textFa: string; textEn: string; options: { textFa: string; textEn: string; score: number; dimension: string }[] }[] } | null }>('/api/v1/questionnaires/active').then((d) => {
      if (d.questionnaire && d.questionnaire.questions.length > 0) {
        setQuestions(d.questionnaire.questions.map((q) => ({ textFa: q.textFa, textEn: q.textEn, options: q.options.map((o) => ({ textFa: o.textFa, textEn: o.textEn, score: o.score, dimension: o.dimension })) })))
      }
    }).catch(() => {})
  }, [api])

  async function save() {
    setBusy(true)
    try {
      await api('/api/v1/admin/questionnaire', { method: 'PUT', json: { questions } })
      toast.success('نسخه جدید ایجاد شد ✓')
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }

  const setQ = (i: number, k: 'textFa' | 'textEn', v: string) => setQuestions(questions.map((q, idx) => idx === i ? { ...q, [k]: v } : q))
  const setO = (i: number, j: number, k: 'textFa' | 'textEn' | 'score' | 'dimension', v: string | number) =>
    setQuestions(questions.map((q, idx) => idx === i ? { ...q, options: q.options.map((o, oidx) => oidx === j ? { ...o, [k]: v } as typeof o : o) } : q))

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center gap-3">
        <h1 className="page-title"><FileText size={22} />{t('questionnaireEditor')}</h1>
        <Button className="ms-auto" disabled={busy || questions.length < 3} onClick={save}>{lang2('ایجاد نسخه جدید', 'Create new version')}</Button>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{lang2('ذخیره، نسخه جدیدی از پرسشنامه ایجاد می‌کند و نسخه قبلی غیرفعال می‌شود — تاریخچه نتایج کاربران همیشه حفظ می‌شود.', 'Saving creates a new questionnaire version and deactivates the old one — user result history is always preserved.')}</p>
      {questions.map((q, i) => (
        <Card key={i}>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{i + 1}</Badge>
              <Input value={q.textFa} onChange={(e) => setQ(i, 'textFa', e.target.value)} placeholder="متن سؤال (فارسی)" className="flex-1" />
              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setQuestions(questions.filter((_, x) => x !== i))}>×</Button>
            </div>
            <Input value={q.textEn} onChange={(e) => setQ(i, 'textEn', e.target.value)} placeholder="Question text (English)" dir="ltr" className="text-xs" />
            <div className="space-y-2 ps-4 border-s-2 border-border">
              {q.options.map((o, j) => (
                <div key={j} className="flex gap-2 items-center flex-wrap">
                  <Input value={o.textFa} onChange={(e) => setO(i, j, 'textFa', e.target.value)} placeholder="گزینه" className="flex-1 min-w-32 h-8 text-xs" />
                  <Input type="number" value={o.score} onChange={(e) => setO(i, j, 'score', Number(e.target.value))} className="w-16 h-8 text-xs" dir="ltr" />
                  <select value={o.dimension} onChange={(e) => setO(i, j, 'dimension', e.target.value)} className="h-8 text-xs rounded-md border bg-background px-2">
                    {['HOT', 'COLD', 'WET', 'DRY'].map((d) => <option key={d} value={d}>{({ HOT: 'گرما', COLD: 'برودت', WET: 'رطوبت', DRY: 'خشکی' } as Record<string, string>)[d]}</option>)}
                  </select>
                  <Button variant="ghost" size="sm" className="text-destructive h-7" onClick={() => setQuestions(questions.map((qq, idx) => idx === i ? { ...qq, options: qq.options.filter((_, x) => x !== j) } : qq))}>×</Button>
                </div>
              ))}
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setQuestions(questions.map((qq, idx) => idx === i ? { ...qq, options: [...qq.options, { textFa: '', textEn: '', score: 2, dimension: 'HOT' }] } : qq))}>+ گزینه</Button>
            </div>
          </CardContent>
        </Card>
      ))}
      <Button variant="outline" onClick={() => setQuestions([...questions, { textFa: '', textEn: '', options: [{ textFa: '', textEn: '', score: 2, dimension: 'HOT' }] }])}>+ سؤال</Button>
    </div>
  )
}

const lang2 = (fa: string, en: string) => (typeof window !== 'undefined' && document.documentElement.lang === 'en' ? en : fa)

// ── AI models & dataset ─────────────────────────────────────────────────
export function AdminAIModelsPage() {
  const { t, api } = useApp()
  const [data, setData] = useState<{
    models: { id: string; name: string; version: number; provider: string; isActive: boolean; approvalStatus: string; metrics?: Record<string, number> | null; trainingDate?: string; trainingDataset?: string }[]
    dataset: { id: string; caseCode: string; modelName: string; confidence: number; topPrediction: string; humanReviewed: boolean; createdAt: string }[]
    datasetStats: { total: number; reviewed: number; avgConfidence: number }
  } | null>(null)

  useEffect(() => { api('/api/v1/admin/ai-models').then(setData).catch(() => {}) }, [api])
  if (!data) return <LoadingRows rows={4} />

  return (
    <div className="space-y-5">
      <h1 className="page-title"><Bot size={22} />{t('aiModels')}</h1>

      <div className="grid md:grid-cols-2 gap-4">
        {data.models.map((m) => (
          <Card key={m.id} className={m.isActive ? 'border-primary/40' : 'opacity-70'}>
            <CardContent className="p-4 space-y-2.5">
              <div className="flex items-center gap-2 flex-wrap">
                <Bot size={18} className={m.isActive ? 'text-primary' : 'text-muted-foreground'} />
                <span className="font-bold">{m.name} <span className="text-muted-foreground font-normal">v{m.version}</span></span>
                {m.isActive && <Badge className="bg-status-success text-status-success-fg text-[10px]">فعال</Badge>}
                <Badge variant="outline" className="text-[10px] ms-auto">{m.approvalStatus}</Badge>
              </div>
              {m.metrics && (
                <div className="flex flex-wrap gap-2 text-xs">
                  {Object.entries(m.metrics).slice(0, 5).map(([k, v]) => (
                    <Badge key={k} variant="secondary" className="text-[10px] tabular-nums">{k}: {typeof v === 'number' ? new Intl.NumberFormat('fa-IR').format(v) : v}</Badge>
                  ))}
                </div>
              )}
              <div className="text-xs text-muted-foreground">
                {m.trainingDataset && <div>Dataset: <code dir="ltr">{m.trainingDataset}</code></div>}
                {m.trainingDate && <div>آموزش: <JalaliDate date={m.trainingDate} /></div>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <SectionCard title={lang2('دیتاست یادگیری (AI vs انسان)', 'Learning dataset (AI vs human)')}>
        <div className="grid grid-cols-3 gap-3 mb-4">
          <StatCard title={lang2('کل تحلیل‌ها', 'Total analyses')} value={data.datasetStats.total} />
          <StatCard title={lang2('بازبینی‌شده', 'Human reviewed')} value={data.datasetStats.reviewed} tone="bg-brand-light/15 text-brand-dark dark:text-brand-light" />
          <StatCard title={lang2('میانگین اطمینان', 'Avg confidence')} value={`${Math.round(data.datasetStats.avgConfidence * 100)}%`} />
        </div>
        {data.dataset.length === 0 ? <EmptyState /> : (
          <div className="max-h-96 overflow-y-auto space-y-1.5 text-xs">
            {data.dataset.map((d) => (
              <div key={d.id} className="tile-row">
                <span className="tabular-nums text-muted-foreground">{d.caseCode}</span>
                <span className="font-medium">{d.topPrediction}</span>
                <Badge variant={d.humanReviewed ? 'secondary' : 'outline'} className="text-[9px]">{d.humanReviewed ? 'بازبینی ✓' : 'در انتظار'}</Badge>
                <span className="ms-auto text-muted-foreground tabular-nums">{Math.round(d.confidence * 100)}%</span>
                <span className="text-muted-foreground"><JalaliDate date={d.createdAt} /></span>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  )
}

// ── SMS log ─────────────────────────────────────────────────────────────
export function AdminSMSPage() {
  const { t, api } = useApp()
  const [logs, setLogs] = useState<{ id: string; recipient: string; template: string; content: string; provider: string; status: string; deliveryStatus?: string; sentAt: string }[]>([])
  useEffect(() => { api<{ logs: typeof logs }>('/api/v1/admin/sms-log').then((d) => setLogs(d.logs)).catch(() => {}) }, [api])

  return (
    <div className="space-y-4">
      <h1 className="page-title"><MessageSquareText size={22} />{t('smsLog')}</h1>
      {logs.length === 0 ? <EmptyState /> : (
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
