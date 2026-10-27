'use client'
// Staff views: Dashboard (role-aware), Case queue, Operator payments & shipments
import React, { useCallback, useEffect, useState } from 'react'
import { useApp } from '@/contexts/app'
import { useApiQuery, useDebounced } from '@/hooks/use-api'
import { ApiError } from '@/lib/api-error'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { SectionCard, StatusBadge, StatCard, JalaliDate, LoadingRows, EmptyState, ErrorState, Money } from '../../shared/atoms'
import { TextAreaField } from '../../shared/form'
import { QUEUES } from '@/lib/workflow/queues'
// PHASE 09: CaseWorkspace is a lazy chunk (router) — no eager import/re-export.
import { fmtMoney } from '@/lib/i18n'
import { STATUS_META, ROLE_LABELS, statusLabel } from '@/lib/constants'
import { LayoutDashboard, Users, FolderOpen, ListChecks, CreditCard, Truck, Bell, CheckCircle2, XCircle, Hourglass, ScanHeart, ClipboardCheck, Stethoscope, Package, BarChart3, User } from 'lucide-react'

// ── Staff dashboard ─────────────────────────────────────────────────────
export function StaffDashboard({ navigate }: { navigate: (p: string, params?: Record<string, string>) => void }) {
  const { t, lang, user } = useApp()
  // PHASE 09 (ED-109): standard query — error retry instead of swallowed catch
  const { data, error, loading, refetch } = useApiQuery<{
    stats: Record<string, number>
    queue: { id: string; code: string; status: string; priority: string; createdAt: string; waitingHours: number; patient: { firstName: string; lastName: string; phone: string }; mizajSnapshot?: { mizajFa?: string } | null }[]
    recentEvents: { id: string; action: string; fromStatus?: string; toStatus?: string; comment?: string; reason?: string | null; createdAt: string; case?: { id: string; code: string; status: string; patient?: { firstName: string; lastName: string } }; actor?: { firstName: string; lastName: string; role: string } | null }[]
  }>('/api/v1/dashboard')

  if (loading && !data) return <LoadingRows rows={5} />
  if (error && !data) return <ErrorState message={error.supportRef} onRetry={refetch} />
  if (!data) return <LoadingRows rows={5} />

  const s = data.stats
  const role = user?.role

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('dashboard')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{ROLE_LABELS[role as keyof typeof ROLE_LABELS]?.[lang]} — {user?.firstName} {user?.lastName}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard title={lang === 'fa' ? 'کل پرونده‌ها' : 'Total cases'} value={s.totalCases} icon={<FolderOpen size={18} />} />
        {role === 'EXPERT_1' && <StatCard title={lang === 'fa' ? 'در صف شما' : 'In your queue'} value={s.pendingExpert1} icon={<ListChecks size={18} />} tone="bg-status-warning/10 text-status-warning" />}
        {(role === 'EXPERT_1' || role === 'EXPERT_2' || role === 'ADMIN') && <StatCard title={lang === 'fa' ? 'برگشتی / نیازمند اصلاح' : 'Returned for revision'} value={s.revisionRequested ?? 0} icon={<ListChecks size={18} />} tone="bg-status-revision/10 text-status-revision" />}
        {role === 'EXPERT_2' && <StatCard title={lang === 'fa' ? 'در انتظار بازبینی' : 'Awaiting review'} value={s.pendingExpert2} icon={<ListChecks size={18} />} tone="bg-brand-light/15 text-brand-dark dark:text-brand-light" />}
        {role === 'DOCTOR' && <StatCard title={lang === 'fa' ? 'در انتظار تأیید' : 'Awaiting approval'} value={s.pendingDoctor} icon={<Stethoscope size={18} />} tone="bg-brand-dark/10 text-brand-dark dark:bg-brand-light/15 dark:text-brand-light" />}
        {(role === 'OPERATOR' || role === 'ADMIN') && <>
          <StatCard title={lang === 'fa' ? 'در انتظار پرداخت' : 'Awaiting payment'} value={s.awaitingPayment} icon={<CreditCard size={18} />} tone="bg-destructive/10 text-destructive" />
          <StatCard title={lang === 'fa' ? 'پیش‌فاکتور' : 'Proformas'} value={s.proformas} icon={<Hourglass size={18} />} />
          <StatCard title={lang === 'fa' ? 'در ارسال' : 'Shipping'} value={s.shipped} icon={<Truck size={18} />} />
        </>}
        <StatCard title={lang === 'fa' ? 'بیماران' : 'Patients'} value={s.totalPatients} icon={<Users size={18} />} />
        <StatCard title={lang === 'fa' ? 'تیکت‌های باز' : 'Open tickets'} value={s.openTickets} icon={<Bell size={18} />} tone="bg-status-warning/10 text-status-warning" />
        <StatCard title={lang === 'fa' ? 'پیگیری فعال' : 'Follow-ups'} value={s.followups} icon={<ScanHeart size={18} />} />
        {(role === 'ADMIN' || role === 'OPERATOR' || role === 'EXPERT_2') && <StatCard title={t('revenue')} value={fmtMoney(s.revenue || 0, lang)} icon={<BarChart3 size={18} />} tone="bg-brand-light/15 text-brand-dark dark:text-brand-light" />}
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        <SectionCard className="lg:col-span-2" title={lang === 'fa' ? 'صف کاری' : 'Work queue'} action={<Button size="sm" variant="outline" onClick={() => navigate('queue')}>{t('queue')}</Button>}>
          {data.queue.length === 0 ? <EmptyState /> : (
            <div className="space-y-2">
              {data.queue.slice(0, 6).map((c) => (
                <button key={c.id} onClick={() => navigate('caseDetail', { id: c.id })} className="w-full text-start rounded-lg border p-3 hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-2 flex-wrap text-sm">
                    <span className="font-bold tabular-nums">{c.code}</span>
                    <StatusBadge status={c.status} />
                    {c.priority !== 'NORMAL' && <Badge variant="destructive" className="text-[10px]">{c.priority}</Badge>}
                    <span className="text-xs text-muted-foreground">{c.patient.firstName} {c.patient.lastName}</span>
                    <span className="ms-auto text-xs text-status-warning flex items-center gap-1" dir={lang === 'fa' ? 'rtl' : 'ltr'}>
                      <Hourglass size={12} /> {c.waitingHours} {t('hours')}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title={lang === 'fa' ? 'آخرین رخدادها' : 'Recent activity'}>
          <div className="space-y-3">
            {data.recentEvents.slice(0, 8).map((e) => (
              <div key={e.id} className="text-xs space-y-1">
                {/* badge = the case's CURRENT status (central STATUS_META); the
                    historical transition is plain text — a past "awaiting user
                    approval" step no longer looks like a stuck case */}
                <button type="button" className="flex items-center gap-2 flex-wrap text-start hover:underline" onClick={() => e.case && navigate('caseDetail', { id: e.case.id })} disabled={!e.case}>
                  {e.case && <span className="tabular-nums text-muted-foreground">{e.case.code}</span>}
                  {e.case?.patient && <span>{e.case.patient.firstName} {e.case.patient.lastName}</span>}
                  {e.case && <StatusBadge status={e.case.status} />}
                </button>
                {e.toStatus && (
                  <div className="text-[11px] text-muted-foreground">
                    {e.fromStatus ? statusLabel(e.fromStatus, lang) : '—'} ← {statusLabel(e.toStatus, lang)}
                  </div>
                )}
                <div className="text-muted-foreground">{e.actor ? `${e.actor.firstName} ${e.actor.lastName} · ` : ''}{e.comment || e.action}{e.reason ? ` — ${lang === 'fa' ? 'علت' : 'reason'}: ${e.reason}` : ''}</div>
                <div className="text-[10px] text-muted-foreground"><JalaliDate date={e.createdAt} withTime /></div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  )
}

// ── Queue (staff) ───────────────────────────────────────────────────────
export function QueuePage({ navigate }: { navigate: (p: string, params?: Record<string, string>) => void }) {
  const { t, lang, api, user } = useApp()
  const isAdmin = user?.role === 'ADMIN'
  // default queue per role (single source: lib/workflow/queues)
  const defaultQueue = user?.role === 'EXPERT_1' ? 'expert1' : user?.role === 'EXPERT_2' ? 'expert2' : user?.role === 'DOCTOR' ? 'doctor' : 'ALL'
  const [queue, setQueue] = useState(defaultQueue)
  const [range, setRange] = useState('ALL')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [priority, setPriority] = useState('ALL')
  const [archived, setArchived] = useState(false)
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const debouncedQ = useDebounced(q) // PHASE 09 (F09): debounced search
  const [archiveFor, setArchiveFor] = useState<{ id: string; code: string; restore: boolean } | null>(null)
  const [archiveReason, setArchiveReason] = useState('')

  const params = new URLSearchParams({ page: String(page), limit: '25' })
  if (queue !== 'ALL') params.set('queue', queue)
  if (range !== 'ALL' && range !== 'CUSTOM') params.set('range', range)
  if (range === 'CUSTOM' && from) params.set('from', from)
  if (range === 'CUSTOM' && to) params.set('to', to)
  if (priority !== 'ALL') params.set('priority', priority)
  if (archived) params.set('archived', '1')
  if (debouncedQ) params.set('q', debouncedQ)
  const { data, error, loading, refetch } = useApiQuery<{
    cases: {
      id: string; code: string; status: string; priority: string; createdAt: string; lastActivityAt: string; followUpAt?: string | null
      archivedAt?: string | null; archiveReason?: string | null; waitingHours: number
      patient: { firstName: string; lastName: string; phone: string; age: number | null; province: string | null; city: string | null }
      expert1?: { firstName: string; lastName: string } | null; expert2?: { firstName: string; lastName: string } | null; doctor?: { firstName: string; lastName: string } | null
      mizajSnapshot?: { mizajFa?: string } | null
    }[]
    total: number; pages: number
  }>(`/api/v1/cases?${params.toString()}`)
  const cases = data?.cases || []

  async function claim(id: string) {
    try {
      await api(`/api/v1/cases/${id}/action`, { method: 'POST', json: { action: 'CLAIM' } })
      toast.success('پرونده دریافت شد ✓')
      navigate('caseDetail', { id })
    } catch (e) { toast.error((e as Error).message) }
  }

  async function submitArchive() {
    if (!archiveFor) return
    try {
      await api(`/api/v1/cases/${archiveFor.id}/archive`, { method: 'POST', json: { action: archiveFor.restore ? 'RESTORE' : 'ARCHIVE', reason: archiveReason } })
      toast.success(t('successTitle')); setArchiveFor(null); setArchiveReason(''); refetch()
    } catch (e) { toast.error(ApiError.message(e)) }
  }

  const fullName = (p?: { firstName: string; lastName: string } | null) => p ? `${p.firstName} ${p.lastName}` : '—'
  const sel = (value: string, onChange: (v: string) => void, opts: [string, string][], w = 'w-44', label?: string) => (
    <Select value={value} onValueChange={(v) => { onChange(v); setPage(1) }}>
      <SelectTrigger className={w} aria-label={label}><SelectValue /></SelectTrigger>
      <SelectContent>{opts.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
    </Select>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="page-title"><ListChecks size={22} />{t('queue')}</h1>
        <div className="ms-auto flex gap-2 flex-wrap">
          <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} placeholder={lang === 'fa' ? 'کد پرونده، نام یا موبایل بیمار…' : 'Case code, patient name or mobile…'} className="w-60" />
          {sel(queue, setQueue, [['ALL', lang === 'fa' ? 'همه صف‌ها' : 'All queues'], ...QUEUES.map((qd) => [qd.key, lang === 'fa' ? qd.fa : qd.en] as [string, string])], 'w-48', lang === 'fa' ? 'صف' : 'Queue')}
          {sel(range, setRange, [['ALL', lang === 'fa' ? 'همه زمان‌ها' : 'Any time'], ['today', lang === 'fa' ? 'امروز' : 'Today'], ['7d', lang === 'fa' ? '۷ روز اخیر' : 'Last 7 days'], ['30d', lang === 'fa' ? 'یک ماه اخیر' : 'Last month'], ['90d', lang === 'fa' ? 'سه ماه اخیر' : 'Last 3 months'], ['CUSTOM', lang === 'fa' ? 'بازه دلخواه' : 'Custom range']], 'w-40', lang === 'fa' ? 'بازه زمانی' : 'Period')}
          {range === 'CUSTOM' && <>
            <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1) }} className="w-40" aria-label={lang === 'fa' ? 'از تاریخ' : 'From'} dir="ltr" />
            <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1) }} className="w-40" aria-label={lang === 'fa' ? 'تا تاریخ' : 'To'} dir="ltr" />
          </>}
          {sel(priority, setPriority, [['ALL', lang === 'fa' ? 'همه اولویت‌ها' : 'Any priority'], ['URGENT', 'URGENT'], ['HIGH', 'HIGH'], ['NORMAL', 'NORMAL'], ['LOW', 'LOW']], 'w-36', lang === 'fa' ? 'اولویت' : 'Priority')}
          {isAdmin && (
            <Button variant={archived ? 'default' : 'outline'} size="sm" onClick={() => { setArchived(!archived); setPage(1) }}>
              {archived ? (lang === 'fa' ? 'نمایش فعال‌ها' : 'Show active') : (lang === 'fa' ? 'بایگانی' : 'Archive')}
            </Button>
          )}
        </div>
      </div>

      {loading && !data ? <LoadingRows /> : error ? <ErrorState message={error.supportRef} onRetry={refetch} /> : cases.length === 0 ? <EmptyState /> : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr className="text-start">
                  {[lang === 'fa' ? 'کد پرونده' : 'Case', lang === 'fa' ? 'بیمار' : 'Patient', lang === 'fa' ? 'موبایل' : 'Mobile', lang === 'fa' ? 'سن' : 'Age',
                    lang === 'fa' ? 'استان / شهر' : 'Province / city', lang === 'fa' ? 'وضعیت' : 'Status', lang === 'fa' ? 'کارشناس / پزشک' : 'Expert / doctor',
                    lang === 'fa' ? 'ایجاد' : 'Created', lang === 'fa' ? 'آخرین فعالیت' : 'Last activity', lang === 'fa' ? 'پیگیری بعدی' : 'Next follow-up', ''].map((h, i) => (
                    <th key={i} className="px-3 py-2 font-medium text-start whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cases.map((c) => (
                  <tr key={c.id} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <button className="font-bold tabular-nums hover:underline" onClick={() => navigate('caseDetail', { id: c.id })}>{c.code}</button>
                      {c.priority !== 'NORMAL' && <Badge variant="destructive" className="ms-1 text-[9px]">{c.priority}</Badge>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{fullName(c.patient)}</td>
                    <td className="px-3 py-2 tabular-nums" dir="ltr">{c.patient.phone}</td>
                    <td className="px-3 py-2 tabular-nums">{c.patient.age ?? '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{[c.patient.province, c.patient.city].filter(Boolean).join(' / ') || '—'}</td>
                    <td className="px-3 py-2"><StatusBadge status={c.status} /></td>
                    <td className="px-3 py-2 whitespace-nowrap">{[c.expert1, c.expert2, c.doctor].filter(Boolean).map((p) => fullName(p)).join('، ') || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap"><JalaliDate date={c.createdAt} /></td>
                    <td className="px-3 py-2 whitespace-nowrap"><JalaliDate date={c.lastActivityAt} withTime /></td>
                    <td className="px-3 py-2 whitespace-nowrap">{c.followUpAt ? <JalaliDate date={c.followUpAt} /> : '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="flex gap-1.5 justify-end">
                        {user?.role === 'EXPERT_1' && c.status === 'WAITING_FOR_EXPERT_1' && (
                          <Button size="sm" className="h-7 gap-1" onClick={() => claim(c.id)}><ClipboardCheck size={13} />{lang === 'fa' ? 'دریافت' : 'Claim'}</Button>
                        )}
                        {isAdmin && (
                          <Button size="sm" variant="ghost" className="h-7" onClick={() => setArchiveFor({ id: c.id, code: c.code, restore: !!c.archivedAt })}>
                            {c.archivedAt ? (lang === 'fa' ? 'بازگردانی' : 'Restore') : (lang === 'fa' ? 'بایگانی' : 'Archive')}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {data && data.pages > 1 && (
        <div className="flex items-center justify-center gap-2 text-xs">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>{lang === 'fa' ? 'قبلی' : 'Prev'}</Button>
          <span className="tabular-nums">{page} / {data.pages} · {data.total}</span>
          <Button size="sm" variant="outline" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>{lang === 'fa' ? 'بعدی' : 'Next'}</Button>
        </div>
      )}

      <Dialog open={!!archiveFor} onOpenChange={(v) => { if (!v) { setArchiveFor(null); setArchiveReason('') } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{archiveFor?.restore ? (lang === 'fa' ? 'بازگردانی از بایگانی' : 'Restore from archive') : (lang === 'fa' ? 'بایگانی پرونده' : 'Archive case')} {archiveFor?.code}</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">{lang === 'fa' ? 'بایگانی حذف نیست؛ همه سوابق حفظ می‌شود و پرونده قابل بازگردانی است.' : 'Archiving is not deletion — all records are kept and the case can be restored.'}</p>
          <TextAreaField label={lang === 'fa' ? 'علت' : 'Reason'} required rows={2} value={archiveReason} onChange={(e) => setArchiveReason(e.target.value)} />
          <DialogFooter><Button disabled={archiveReason.trim().length < 3} onClick={submitArchive}>{t('confirm')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Operator: payments verify ───────────────────────────────────────────
export function PaymentsVerifyPage() {
  const { t, lang, api } = useApp()
  interface Pay { id: string; code: string; method: string; status: string; amount: number; refNumber?: string; trackingCode?: string; receiptNote?: string; receiptUrl?: string | null; createdAt: string; verifiedBy?: { firstName: string; lastName: string } | null; order: { code: string; user: { firstName: string; lastName: string; phone: string } } }
  const [status, setStatus] = useState('AWAITING_VERIFY')
  const [sel, setSel] = useState<Pay | null>(null)
  // PHASE 09 (F05/F17): loading init + proper Dialog for the receipt viewer
  const { data, error, loading, refetch } = useApiQuery<{ payments: Pay[] }>(`/api/v1/payments${status ? `?status=${status}` : ''}`)
  const pays = data?.payments || []

  async function verify(id: string, decision: string, note?: string) {
    try {
      await api(`/api/v1/payments/${id}/verify`, { method: 'POST', json: { decision, note } })
      toast.success(t('successTitle')); refetch(); setSel(null)
    } catch (e) { toast.error((e as Error).message) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="page-title"><CreditCard size={22} />{t('payments')}</h1>
        <Select value={status || 'ALL'} onValueChange={(v) => setStatus(v === 'ALL' ? '' : v)}>
          <SelectTrigger className="w-64 ms-auto"><SelectValue /></SelectTrigger>
          <SelectContent>
            {['ALL', 'AWAITING_VERIFY', 'PENDING', 'PAID', 'FAILED', 'REJECTED', 'REFUNDED'].map((s) => (
              <SelectItem key={s} value={s}>{s === 'ALL' ? t('all') : s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? <LoadingRows /> : error ? <ErrorState message={error.supportRef} onRetry={refetch} /> : pays.length === 0 ? <EmptyState /> : (
        <div className="space-y-2">
          {pays.map((p) => (
            <Card key={p.id}>
              <CardContent className="p-4 flex items-center gap-3 flex-wrap">
                <span className="font-bold tabular-nums text-sm">{p.code}</span>
                <StatusBadge status={p.status} kind="payment" />
                <Badge variant="outline" className="text-[10px]">{p.method === 'ZARINPAL' ? 'زرین‌پال' : 'کارت‌به‌کارت'}</Badge>
                <span className="text-xs text-muted-foreground">{p.order.user.firstName} {p.order.user.lastName} · {p.order.code}</span>
                <span className="font-bold tabular-nums text-sm"><Money amount={p.amount} /></span>
                {p.trackingCode && <span className="text-xs text-muted-foreground" dir="ltr">#: {p.trackingCode}</span>}
                <span className="ms-auto text-xs text-muted-foreground"><JalaliDate date={p.createdAt} /></span>
                {p.status === 'AWAITING_VERIFY' && (
                  <div className="flex gap-2 ms-2">
                    {p.receiptUrl && <Button size="sm" variant="outline" onClick={() => setSel(p)}>{t('receipt')}</Button>}
                    <Button size="sm" className="btn-brand-hover gap-1" onClick={() => verify(p.id, 'APPROVE')}><CheckCircle2 size={14} /></Button>
                    <Button size="sm" variant="outline" className="text-destructive gap-1" onClick={() => verify(p.id, 'REJECT', 'رسید نامعتبر')}><XCircle size={14} /></Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* PHASE 09 (F17): receipt viewer uses the accessible Dialog (focus trap,
          Escape, role=dialog) instead of a hand-rolled fixed overlay */}
      <Dialog open={!!sel} onOpenChange={(o) => !o && setSel(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{t('receipt')} — {sel?.code}</DialogTitle></DialogHeader>
          {sel?.receiptUrl
            ? <img src={sel.receiptUrl} alt={t('receipt')} className="w-full rounded-lg" loading="lazy" />
            : <div className="text-sm text-muted-foreground">{lang === 'fa' ? 'رسید تصویری ارسال نشده — شماره پیگیری:' : 'No receipt image — tracking code:'} {sel?.trackingCode || '—'}</div>}
          <div className="flex gap-2">
            <Button className="flex-1 btn-brand-hover gap-1" onClick={() => sel && verify(sel.id, 'APPROVE')}><CheckCircle2 size={14} />{t('confirm')}</Button>
            <Button variant="outline" className="flex-1 text-destructive gap-1" onClick={() => sel && verify(sel.id, 'REJECT', 'رسید نامعتبر')}><XCircle size={14} />{t('reject')}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Operator: shipments ─────────────────────────────────────────────────
export function ShipmentsPage() {
  const { t, lang, api } = useApp()
  const { data, error, loading, refetch } = useApiQuery<{ shipments: { id: string; method: string; status: string; driverName?: string; driverPhone?: string; trackingCode?: string; cost: number; shippingDate?: string; deliveryDate?: string; order: { code: string; status: string; user: { firstName: string; lastName: string; phone: string } } }[] }>('/api/v1/shipments')
  const shipments = data?.shipments || []

  async function update(id: string, status: string) {
    try {
      await api('/api/v1/shipments', { method: 'PATCH', json: { shipmentId: id, status } })
      toast.success(t('successTitle')); refetch()
    } catch (e) { toast.error((e as Error).message) }
  }

  const methodFa: Record<string, string> = { MOTORCYCLE: 'پیک موتوری', CAR: 'خودرو', POST: 'پست' }

  return (
    <div className="space-y-4">
      <h1 className="page-title"><Truck size={22} />{lang === 'fa' ? 'ارسال و تحویل' : 'Shipping & delivery'}</h1>
      {loading ? <LoadingRows /> : error ? <ErrorState message={error.supportRef} onRetry={refetch} /> : shipments.length === 0 ? <EmptyState /> : (
        <div className="space-y-2">
          {shipments.map((s) => (
            <Card key={s.id}>
              <CardContent className="p-4 flex items-center gap-3 flex-wrap text-sm">
                <span className="font-bold tabular-nums">{s.order.code}</span>
                <span>{methodFa[s.method] || s.method}</span>
                <Badge variant={s.status === 'DELIVERED' ? 'secondary' : s.status === 'SHIPPED' ? 'default' : 'outline'}>{s.status}</Badge>
                <span className="text-xs text-muted-foreground">{s.order.user.firstName} {s.order.user.lastName} · {s.order.user.phone}</span>
                {s.driverName && <span className="meta-inline"><User size={12} /> {s.driverName}</span>}
                {s.trackingCode && <span className="text-xs text-muted-foreground" dir="ltr">#: {s.trackingCode}</span>}
                <span className="tabular-nums text-xs text-muted-foreground"><Money amount={s.cost} /></span>
                <div className="ms-auto flex gap-2">
                  {s.status === 'SHIPPED' && <Button size="sm" className="btn-brand-hover gap-1" onClick={() => update(s.id, 'DELIVERED')}><Package size={13} />{lang === 'fa' ? 'تحویل شد' : 'Delivered'}</Button>}
                  {s.status === 'PREPARING' && <Button size="sm" onClick={() => update(s.id, 'SHIPPED')}><Truck size={13} />{lang === 'fa' ? 'ارسال شد' : 'Ship'}</Button>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

