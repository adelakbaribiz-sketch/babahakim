'use client'
// ── PHASE 14: Reports Center — permission-aware reporting UI (ED-154) ──────
// Catalog-driven: the server decides which reports exist for the caller's
// role; this view renders whatever it gets. 6 category tabs, bounded window
// presets + custom range, SQL-side execution, chart + table + totals,
// CSV/Excel/PDF sync exports and async exports with artifact list.
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '@/contexts/app'
import { apiDownload } from '@/lib/api-client'
import { ApiError } from '@/lib/api-error'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { SectionCard, StatCard, LoadingRows, EmptyState, ErrorState, Money } from '../../shared/atoms'
import { fmtMoney } from '@/lib/i18n'
import { BarChart3, Play, Download, FileSpreadsheet, FileText, FileType, Clock3, Layers, Search as SearchIcon } from 'lucide-react'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { chartTheme } from '@/design-system/tokens'

type Category = 'OPERATIONAL' | 'FINANCIAL' | 'BUSINESS' | 'USER' | 'PERFORMANCE' | 'CUSTOM'
const CATEGORIES: Category[] = ['OPERATIONAL', 'FINANCIAL', 'BUSINESS', 'USER', 'PERFORMANCE', 'CUSTOM']

interface CatalogEntry {
  id: string; category: Category; fa: string; en: string; descFa: string; descEn: string
  permission: string; timeScoped: boolean; hasChart: boolean; defaultGroupBy?: string
}

interface ReportResult {
  columns: { key: string; fa: string; en: string; type?: string }[]
  rows: Record<string, unknown>[]
  totals?: Record<string, number>
  summary?: { key: string; fa: string; en: string; value: number; type?: string }[]
  chart?: { bucketKey: string; series: { key: string; fa: string; en: string; type?: string }[]; rows: Record<string, unknown>[] }
  meta: { reportId: string; from: string; to: string; groupBy?: string; generatedAt: string; truncated: boolean; totalRows: number; windowDefaulted?: boolean; ms: number; cached?: boolean; noteFa?: string; noteEn?: string }
}

interface ExportArtifact { id: string; fileName: string; mime: string; sizeBytes: number; createdAt: string; expiresAt: string }

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
}
function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

export function ReportsCenter() {
  const { t, lang, api, can } = useApp()
  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [category, setCategory] = useState<Category>('FINANCIAL')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [windowDays, setWindowDays] = useState<string>('30')
  const [from, setFrom] = useState(isoDaysAgo(30))
  const [to, setTo] = useState(todayISO())
  const [groupBy, setGroupBy] = useState<string>('default')
  const [dataset, setDataset] = useState<string>('payments')
  const [result, setResult] = useState<ReportResult | null>(null)
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [exporting, setExporting] = useState<string | null>(null)
  const [artifacts, setArtifacts] = useState<ExportArtifact[] | null>(null)

  useEffect(() => {
    api('/api/v1/reports').then((d) => { setCatalog((d as { reports: CatalogEntry[] }).reports); setCatalogError(null) }).catch((e) => setCatalogError((e as ApiError).supportRef))
  }, [api])

  const loadArtifacts = useCallback(() => {
    api('/api/v1/reports/exports').then((d) => setArtifacts((d as { exports: ExportArtifact[] }).exports)).catch(() => setArtifacts([]))
  }, [api])
  useEffect(() => { loadArtifacts() }, [loadArtifacts])

  const reportsInCategory = useMemo(
    () => (catalog || []).filter((r) => r.category === category),
    [catalog, category],
  )
  const selected = useMemo(() => catalog?.find((r) => r.id === selectedId) ?? null, [catalog, selectedId])

  useEffect(() => { setResult(null); setRunError(null) }, [selectedId])

  const paramsFor = useCallback((report: CatalogEntry | null): string => {
    if (!report) return ''
    const sp = new URLSearchParams()
    if (windowDays === 'custom') {
      if (from) sp.set('from', from)
      if (to) sp.set('to', to)
    } else {
      sp.set('from', isoDaysAgo(Number(windowDays) || 30))
    }
    if (report.id === 'custom.dataset') sp.set('dataset', dataset)
    const gb = groupBy === 'default' ? (report.defaultGroupBy || 'day') : groupBy
    if (gb) sp.set('groupBy', gb)
    return sp.toString()
  }, [windowDays, from, to, groupBy, dataset])

  const run = useCallback(async () => {
    if (!selected) return
    setRunning(true); setRunError(null)
    try {
      const d = (await api(`/api/v1/reports/${selected.id}?${paramsFor(selected)}`)) as { report: ReportResult }
      setResult(d.report)
    } catch (e) {
      setRunError((e as ApiError).supportRef || (e as ApiError).message)
      setResult(null)
    } finally { setRunning(false) }
  }, [api, selected, paramsFor])

  const saveBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 4_000)
  }

  const exportSync = async (format: 'csv' | 'xlsx' | 'pdf') => {
    if (!selected) return
    setExporting(format)
    try {
      const sp = new URLSearchParams(paramsFor(selected))
      sp.set('format', format)
      sp.set('lang', lang)
      const { blob, filename } = await apiDownload(`/api/v1/reports/${selected.id}/export?${sp.toString()}`)
      saveBlob(blob, filename)
      toast.success(lang === 'fa' ? 'خروجی دانلود شد' : 'Export downloaded', { description: filename })
    } catch (e) {
      const err = e as ApiError
      // 413 → the artifact is bigger than the sync cap: fall back to async
      if (err.status === 413) {
        toast.info(lang === 'fa' ? 'حجم زیاد — خروجی ناهمزمان تولید می‌شود' : 'Large result — switching to async export')
        return exportAsync(format)
      }
      toast.error(err.message)
    } finally { setExporting(null) }
  }

  const exportAsync = async (format: 'csv' | 'xlsx' | 'pdf') => {
    if (!selected) return
    setExporting('async-' + format)
    try {
      const sp = new URLSearchParams(paramsFor(selected))
      const filtersJson: Record<string, unknown> = {}
      sp.forEach((v, k) => { if (k !== 'format') filtersJson[k] = v })
      await api(`/api/v1/reports/${selected.id}/export`, {
        method: 'POST',
        json: { format, lang, params: { ...filtersJson } },
      })
      toast.success(t('reportExportAsyncQueued'))
      setTimeout(loadArtifacts, 1_500)
    } catch (e) {
      toast.error((e as ApiError).message)
    } finally { setExporting(null) }
  }

  if (catalogError) return <ErrorState message={catalogError} onRetry={() => window.location.reload()} />
  if (!catalog) return <LoadingRows rows={8} />

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="page-title"><BarChart3 size={22} />{t('reportCenter')}</h1>
        <Badge variant="secondary" className="ms-auto text-[10px]">{catalog.length} {t('reportRows')}</Badge>
      </div>

      {/* category tabs */}
      <div className="flex flex-wrap gap-1.5">
        {CATEGORIES.map((c) => {
          const n = catalog.filter((r) => r.category === c).length
          const key = 'reportCategory' + c[0] + c.slice(1).toLowerCase()
          return (
            <button
              key={c}
              onClick={() => { setCategory(c); setSelectedId(null) }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${category === c ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-muted'}`}
            >
              {t(key)} <span className="opacity-60 tabular-nums">({n})</span>
            </button>
          )
        })}
      </div>

      <div className="grid lg:grid-cols-[280px,1fr] gap-5 items-start">
        {/* report list */}
        <div className="space-y-1.5">
          {reportsInCategory.length === 0 && <EmptyState text={t('reportEmpty')} />}
          {reportsInCategory.map((r) => (
            <button
              key={r.id}
              onClick={() => { setSelectedId(r.id); setGroupBy('default') }}
              className={`w-full text-start rounded-xl border p-3 transition-colors ${selectedId === r.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/60'}`}
            >
              <div className="flex items-center gap-2">
                <Layers size={14} className="text-primary shrink-0" />
                <span className="text-sm font-semibold">{lang === 'fa' ? r.fa : r.en}</span>
                {r.hasChart && <Badge variant="outline" className="text-[8px] ms-auto shrink-0">chart</Badge>}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{lang === 'fa' ? r.descFa : r.descEn}</p>
              <code className="text-[9px] text-muted-foreground/70" dir="ltr">{r.id}</code>
            </button>
          ))}
        </div>

        {/* params + result */}
        <div className="space-y-4 min-w-0">
          {!selected && <SectionCard title={t('reportSelectOne')}><EmptyState icon={<SearchIcon size={20} />} /></SectionCard>}
          {selected && (
            <SectionCard
              title={lang === 'fa' ? selected.fa : selected.en}
              action={
                <div className="flex gap-1.5">
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => exportSync('csv')} disabled={!!exporting}>
                    <FileText size={13} />CSV
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => exportSync('xlsx')} disabled={!!exporting}>
                    <FileSpreadsheet size={13} />Excel
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => exportSync('pdf')} disabled={!!exporting}>
                    <FileType size={13} />PDF
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => exportAsync('pdf')} disabled={!!exporting} title={t('reportExportAsync')}>
                    <Clock3 size={13} />
                  </Button>
                </div>
              }
            >
              {/* parameter row */}
              <div className="flex flex-wrap items-end gap-3 mb-4">
                <div className="space-y-1">
                  <span className="text-[10px] text-muted-foreground">{t('reportWindow')}</span>
                  <Select value={windowDays} onValueChange={setWindowDays}>
                    <SelectTrigger className="w-[110px] h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="7">{t('reportWindow7')}</SelectItem>
                      <SelectItem value="30">{t('reportWindow30')}</SelectItem>
                      <SelectItem value="90">{t('reportWindow90')}</SelectItem>
                      <SelectItem value="365">{t('reportWindow365')}</SelectItem>
                      <SelectItem value="custom">{t('reportWindowCustom')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {windowDays === 'custom' && (
                  <>
                    <div className="space-y-1">
                      <span className="text-[10px] text-muted-foreground">{t('reportFrom')}</span>
                      <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-[140px] h-8 text-xs" dir="ltr" />
                    </div>
                    <div className="space-y-1">
                      <span className="text-[10px] text-muted-foreground">{t('reportTo')}</span>
                      <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-[140px] h-8 text-xs" dir="ltr" />
                    </div>
                  </>
                )}
                <div className="space-y-1">
                  <span className="text-[10px] text-muted-foreground">{t('reportGroupBy')}</span>
                  <Select value={groupBy} onValueChange={setGroupBy}>
                    <SelectTrigger className="w-[130px] h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">{selected.defaultGroupBy ? `— ${selected.defaultGroupBy}` : 'default'}</SelectItem>
                      <SelectItem value="day">{t('reportGroupDay')}</SelectItem>
                      <SelectItem value="week">{t('reportGroupWeek')}</SelectItem>
                      <SelectItem value="month">{t('reportGroupMonth')}</SelectItem>
                      <SelectItem value="none">{t('reportGroupNone')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {selected.id === 'custom.dataset' && (
                  <div className="space-y-1">
                    <span className="text-[10px] text-muted-foreground">{t('reportDataset')}</span>
                    <Select value={dataset} onValueChange={setDataset}>
                      <SelectTrigger className="w-[120px] h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="payments">{lang === 'fa' ? 'پرداخت‌ها' : 'Payments'}</SelectItem>
                        <SelectItem value="orders">{lang === 'fa' ? 'سفارش‌ها' : 'Orders'}</SelectItem>
                        <SelectItem value="cases">{lang === 'fa' ? 'پرونده‌ها' : 'Cases'}</SelectItem>
                        <SelectItem value="users">{lang === 'fa' ? 'کاربران' : 'Users'}</SelectItem>
                        <SelectItem value="audit-logs">{lang === 'fa' ? 'لاگ امنیتی' : 'Audit logs'}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <Button size="sm" className="gap-1.5 ms-auto" onClick={run} disabled={running}>
                  <Play size={13} />{result ? t('reportRerun') : t('reportRun')}
                </Button>
              </div>

              {/* result area */}
              {running && <LoadingRows rows={5} />}
              {runError && !running && <ErrorState message={runError} onRetry={run} />}
              {!running && !runError && !result && <EmptyState text={t('reportEmpty')} />}
              {!running && !runError && result && (
                <div className="space-y-4">
                  {/* summary stat cards */}
                  {result.summary && result.summary.length > 0 && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                      {result.summary.slice(0, 8).map((s) => (
                        <StatCard
                          key={s.key}
                          title={lang === 'fa' ? s.fa : s.en}
                          value={s.type === 'money' ? fmtMoney(s.value, lang) : s.type === 'percent' ? `${s.value}٪` : s.value}
                          tone="bg-brand-light/15 text-brand-dark dark:text-brand-light"
                        />
                      ))}
                    </div>
                  )}

                  {/* chart */}
                  {result.chart && result.chart.rows.length > 0 && (
                    <div className="rounded-xl border border-border p-2">
                      <ResponsiveContainer width="100%" height={200}>
                        <AreaChart data={result.chart.rows}>
                          <defs>
                            {result.chart.series.map((ser, i) => (
                              <linearGradient key={ser.key} id={`rep-${ser.key}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={`var(--chart-${(i % 4) + 1})`} stopOpacity={0.35} />
                                <stop offset="95%" stopColor={`var(--chart-${(i % 4) + 1})`} stopOpacity={0} />
                              </linearGradient>
                            ))}
                          </defs>
                          <CartesianGrid strokeDasharray={chartTheme.grid.strokeDasharray} stroke={chartTheme.grid.stroke} vertical={chartTheme.grid.vertical} />
                          <XAxis dataKey={result.chart.bucketKey} {...chartTheme.axis} />
                          <YAxis {...chartTheme.axis} />
                          <Tooltip contentStyle={{ ...chartTheme.tooltip }} />
                          {result.chart.series.map((ser, i) => (
                            <Area key={ser.key} type="monotone" dataKey={ser.key} name={lang === 'fa' ? ser.fa : ser.en} stroke={`var(--chart-${(i % 4) + 1})`} fill={`url(#rep-${ser.key})`} strokeWidth={2} />
                          ))}
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {/* meta line */}
                  <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                    <Badge variant="outline" className="text-[9px] gap-1"><Clock3 size={10} />{result.meta.from.slice(0, 10)} → {result.meta.to.slice(0, 10)}</Badge>
                    {result.meta.cached && <Badge variant="secondary" className="text-[9px]">{t('reportCached')}</Badge>}
                    {result.meta.truncated && <Badge className="bg-status-warning/15 text-status-warning-text text-[9px]">{t('reportTruncated')} ({result.meta.totalRows})</Badge>}
                    <span className="tabular-nums" dir="ltr">{result.meta.ms}ms · {result.rows.length} {t('reportRows')}</span>
                    {(lang === 'fa' ? result.meta.noteFa : result.meta.noteEn) && (
                      <span className="basis-full">{lang === 'fa' ? result.meta.noteFa : result.meta.noteEn}</span>
                    )}
                  </div>

                  {/* table */}
                  {result.rows.length === 0 ? <EmptyState text={t('reportEmpty')} /> : (
                    <div className="overflow-x-auto rounded-xl border border-border">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-primary text-primary-foreground">
                            {result.columns.map((c) => (
                              <th key={c.key} className="text-start font-semibold px-3 py-2 whitespace-nowrap">{lang === 'fa' ? c.fa : c.en}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {result.rows.map((row, i) => (
                            <tr key={i} className={`border-t border-border ${i % 2 ? 'bg-muted/40' : ''}`}>
                              {result.columns.map((c) => {
                                const v = row[c.key]
                                return (
                                  <td key={c.key} className="px-3 py-1.5 whitespace-nowrap">
                                    {c.type === 'money' && typeof v === 'number' ? <Money amount={v} /> :
                                     c.type === 'date' ? <span className="tabular-nums text-muted-foreground" dir="ltr">{String(v ?? '').slice(0, 10)}</span> :
                                     typeof v === 'number' ? <span className="tabular-nums" dir="ltr">{v}</span> :
                                     <span>{v === null || v === undefined || v === '' ? '—' : String(v)}</span>}
                                  </td>
                                )
                              })}
                            </tr>
                          ))}
                          {result.totals && Object.keys(result.totals).length > 0 && (
                            <tr className="border-t-2 border-border bg-muted/70 font-semibold">
                              {result.columns.map((c) => {
                                const v = result.totals![c.key]
                                return (
                                  <td key={c.key} className="px-3 py-2">
                                    {v === undefined ? '' : c.type === 'money' ? <Money amount={v} /> : <span className="tabular-nums" dir="ltr">{v}</span>}
                                  </td>
                                )
                              })}
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </SectionCard>
          )}

          {/* my async exports */}
          <SectionCard title={t('reportMyExports')} action={<Button size="sm" variant="ghost" onClick={loadArtifacts} className="h-7 text-xs">{t('refresh')}</Button>}>
            {!artifacts && <LoadingRows rows={2} />}
            {artifacts && artifacts.length === 0 && <EmptyState text={t('reportEmpty')} />}
            {artifacts && artifacts.length > 0 && (
              <div className="space-y-1.5 text-xs">
                {artifacts.map((a) => (
                  <div key={a.id} className="tile-row">
                    <FileText size={13} className="text-primary shrink-0" />
                    <span className="truncate" dir="ltr">{a.fileName}</span>
                    <span className="text-[10px] text-muted-foreground tabular-nums">{Math.round(a.sizeBytes / 1024)}KB</span>
                    <Button
                      size="sm" variant="outline" className="ms-auto h-7 gap-1 text-[11px]"
                      onClick={() => apiDownload(`/api/v1/reports/exports/${a.id}`).then(({ blob, filename }) => saveBlob(blob, filename)).catch((e) => toast.error((e as ApiError).message))}
                    >
                      <Download size={12} />{t('reportDownload')}
                    </Button>
                  </div>
                ))}
                <p className="text-[10px] text-muted-foreground">{lang === 'fa' ? 'فایل‌ها تا ۲۴ ساعت معتبرند.' : 'Artifacts stay valid for 24 hours.'}</p>
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  )
}
