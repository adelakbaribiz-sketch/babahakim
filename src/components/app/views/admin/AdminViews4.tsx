'use client'
// ── Admin views 4: Observability Console (PHASE 15) ───────────────────────
// Single ADMIN surface for the whole observability stack (ED-180):
//   • health banner (ok/degraded/down) + uptime + probes
//   • system cards: CPU, memory (heap/rss/system), disk, event-loop lag
//   • queue + DB cards (depth, dead letters, ping, p95)
//   • live time-series charts (API latency p95, req/min, error count,
//     memory) from the 30s sampler ring
//   • business tiles (today: users, cases, AI runs, orders, payments, revenue)
//   • alerts feed (open/resolved, severity chips, manual resolve → audited)
//   • log explorer: ServiceLog search (q/lvl/svc/route/corrId) + live tail
// Read-only telemetry + the single ALERT_RESOLVE action (Backend-SoT).
import React, { useState } from 'react'
import { useApp } from '@/contexts/app'
import { useApiQuery } from '@/hooks/use-api'
import { ApiError } from '@/lib/api-error'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { toast } from 'sonner'
import { SectionCard, LoadingRows, EmptyState, ErrorState } from '../../shared/atoms'
import { Activity, Cpu, HardDrive, MemoryStick, Database, ListChecks, AlertTriangle, CheckCircle2, Gauge, RefreshCw, FileSearch, HeartPulse, Timer } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { toFaDigits, formatJalali } from '@/lib/jalali'

interface Snapshot {
  health: {
    status: 'ok' | 'degraded' | 'down'
    liveness: { status: string; uptimeSec: number }
    readiness: { status: string; checks: { db: boolean; dbPingMs: number; queue: boolean; storage: boolean; bootstrap: boolean } }
  }
  system: {
    at: string
    uptimeSec: number
    cpu: { processPercent: number | null; loadAvg1: number | null; cores: number } | null
    memory: { rssBytes: number; heapUsedBytes: number; heapTotalBytes: number; systemFreeBytes: number; systemTotalBytes: number; systemUsedPercent: number | null } | null
    disk: { path: string; freeBytes: number | null; totalBytes: number | null; usedPercent: number | null } | null
    eventLoopLagMs: number | null
    node: { version: string; platform: string }
  }
  queue: { pending: number; dead: number; handlerCount: number; workerAlive: boolean; lastJobAt: number | null }
  db: { pingOk: boolean; pingMs: number }
  metrics: {
    counters: Record<string, number>
    gauges: Record<string, number>
    histograms: Record<string, { p50: number; p95: number; p99: number; count: number; avg: number; max: number }>
  }
  series: { at: string; uptimeSec: number; counters: Record<string, number>; gauges: Record<string, number>; histograms?: Record<string, { p95: number }> }[]
  integrations: { kind: string; mode: string; circuit: string; successRate: number; p95: number }[]
  alerts: { id: string; key: string; severity: string; status: string; fa: string; en: string; firstSeenAt: string; lastSeenAt: string; resolvedAt: string | null; fireCount: number }[]
  openAlertCount: number
  logs: { ringSize: number; durableCount: number; tail: { t: string; lvl: string; svc: string; msg: string; corrId?: string }[] }
  metricPointCount: number
}

function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1)
}

interface LogRow {
  id?: string
  t: string
  lvl: string
  svc: string
  msg: string
  route?: string | null
  method?: string | null
  status?: number | null
  reqId?: string | null
  corrId?: string | null
}

interface LogSearchResult {
  logs: LogRow[]
  meta?: { page: number; total: number; pages: number }
}

function statusColor(status: string): string {
  if (status === 'ok' || status === 'ready' || status === 'RESOLVED' || status === 'live') return 'bg-status-success text-status-success-fg'
  if (status === 'degraded' || status === 'WARN') return 'bg-status-warning text-status-warning-fg'
  return 'bg-status-danger text-status-danger-fg'
}

function MetricCard({ icon, title, value, sub, tone }: { icon: React.ReactNode; title: string; value: string; sub?: string; tone?: 'ok' | 'warn' | 'bad' }) {
  return (
    <Card className="p-3">
      <CardContent className="p-0 space-y-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {icon}
          <span className="truncate">{title}</span>
        </div>
        <div className={`text-lg font-bold tabular-nums ${tone === 'bad' ? 'text-status-danger' : tone === 'warn' ? 'text-status-warning' : ''}`}>{value}</div>
        {sub ? <div className="text-[10px] text-muted-foreground truncate">{sub}</div> : null}
      </CardContent>
    </Card>
  )
}

export function AdminObservatoryPage() {
  const { t, lang, api } = useApp()
  const { data, error, loading, refetch } = useApiQuery<Snapshot>('/api/v1/admin/observability')
  const [logQ, setLogQ] = useState('')
  const [logLvl, setLogLvl] = useState('')
  const [logs, setLogs] = useState<LogSearchResult | null>(null)
  const [logLoading, setLogLoading] = useState(false)
  const [resolving, setResolving] = useState<string | null>(null)
  const fa = lang === 'fa'

  const n = (x: number | null | undefined) => (x == null ? '—' : fa ? toFaDigits(x) : String(x))
  const ms = (x: number | null | undefined) => (x == null ? '—' : `${fa ? toFaDigits(Math.round(x)) : Math.round(x)}ms`)

  async function searchLogs() {
    setLogLoading(true)
    try {
      const params = new URLSearchParams()
      if (logQ) params.set('q', logQ)
      if (logLvl) params.set('lvl', logLvl)
      params.set('limit', '25')
      const res = (await api(`/api/v1/admin/logs?${params.toString()}`)) as LogSearchResult
      setLogs(res)
    } catch (e) {
      toast.error(ApiError.message(e))
    } finally {
      setLogLoading(false)
    }
  }

  async function resolveAlert(id: string) {
    setResolving(id)
    try {
      await api('/api/v1/admin/alerts', { method: 'POST', json: { id } })
      toast.success(fa ? 'هشدار بسته شد' : 'Alert resolved')
      refetch()
    } catch (e) {
      toast.error(ApiError.message(e))
    } finally {
      setResolving(null)
    }
  }

  if (loading) return <SectionCard title={t('observatory')}><LoadingRows rows={6} /></SectionCard>
  if (error) return <SectionCard title={t('observatory')}><ErrorState error={error} /></SectionCard>
  if (!data) return <SectionCard title={t('observatory')}><EmptyState text={fa ? 'داده‌ای نیست' : 'No data'} /></SectionCard>

  const h = data.health
  const sys = data.system
  const series = [...data.series].reverse().map((s) => ({ ...s, at: s.at.slice(11, 19) }))
  const apiP95 = Object.entries(data.metrics.histograms).filter(([k]) => k.startsWith('api_latency_ms'))
  const apiP95Max = apiP95.length ? Math.max(...apiP95.map(([, v]) => v.p95)) : 0
  const reqTotal = Object.entries(data.metrics.counters).filter(([k]) => k.startsWith('api_requests_total')).reduce((a, [, v]) => a + v, 0)
  const errTotal = Object.entries(data.metrics.counters).filter(([k]) => k.startsWith('api_errors_total')).reduce((a, [, v]) => a + v, 0)
  const dbTotal = Object.entries(data.metrics.counters).filter(([k]) => k.startsWith('db_queries_total')).reduce((a, [, v]) => a + v, 0)
  const dbP95List = Object.entries(data.metrics.histograms).filter(([k]) => k.startsWith('db_query_ms'))
  const dbP95 = dbP95List.length ? Math.max(...dbP95List.map(([, v]) => v.p95)) : 0
  const biz = data.metrics.gauges

  return (
    <div className="space-y-4">
      <SectionCard
        title={t('observatory')}
        desc={fa ? 'پایش سلامت، متریکها، هشدارها و جستجوی لاگ — دادهها فقط خواندنی است' : 'Health, metrics, alerts and log search — read-only telemetry'}
        action={<Button variant="outline" size="sm" onClick={() => { refetch(); void searchLogs() }}><RefreshCw size={14} /></Button>}
      >
        <div className="flex flex-wrap items-center gap-3">
          <Badge className={statusColor(h.status)}>
            <HeartPulse size={12} className="ms-1" /> {h.status.toUpperCase()}
          </Badge>
          <span className="text-xs text-muted-foreground tabular-nums">
            {fa ? 'راه‌اندازی' : 'uptime'}: {n(Math.floor(h.liveness.uptimeSec / 3600))}h {n(Math.floor((h.liveness.uptimeSec % 3600) / 60))}m
          </span>
          <span className="text-xs text-muted-foreground">DB: <Badge className={`text-[10px] ${h.readiness.checks.db ? statusColor('ok') : statusColor('down')}`} />{data.db.pingOk ? ` ${ms(data.db.pingMs)}` : ''}</span>
          <span className="text-xs text-muted-foreground">{fa ? 'کارگر صف' : 'queue worker'}: <Badge className={`text-[10px] ${data.queue.workerAlive ? statusColor('ok') : statusColor('down')}`}>{data.queue.workerAlive ? 'ALIVE' : 'STALLED'}</Badge></span>
          <span className="text-xs text-muted-foreground">storage: <Badge className={`text-[10px] ${h.readiness.checks.storage ? statusColor('ok') : statusColor('down')}`}>{h.readiness.checks.storage ? 'OK' : 'FAIL'}</Badge></span>
          <span className="text-xs text-muted-foreground">Node {sys.node.version} · {sys.node.platform}</span>
          {data.openAlertCount > 0 && (
            <Badge className="bg-status-danger text-status-danger-fg"><AlertTriangle size={12} className="ms-1" /> {n(data.openAlertCount)} {fa ? 'هشدار باز' : 'open alerts'}</Badge>
          )}
        </div>
      </SectionCard>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2">
        <MetricCard icon={<Cpu size={14} />} title={fa ? 'CPU فرآیند' : 'Process CPU'} value={sys.cpu?.processPercent != null ? `${n(sys.cpu.processPercent)}%` : '—'} sub={fa ? `بار سیستم ${sys.cpu?.loadAvg1 ?? '—'} · ${n(sys.cpu?.cores)} هسته` : `load ${sys.cpu?.loadAvg1 ?? '—'} · ${n(sys.cpu?.cores)} cores`} tone={sys.cpu?.processPercent != null && sys.cpu.processPercent > 80 ? 'warn' : undefined} />
        <MetricCard icon={<MemoryStick size={14} />} title={fa ? 'حافظه هیپ' : 'Heap'} value={sys.memory ? `${n(Math.round((sys.memory.heapUsedBytes / sys.memory.heapTotalBytes) * 100))}%` : '—'} sub={sys.memory ? `${n(mb(sys.memory.heapUsedBytes))}/${n(mb(sys.memory.heapTotalBytes))} MB · RSS ${n(mb(sys.memory.rssBytes))}MB` : undefined} />
        <MetricCard icon={<HardDrive size={14} />} title={fa ? 'دیسک' : 'Disk'} value={sys.disk?.usedPercent != null ? `${n(sys.disk.usedPercent)}%` : '—'} sub={sys.disk?.totalBytes ? `${n(mb(sys.disk.totalBytes))} MB` : undefined} tone={sys.disk?.usedPercent != null && sys.disk.usedPercent > 90 ? 'bad' : undefined} />
        <MetricCard icon={<Timer size={14} />} title={fa ? 'تأخیر حلقه' : 'Event loop'} value={ms(sys.eventLoopLagMs)} tone={(sys.eventLoopLagMs ?? 0) > 500 ? 'warn' : undefined} />
        <MetricCard icon={<Database size={14} />} title={fa ? 'کوئریهای DB' : 'DB queries'} value={n(dbTotal)} sub={`p95 ${ms(dbP95)}`} />
        <MetricCard icon={<ListChecks size={14} />} title={fa ? 'صف' : 'Queue'} value={n(data.queue.pending)} sub={fa ? `پس‌مرده ${n(data.queue.dead)} · هندلر ${n(data.queue.handlerCount)}` : `dead ${n(data.queue.dead)} · handlers ${n(data.queue.handlerCount)}`} tone={data.queue.dead > 0 ? 'bad' : data.queue.pending > 100 ? 'warn' : undefined} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
        <MetricCard icon={<Activity size={14} />} title={fa ? 'درخواستهای API' : 'API requests'} value={n(reqTotal)} sub={`p95 ${ms(apiP95Max)}`} />
        <MetricCard icon={<AlertTriangle size={14} />} title={fa ? 'خطاها' : 'Errors'} value={n(errTotal)} sub={reqTotal ? `${n(Math.round((errTotal / reqTotal) * 100))}%` : undefined} tone={errTotal > 0 ? 'warn' : undefined} />
        <MetricCard icon={<Gauge size={14} />} title={fa ? 'کاربران امروز' : 'Users today'} value={n(biz['biz_users_today'])} />
        <MetricCard icon={<Gauge size={14} />} title={fa ? 'پروندههای امروز' : 'Cases today'} value={n(biz['biz_cases_today'])} />
        <MetricCard icon={<Gauge size={14} />} title={fa ? 'تحلیل AI امروز' : 'AI runs today'} value={n(biz['biz_ai_today'])} />
        <MetricCard icon={<Gauge size={14} />} title={fa ? 'درآمد امروز' : 'Revenue today'} value={n(biz['biz_revenue_today_toman'])} sub={fa ? 'تومان' : 'Toman'} />
      </div>

      {series.length > 1 && (
        <SectionCard title={fa ? 'روند زنده (۶ ساعت اخیر)' : 'Live trends (last 6h)'} desc={fa ? 'نمونه‌برداری هر ۳۰ ثانیه' : 'sampled every 30s'}>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="h-48">
              <div className="text-xs text-muted-foreground mb-1">{fa ? 'p95 تأخیر API (ms)' : 'API p95 latency (ms)'}</div>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series.map((s) => ({ at: s.at, p95: Math.max(0, ...Object.entries(s.histograms ?? {}).filter(([k]) => k.startsWith('api_latency_ms')).map(([, v]) => (v as { p95: number }).p95)) }))}>
                  <defs><linearGradient id="gLat" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#57AFE2" stopOpacity={0.6} /><stop offset="100%" stopColor="#57AFE2" stopOpacity={0.05} /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="at" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                  <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" width={40} />
                  <Tooltip contentStyle={{ fontSize: 11, direction: 'ltr' }} />
                  <Area type="monotone" dataKey="p95" stroke="#225BBE" fill="url(#gLat)" strokeWidth={2} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="h-48">
              <div className="text-xs text-muted-foreground mb-1">{fa ? 'حافظه هیپ (MB)' : 'Heap memory (MB)'}</div>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series.map((s) => ({ at: s.at, heap: Math.round(((s.gauges?.['system_mem_heap_used_bytes' as keyof typeof s.gauges] as number) ?? 0) / 1024 / 1024) }))}>
                  <defs><linearGradient id="gMem" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#57AFE2" stopOpacity={0.6} /><stop offset="100%" stopColor="#57AFE2" stopOpacity={0.05} /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="at" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                  <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" width={40} />
                  <Tooltip contentStyle={{ fontSize: 11, direction: 'ltr' }} />
                  <Area type="monotone" dataKey="heap" stroke="#225BBE" fill="url(#gMem)" strokeWidth={2} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </SectionCard>
      )}

      <SectionCard title={fa ? 'هشدارها' : 'Alerts'} desc={fa ? 'قوانین یکپارچه: DB، API، صف، حافظه، دیسک، یکپارچگیها — با خنک‌سازی ۱۵ دقیقه‌ای' : 'Unified rules: DB, API, queue, memory, disk, integrations — 15m cooldown'}>
        {data.alerts.length === 0 ? (
          <EmptyState text={fa ? 'هشدار فعالی نیست' : 'No alerts'} />
        ) : (
          <div className="space-y-2">
            {data.alerts.slice(0, 10).map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-2 text-xs">
                <Badge className={statusColor(a.severity)}>{a.severity}</Badge>
                <Badge className={statusColor(a.status)}>{a.status}</Badge>
                <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">{a.key}</span>
                <span className="flex-1 min-w-40 truncate">{fa ? a.fa : a.en}</span>
                <span className="text-[10px] text-muted-foreground tabular-nums" dir="ltr">{formatJalali(new Date(a.lastSeenAt), { withTime: true, faDigits: fa })}</span>
                <span className="text-[10px] text-muted-foreground">×{n(a.fireCount)}</span>
                {a.status === 'OPEN' && (
                  <Button variant="outline" size="sm" disabled={resolving === a.id} onClick={() => resolveAlert(a.id)}>
                    <CheckCircle2 size={12} /> {fa ? 'بستن' : 'Resolve'}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {data.integrations.length > 0 && (
        <SectionCard title={fa ? 'سرویسهای خارجی' : 'Integrations'}>
          <div className="flex flex-wrap gap-2">
            {data.integrations.map((i) => (
              <Badge key={i.kind} className={`text-[10px] ${i.circuit === 'OPEN' ? statusColor('down') : statusColor(i.mode)}`} variant="outline">
                {i.kind} · {i.mode} · {i.circuit} · {n(Math.round(i.successRate * 100))}%
              </Badge>
            ))}
          </div>
        </SectionCard>
      )}

      <SectionCard title={fa ? 'کاوشگر لاگ' : 'Log explorer'} desc={fa ? 'جستجوی لاگهای ساخت‌یافته (ذخیره اخطار/خطاها) — بدون داده حساس' : 'Searchable structured logs (warn/error persisted) — PII-free'}>
        <div className="flex flex-wrap gap-2 mb-3">
          <input
            value={logQ}
            onChange={(e) => setLogQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && searchLogs()}
            placeholder={fa ? 'جستجو در پیام/سرویس…' : 'search msg/service…'}
            className="h-9 rounded-md border bg-transparent px-3 text-xs w-56"
          />
          <select value={logLvl} onChange={(e) => setLogLvl(e.target.value)} className="h-9 rounded-md border bg-transparent px-2 text-xs">
            <option value="">{fa ? 'همه سطوح' : 'all levels'}</option>
            <option value="warn">warn</option>
            <option value="error">error</option>
          </select>
          <Button size="sm" onClick={searchLogs} disabled={logLoading}><FileSearch size={14} /> {fa ? 'جستجو' : 'Search'}</Button>
          <span className="text-[10px] text-muted-foreground self-center">
            {fa ? `ذخیره‌شده: ${n(data.logs.durableCount)} · حلقه: ${n(data.logs.ringSize)}` : `durable: ${n(data.logs.durableCount)} · ring: ${n(data.logs.ringSize)}`}
          </span>
        </div>
        {!logs ? (
          <div className="space-y-1">
            <div className="text-[10px] text-muted-foreground mb-1">{fa ? 'آخرین خطوط (حلقه درون‌حافظه)' : 'latest lines (in-memory ring)'}</div>
            {data.logs.tail.map((l, i) => (
              <div key={i} className="flex gap-2 text-[10px] font-mono items-baseline" dir="ltr">
                <span className="text-muted-foreground shrink-0">{l.t.slice(11, 19)}</span>
                <span className={`shrink-0 font-bold ${l.lvl === 'error' ? 'text-status-danger' : 'text-status-warning'}`}>{l.lvl.toUpperCase()}</span>
                <span className="text-muted-foreground shrink-0">{l.svc}</span>
                <span className="truncate">{l.msg}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            {logs.logs.length === 0 ? <EmptyState text={fa ? 'نتیجه‌ای نیست' : 'No results'} /> : logs.logs.map((l) => (
              <div key={l.id ?? l.t + l.msg} className="flex gap-2 text-[10px] font-mono items-baseline" dir="ltr">
                <span className="text-muted-foreground shrink-0">{String(l.t).slice(11, 19)}</span>
                <span className={`shrink-0 font-bold ${l.lvl === 'error' ? 'text-status-danger' : 'text-status-warning'}`}>{l.lvl.toUpperCase()}</span>
                <span className="text-muted-foreground shrink-0">{l.svc}</span>
                {l.route ? <span className="text-muted-foreground shrink-0 max-w-40 truncate">{l.route}</span> : null}
                <span className="truncate">{l.msg}</span>
                {l.corrId ? <span className="text-muted-foreground shrink-0">{l.corrId}</span> : null}
              </div>
            ))}
            {logs.meta ? <div className="text-[10px] text-muted-foreground">{fa ? `${n(logs.meta.total)} ردیف` : `${logs.meta.total} rows`}</div> : null}
          </div>
        )}
      </SectionCard>
    </div>
  )
}
