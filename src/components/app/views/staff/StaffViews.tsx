'use client'
// Staff views: Dashboard (role-aware), Case queue, Operator payments & shipments
import React, { useCallback, useEffect, useState } from 'react'
import { useApp } from '@/contexts/app'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { SectionCard, StatusBadge, StatCard, JalaliDate, LoadingRows, EmptyState, Money } from '../../shared/atoms'
import { CaseWorkspace } from '../CaseWorkspace'
import { fmtMoney } from '@/lib/i18n'
import { STATUS_META, ROLE_LABELS } from '@/lib/constants'
import { LayoutDashboard, Users, FolderOpen, ListChecks, CreditCard, Truck, Bell, CheckCircle2, XCircle, Hourglass, ScanHeart, ClipboardCheck, Stethoscope, Package, BarChart3 } from 'lucide-react'

// ── Staff dashboard ─────────────────────────────────────────────────────
export function StaffDashboard({ navigate }: { navigate: (p: string, params?: Record<string, string>) => void }) {
  const { t, lang, api, user } = useApp()
  const [data, setdata] = useState<{
    stats: Record<string, number>
    queue: { id: string; code: string; status: string; priority: string; createdAt: string; waitingHours: number; patient: { firstName: string; lastName: string; phone: string }; mizajSnapshot?: { mizajFa?: string } | null }[]
    recentEvents: { id: string; action: string; fromStatus?: string; toStatus?: string; comment?: string; createdAt: string; case?: { code: string }; actor?: { firstName: string; lastName: string; role: string } | null }[]
  } | null>(null)

  useEffect(() => { api('/api/v1/dashboard').then(setdata).catch(() => {}) }, [api])
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
        {role === 'EXPERT_1' && <StatCard title={lang === 'fa' ? 'در صف شما' : 'In your queue'} value={s.pendingExpert1} icon={<ListChecks size={18} />} tone="bg-amber-500/10 text-amber-600" />}
        {role === 'EXPERT_2' && <StatCard title={lang === 'fa' ? 'در انتظار بازبینی' : 'Awaiting review'} value={s.pendingExpert2} icon={<ListChecks size={18} />} tone="bg-teal-500/10 text-teal-600" />}
        {role === 'DOCTOR' && <StatCard title={lang === 'fa' ? 'در انتظار تأیید' : 'Awaiting approval'} value={s.pendingDoctor} icon={<Stethoscope size={18} />} tone="bg-cyan-500/10 text-cyan-600" />}
        {(role === 'OPERATOR' || role === 'ADMIN') && <>
          <StatCard title={lang === 'fa' ? 'در انتظار پرداخت' : 'Awaiting payment'} value={s.awaitingPayment} icon={<CreditCard size={18} />} tone="bg-rose-500/10 text-rose-600" />
          <StatCard title={lang === 'fa' ? 'پیش‌فاکتور' : 'Proformas'} value={s.proformas} icon={<Hourglass size={18} />} />
          <StatCard title={lang === 'fa' ? 'در ارسال' : 'Shipping'} value={s.shipped} icon={<Truck size={18} />} />
        </>}
        <StatCard title={lang === 'fa' ? 'بیماران' : 'Patients'} value={s.totalPatients} icon={<Users size={18} />} />
        <StatCard title={lang === 'fa' ? 'تیکت‌های باز' : 'Open tickets'} value={s.openTickets} icon={<Bell size={18} />} tone="bg-amber-500/10 text-amber-600" />
        <StatCard title={lang === 'fa' ? 'پیگیری فعال' : 'Follow-ups'} value={s.followups} icon={<ScanHeart size={18} />} />
        {(role === 'ADMIN' || role === 'OPERATOR' || role === 'EXPERT_2') && <StatCard title={t('revenue')} value={fmtMoney(s.revenue || 0, lang)} icon={<BarChart3 size={18} />} tone="bg-emerald-500/10 text-emerald-600" />}
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
                    <span className="ms-auto text-xs text-amber-600 flex items-center gap-1" dir={lang === 'fa' ? 'rtl' : 'ltr'}>
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
                <div className="flex items-center gap-2">
                  {e.case && <span className="tabular-nums text-muted-foreground">{e.case.code}</span>}
                  {e.toStatus && <Badge className={`${(STATUS_META as Record<string, { color: string }>)[e.toStatus]?.color || 'bg-slate-500'} text-white text-[9px]`}>
                    {(STATUS_META as Record<string, { fa: string }>)[e.toStatus]?.fa || e.toStatus}
                  </Badge>}
                </div>
                <div className="text-muted-foreground">{e.actor ? `${e.actor.firstName} ${e.actor.lastName} · ` : ''}{e.comment || e.action}</div>
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
  const [cases, setCases] = useState<{ id: string; code: string; status: string; priority: string; createdAt: string; waitingHours: number; patient: { firstName: string; lastName: string; phone: string }; mizajSnapshot?: { mizajFa?: string } | null; images: { id: string; type: string }[] }[]>([])
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    queueMicrotask(() => setLoading(true))
    api<{ cases: typeof cases }>(`/api/v1/cases${status && status !== 'ALL' ? `?status=${status}` : ''}${q ? `${status ? '&' : '?'}q=${encodeURIComponent(q)}` : ''}`)
      .then((d) => setCases(d.cases)).catch(() => {}).finally(() => setLoading(false))
  }, [api, status, q])
  useEffect(load, [load])

  const statusOptions = user?.role === 'EXPERT_1' ? ['WAITING_FOR_EXPERT_1', 'EXPERT_1_REVIEW', 'WAITING_FOR_USER_APPROVAL', 'WAITING_FOR_EXPERT_1_PRESCRIPTION', 'REVISION_REQUESTED']
    : user?.role === 'EXPERT_2' ? ['WAITING_FOR_EXPERT_2', 'REVISION_REQUESTED', 'WAITING_FOR_PAYMENT', 'PAYMENT_CONFIRMED', 'PREPARING_SHIPMENT', 'SHIPPED']
    : user?.role === 'DOCTOR' ? ['WAITING_FOR_DOCTOR']
    : undefined

  const claimable = user?.role === 'EXPERT_1' && !status

  async function claim(id: string) {
    try {
      await api(`/api/v1/cases/${id}/action`, { method: 'POST', json: { action: 'CLAIM' } })
      toast.success('پرونده دریافت شد ✓')
      navigate('caseDetail', { id })
    } catch (e) { toast.error((e as Error).message) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-2xl font-bold flex items-center gap-2"><ListChecks size={22} />{t('queue')}</h1>
        <div className="ms-auto flex gap-2 flex-wrap">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search')} className="w-52" />
          {statusOptions && (
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-56"><SelectValue placeholder={t('all')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t('all')}</SelectItem>
                {statusOptions.map((s) => (
                  <SelectItem key={s} value={s}>{(STATUS_META as Record<string, { fa: string }>)[s]?.fa || s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {loading ? <LoadingRows /> : cases.length === 0 ? <EmptyState /> : (
        <div className="space-y-2">
          {cases.map((c) => (
            <Card key={c.id} className="hover:border-primary/40 transition-colors">
              <CardContent className="p-4 flex items-center gap-3 flex-wrap">
                <button onClick={() => navigate('caseDetail', { id: c.id })} className="flex items-center gap-3 flex-wrap text-start">
                  <span className="font-bold tabular-nums text-sm">{c.code}</span>
                  <StatusBadge status={c.status} />
                  {c.priority !== 'NORMAL' && <Badge variant="destructive" className="text-[10px]">{c.priority}</Badge>}
                  <span className="text-xs text-muted-foreground">{c.patient.firstName} {c.patient.lastName} · {c.patient.phone}</span>
                  {c.mizajSnapshot?.mizajFa && <Badge variant="outline" className="text-[10px]">{c.mizajSnapshot.mizajFa}</Badge>}
                </button>
                <div className="ms-auto flex items-center gap-2">
                  <span className="text-xs text-amber-600 flex items-center gap-1 tabular-nums"><Hourglass size={12} />{c.waitingHours}{t('hours')}</span>
                  {claimable && c.status === 'WAITING_FOR_EXPERT_1' && (
                    <Button size="sm" className="gap-1" onClick={() => claim(c.id)}><ClipboardCheck size={14} />{lang === 'fa' ? 'دریافت' : 'Claim'}</Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => navigate('caseDetail', { id: c.id })}>{t('details')}</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Operator: payments verify ───────────────────────────────────────────
export function PaymentsVerifyPage() {
  const { t, lang, api } = useApp()
  interface Pay { id: string; code: string; method: string; status: string; amount: number; refNumber?: string; trackingCode?: string; receiptNote?: string; receiptUrl?: string | null; createdAt: string; verifiedBy?: { firstName: string; lastName: string } | null; order: { code: string; user: { firstName: string; lastName: string; phone: string } } }
  const [pays, setPays] = useState<Pay[]>([])
  const [status, setStatus] = useState('AWAITING_VERIFY')
  const [reload, setReload] = useState(0)
  const [sel, setSel] = useState<Pay | null>(null)

  useEffect(() => {
    api<{ payments: Pay[] }>(`/api/v1/payments${status ? `?status=${status}` : ''}`).then((d) => setPays(d.payments)).catch(() => {})
  }, [api, status, reload])

  async function verify(id: string, decision: string, note?: string) {
    try {
      await api(`/api/v1/payments/${id}/verify`, { method: 'POST', json: { decision, note } })
      toast.success('✓'); setReload((x) => x + 1); setSel(null)
    } catch (e) { toast.error((e as Error).message) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-2xl font-bold flex items-center gap-2"><CreditCard size={22} />{t('payments')}</h1>
        <Select value={status || 'ALL'} onValueChange={(v) => setStatus(v === 'ALL' ? '' : v)}>
          <SelectTrigger className="w-64 ms-auto"><SelectValue /></SelectTrigger>
          <SelectContent>
            {['ALL', 'AWAITING_VERIFY', 'PENDING', 'PAID', 'FAILED', 'REJECTED', 'REFUNDED'].map((s) => (
              <SelectItem key={s} value={s}>{s === 'ALL' ? t('all') : s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {pays.length === 0 ? <EmptyState /> : (
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
                    <Button size="sm" className="gap-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => verify(p.id, 'APPROVE')}><CheckCircle2 size={14} /></Button>
                    <Button size="sm" variant="outline" className="text-rose-600 gap-1" onClick={() => verify(p.id, 'REJECT', 'رسید نامعتبر')}><XCircle size={14} /></Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {sel && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setSel(null)}>
          <div className="bg-background rounded-xl p-4 max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 font-bold text-sm flex items-center justify-between">
              {t('receipt')} — {sel.code}
              <Button variant="ghost" size="sm" onClick={() => setSel(null)}>×</Button>
            </div>
            { }
            {sel.receiptUrl && <img src={sel.receiptUrl} alt="receipt" className="w-full rounded-lg" />}
            {!sel.receiptUrl && <div className="text-sm text-muted-foreground">رسید تصویری ارسال نشده — شماره پیگیری: {sel.trackingCode || '—'}</div>}
            <div className="flex gap-2 mt-3">
              <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700 gap-1" onClick={() => verify(sel.id, 'APPROVE')}><CheckCircle2 size={14} />{t('confirm')}</Button>
              <Button variant="outline" className="flex-1 text-rose-600 gap-1" onClick={() => verify(sel.id, 'REJECT', 'رسید نامعتبر')}><XCircle size={14} />{t('reject')}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Operator: shipments ─────────────────────────────────────────────────
export function ShipmentsPage() {
  const { t, lang, api } = useApp()
  const [shipments, setShipments] = useState<{ id: string; method: string; status: string; driverName?: string; driverPhone?: string; trackingCode?: string; cost: number; shippingDate?: string; deliveryDate?: string; order: { code: string; status: string; user: { firstName: string; lastName: string; phone: string } } }[]>([])
  const [reload, setReload] = useState(0)

  useEffect(() => {
    api<{ shipments: typeof shipments }>('/api/v1/shipments').then((d) => setShipments(d.shipments)).catch(() => {})
  }, [api, reload])

  async function update(id: string, status: string) {
    try {
      await api('/api/v1/shipments', { method: 'PATCH', json: { shipmentId: id, status } })
      toast.success('✓'); setReload((x) => x + 1)
    } catch (e) { toast.error((e as Error).message) }
  }

  const methodFa: Record<string, string> = { MOTORCYCLE: 'پیک موتوری', CAR: 'خودرو', POST: 'پست' }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold flex items-center gap-2"><Truck size={22} />{lang === 'fa' ? 'ارسال و تحویل' : 'Shipping & delivery'}</h1>
      {shipments.length === 0 ? <EmptyState /> : (
        <div className="space-y-2">
          {shipments.map((s) => (
            <Card key={s.id}>
              <CardContent className="p-4 flex items-center gap-3 flex-wrap text-sm">
                <span className="font-bold tabular-nums">{s.order.code}</span>
                <span>{methodFa[s.method] || s.method}</span>
                <Badge variant={s.status === 'DELIVERED' ? 'secondary' : s.status === 'SHIPPED' ? 'default' : 'outline'}>{s.status}</Badge>
                <span className="text-xs text-muted-foreground">{s.order.user.firstName} {s.order.user.lastName} · {s.order.user.phone}</span>
                {s.driverName && <span className="text-xs text-muted-foreground">👤 {s.driverName}</span>}
                {s.trackingCode && <span className="text-xs text-muted-foreground" dir="ltr">#: {s.trackingCode}</span>}
                <span className="tabular-nums text-xs text-muted-foreground"><Money amount={s.cost} /></span>
                <div className="ms-auto flex gap-2">
                  {s.status === 'SHIPPED' && <Button size="sm" className="gap-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => update(s.id, 'DELIVERED')}><Package size={13} />{lang === 'fa' ? 'تحویل شد' : 'Delivered'}</Button>}
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

export { CaseWorkspace }
