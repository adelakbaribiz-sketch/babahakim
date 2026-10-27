'use client'
// Shop / Cart / Orders / Tickets / Followups / Notifications views
import React, { useCallback, useEffect, useState } from 'react'
import { useApp } from '@/contexts/app'
import { useApiQuery, useDebounced } from '@/hooks/use-api'
import { ApiError } from '@/lib/api-error'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { SectionCard, StatusBadge, JalaliDate, Money, LoadingRows, EmptyState, ErrorState } from '../../shared/atoms'
import { ticketFormSchema, zodFieldErrors } from '@/lib/forms'
import { TextField, TextAreaField } from '../../shared/form'
import { PaymentPanel, ShipmentCard } from './shopSupport'
import { fmtMoney } from '@/lib/i18n'
import { TICKET_STATUS_META } from '@/lib/constants'
import { ShoppingBag, ShoppingCart, Package, Ticket as TicketIcon, Bell, Plus, Minus, Trash2, CheckCircle2, Pill } from 'lucide-react'

// ── Shop ────────────────────────────────────────────────────────────────
export function ShopPage() {
  const { t, lang, api } = useApp()
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [otc, setOtc] = useState('')
  const [data, setData] = useState<{ products: { id: string; sku: string; nameFa: string; nameEn: string; brand: string; category: string; price: number; stock: number; requiresPrescription: boolean; usageFa?: string }[]; categories: string[] } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const debouncedQ = useDebounced(q) // PHASE 09 (F09): no request storm per keystroke

  useEffect(() => {
    const cat2 = cat === 'ALL' ? '' : cat
    const otc2 = otc === 'ALL' ? '' : otc
    const url = `/api/v1/products?q=${encodeURIComponent(debouncedQ)}${cat2 ? `&category=${encodeURIComponent(cat2)}` : ''}${otc2 ? `&otc=${otc2}` : ''}`
    api<{ products: { id: string; sku: string; nameFa: string; nameEn: string; brand: string; category: string; price: number; stock: number; requiresPrescription: boolean; usageFa?: string }[]; categories: string[] }>(url).then((d) => setData(d)).catch((e) => setLoadError((e as ApiError).supportRef))
  }, [api, debouncedQ, cat, otc])
  if (loadError) return <ErrorState message={loadError} onRetry={() => { setLoadError(null); setQ('') }} />

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="page-title"><ShoppingBag size={22} />{t('shop')}</h1>
        <div className="ms-auto flex gap-2 flex-wrap">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search')} className="w-52" aria-label={t('search')} />
          <Select value={cat} onValueChange={setCat}>
            <SelectTrigger className="w-36"><SelectValue placeholder={t('all')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t('all')}</SelectItem>
              {data?.categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={otc} onValueChange={setOtc}>
            <SelectTrigger className="w-32"><SelectValue placeholder={t('all')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t('all')}</SelectItem>
              <SelectItem value="true">{t('otc')}</SelectItem>
              <SelectItem value="false">{t('rx')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {!data ? <LoadingRows /> : data.products.length === 0 ? <EmptyState /> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {data.products.map((p) => <ProductCard key={p.id} p={p} />)}
        </div>
      )}
    </div>
  )
}

function ProductCard({ p }: { p: { id: string; sku: string; nameFa: string; nameEn: string; brand: string; category: string; price: number; stock: number; requiresPrescription: boolean; usageFa?: string } }) {
  const { t, lang, api } = useApp()
  const [busy, setBusy] = useState(false)
  async function add() {
    setBusy(true)
    try {
      await api('/api/v1/cart', { method: 'POST', json: { productId: p.id, quantity: 1 } })
      toast.success(`${lang === 'fa' ? p.nameFa : p.nameEn} → ${t('cart')} ✓`)
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <Card className="overflow-hidden hover:border-primary/40 transition-colors">
      <CardContent className="p-4 space-y-2.5">
        <div className="aspect-square rounded-lg bg-gradient-to-br from-brand-dark/10 to-brand-light/20 flex items-center justify-center select-none" aria-hidden><Pill className="size-10 text-primary" /></div>
        <div>
          <div className="font-bold text-sm leading-snug">{lang === 'fa' ? p.nameFa : p.nameEn}</div>
          <div className="text-xs text-muted-foreground">{p.brand} · {p.category}</div>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-bold tabular-nums text-primary">{fmtMoney(p.price, lang)}</span>
          {p.requiresPrescription ? <Badge variant="outline" className="text-status-warning border-status-warning/50 text-[10px]">{t('rx')}</Badge> : <Badge variant="secondary" className="text-[10px]">{t('otc')}</Badge>}
        </div>
        <div className="text-[11px] text-muted-foreground">{p.stock > 5 ? t('inStock') : p.stock > 0 ? t('lowStock') : '—'} · {lang === 'fa' ? 'موجودی' : 'stock'}: {p.stock}</div>
        {p.usageFa && <div className="text-[11px] text-muted-foreground leading-relaxed">{p.usageFa}</div>}
        <Button size="sm" className="w-full gap-1.5" disabled={busy || p.stock <= 0} onClick={add}><ShoppingCart size={14} />{t('addToCart')}</Button>
      </CardContent>
    </Card>
  )
}

// ── Cart ────────────────────────────────────────────────────────────────
// PHASE 09 (F15/ED-110): ALL money values (shipping, total) come from the
// server cart (domain computeTotals) — the client never computes prices.
export function CartPage() {
  const { t, lang, api, navigate } = useApp()
  const [data, setData] = useState<{ items: { id: string; productId: string; nameFa: string; nameEn: string; price: number; quantity: number; lineTotal: number; stock: number }[]; subtotal: number; shippingCost: number; total: number; count: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(() => { api('/api/v1/cart').then((d) => setData(d as NonNullable<typeof data>)).catch((e) => setLoadError((e as ApiError).supportRef)) }, [api])
  useEffect(load, [load])

  if (loadError) return <ErrorState message={loadError} onRetry={() => { setLoadError(null); load() }} />

  async function setQty(itemId: string, qty: number) {
    try { await api('/api/v1/cart', { method: 'PATCH', json: { itemId, quantity: qty } }); load() } catch (e) { toast.error((e as Error).message) }
  }

  async function checkout() {
    setBusy(true)
    try {
      const d = await api<{ order: { code: string } }>('/api/v1/orders', { method: 'POST', json: {} })
      toast.success(`${t('submit')} ✓ — ${d.order.code}`)
      navigate('orders')
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }

  if (!data) return <LoadingRows />
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="page-title"><ShoppingCart size={22} />{t('cart')}</h1>
      {data.items.length === 0 ? <EmptyState /> : (
        <>
          <div className="space-y-2">
            {data.items.map((i) => (
              <Card key={i.id}>
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{lang === 'fa' ? i.nameFa : i.nameEn}</div>
                    <div className="text-xs text-muted-foreground tabular-nums">{fmtMoney(i.price, lang)}</div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button variant="outline" size="icon" className="size-7" onClick={() => setQty(i.id, i.quantity - 1)}><Minus size={13} /></Button>
                    <span className="w-7 text-center text-sm tabular-nums">{i.quantity}</span>
                    <Button variant="outline" size="icon" className="size-7" onClick={() => setQty(i.id, i.quantity + 1)} disabled={i.quantity >= i.stock}><Plus size={13} /></Button>
                  </div>
                  <div className="w-24 text-end text-sm font-medium tabular-nums"><Money amount={i.lineTotal} /></div>
                  <Button variant="ghost" size="icon" className="text-destructive size-8" onClick={() => setQty(i.id, 0)}><Trash2 size={14} /></Button>
                </CardContent>
              </Card>
            ))}
          </div>
          <Card>
            <CardContent className="p-4 space-y-2">
              <div className="flex justify-between text-sm"><span>{t('subtotal')}</span><span className="tabular-nums"><Money amount={data.subtotal} /></span></div>
              <div className="flex justify-between text-sm text-muted-foreground"><span>{t('shippingCost')}</span><span className="tabular-nums"><Money amount={data.shippingCost} /></span></div>
              <div className="flex justify-between font-bold text-base pt-2 border-t"><span>{t('total')}</span><span className="tabular-nums"><Money amount={data.total} /></span></div>
              <Button className="w-full mt-2" disabled={busy} onClick={checkout}><Package size={16} />{t('checkout')}</Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

// ── Orders ──────────────────────────────────────────────────────────────
export function OrdersPage() {
  const { t, api } = useApp()
  // PHASE 09 (F05): loading init — no flash-of-empty before data arrives
  const { data, error, loading, refetch } = useApiQuery<{ orders: { id: string; code: string; status: string; type: string; total: number; createdAt: string; items: { nameFa: string; quantity: number; total: number }[]; shipment?: { id: string; method: string; status: string; driverName?: string; trackingCode?: string; shippingDate?: string; deliveryDate?: string; cost?: number } | null; payments: { id: string }[] }[] }>('/api/v1/orders')
  const orders = data?.orders || []
  const [expanded, setExpanded] = useState<string | null>(null)

  const refresh = refetch

  return (
    <div className="space-y-4">
      <h1 className="page-title"><Package size={22} />{t('orders')}</h1>
      {loading ? <LoadingRows /> : error ? <ErrorState message={error.supportRef} onRetry={refetch} /> : orders.length === 0 ? <EmptyState /> : (
        <div className="space-y-3">
          {orders.map((o) => (
            <Card key={o.id}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold tabular-nums">{o.code}</span>
                  <StatusBadge status={o.status} kind="order" />
                  <Badge variant="outline" className="text-[10px]">{o.type === 'PRESCRIPTION' ? 'نسخه' : 'فروشگاه'}</Badge>
                  <span className="ms-auto text-xs text-muted-foreground"><JalaliDate date={o.createdAt} /></span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{o.items.length} {t('details')}</span>
                  <span className="font-bold tabular-nums"><Money amount={o.total} /></span>
                </div>
                {['PENDING_CONFIRMATION', 'PAYMENT_PENDING', 'PENDING'].includes(o.status) && <PaymentPanel order={o as never} onDone={refresh} />}
                {o.shipment && <ShipmentCard shipment={o.shipment} />}
                {o.items.length > 0 && (
                  <Button variant="ghost" size="sm" className="text-xs w-full" onClick={() => setExpanded(expanded === o.id ? null : o.id)}>
                    {expanded === o.id ? '−' : '+'} {t('details')}
                  </Button>
                )}
                {expanded === o.id && (
                  <div className="space-y-1.5 rounded-lg border p-3 text-sm">
                    {o.items.map((it, i) => (
                      <div key={i} className="flex justify-between">
                        <span>{it.nameFa} ×{it.quantity}</span>
                        <span className="tabular-nums text-muted-foreground"><Money amount={it.total} /></span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Tickets ─────────────────────────────────────────────────────────────
export function TicketsPage() {
  const { t, lang, api, user } = useApp()
  const [open, setOpen] = useState(false)
  // priority belongs to the form state: ticketFormSchema requires it, and its
  // absence made safeParse fail silently (the create request was never sent)
  const emptyForm = { subject: '', category: 'GENERAL', priority: 'NORMAL', message: '' }
  const [form, setForm] = useState(emptyForm)
  const [replies, setReplies] = useState<Record<string, string>>({})
  const isStaff = !!user && user.role !== 'PATIENT'
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  // PHASE 09 (F05): loading → error → empty → content + zod-validated create (F13)
  const { data, error, loading, refetch } = useApiQuery<{ tickets: { id: string; code: string; subject: string; category: string; priority: string; status: string; createdAt: string; user?: { firstName: string; lastName: string }; messages: { id: string; message: string; isInternal: boolean; createdAt: string; sender: { firstName: string; lastName: string; role: string } }[] }[] }>('/api/v1/tickets')
  const tickets = data?.tickets || []

  const CATEGORY_LABEL: Record<string, string> = { GENERAL: t('catGeneral'), ORDER: t('catOrder'), PAYMENT: t('catPayment'), MEDICAL: t('catMedical'), SHIPPING: t('catShipping'), OTHER: t('catOther') }
  const PRIORITY_LABEL: Record<string, string> = { LOW: t('prLow'), NORMAL: t('prNormal'), HIGH: t('prHigh'), URGENT: t('prUrgent') }

  async function create() {
    setErrors({})
    const parsed = ticketFormSchema.safeParse(form)
    if (!parsed.success) {
      const fieldErrors = zodFieldErrors(parsed.error)
      setErrors(fieldErrors)
      // never fail silently: a field without an on-screen slot still reaches the user
      toast.error(Object.values(fieldErrors)[0] || t('errorTitle'))
      return
    }
    setBusy(true)
    try {
      await api('/api/v1/tickets', { method: 'POST', json: parsed.data })
      toast.success(t('successTitle')); setOpen(false); setForm(emptyForm); refetch()
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) setErrors(e.fields)
      toast.error(ApiError.message(e))
    } finally { setBusy(false) }
  }

  async function sendReply(id: string) {
    const reply = (replies[id] || '').trim()
    if (!reply) return
    setBusy(true)
    try {
      await api(`/api/v1/tickets/${id}`, { method: 'POST', json: { message: reply } })
      setReplies({ ...replies, [id]: '' }); refetch()
    } catch (e) { toast.error(ApiError.message(e)) } finally { setBusy(false) }
  }

  async function setStatus(id: string, status: string) {
    setBusy(true)
    try {
      await api(`/api/v1/tickets/${id}`, { method: 'PATCH', json: { status } })
      toast.success(t('successTitle')); refetch()
    } catch (e) { toast.error(ApiError.message(e)) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center gap-3">
        <h1 className="page-title"><TicketIcon size={22} />{t('tickets')}</h1>
        {user?.role === 'PATIENT' && <Button size="sm" className="ms-auto gap-1.5" onClick={() => setOpen(true)}>+ {t('newTicket')}</Button>}
      </div>

      {loading ? <LoadingRows /> : error ? <ErrorState message={error.supportRef} onRetry={refetch} /> : tickets.length === 0 ? <EmptyState /> : tickets.map((tk) => (
        <Card key={tk.id}>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold tabular-nums text-sm">{tk.code}</span>
              <span className="text-sm">{tk.subject}</span>
              <StatusBadge status={tk.status} kind="ticket" />
              <Badge variant="outline" className="text-[10px]">{PRIORITY_LABEL[tk.priority] || tk.priority}</Badge>
              <Badge variant="outline" className="text-[10px]">{CATEGORY_LABEL[tk.category] || tk.category}</Badge>
              {isStaff && tk.user && <span className="text-xs text-muted-foreground">{tk.user.firstName} {tk.user.lastName}</span>}
              <span className="ms-auto text-xs text-muted-foreground"><JalaliDate date={tk.createdAt} /></span>
            </div>
            {isStaff && (
              <div className="flex items-center gap-2">
                <Label className="text-xs" htmlFor={`ticket-status-${tk.id}`}>{lang === 'fa' ? 'تغییر وضعیت' : 'Set status'}</Label>
                <Select value="" onValueChange={(v) => setStatus(tk.id, v)} disabled={busy}>
                  <SelectTrigger id={`ticket-status-${tk.id}`} className="h-8 w-48 text-xs"><SelectValue placeholder={lang === 'fa' ? 'انتخاب…' : 'Choose…'} /></SelectTrigger>
                  <SelectContent>
                    {['IN_PROGRESS', 'WAITING_USER', 'WAITING_EXPERT', 'RESOLVED', 'CLOSED', 'REOPEN'].map((s) => (
                      <SelectItem key={s} value={s}>{s === 'REOPEN' ? (lang === 'fa' ? 'بازگشایی' : 'Reopen') : (TICKET_STATUS_META[s]?.[lang] || s)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              {tk.messages.filter((m) => user?.role === 'PATIENT' ? !m.isInternal : true).map((m) => (
                <div key={m.id} className={`rounded-lg p-2.5 text-sm leading-relaxed ${m.sender.role === 'PATIENT' ? 'bg-muted/60' : 'bg-primary/5 border border-primary/15'} ${m.isInternal ? 'opacity-60 border-dashed' : ''}`}>
                  <div className="text-[10px] text-muted-foreground mb-1">
                    {m.sender.firstName} {m.sender.lastName} {m.isInternal && '· داخلی'} · <JalaliDate date={m.createdAt} withTime />
                  </div>
                  {m.message}
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Input value={replies[tk.id] || ''} onChange={(e) => setReplies({ ...replies, [tk.id]: e.target.value })} placeholder={t('message')} onKeyDown={(e) => e.key === 'Enter' && sendReply(tk.id)} />
              <Button size="sm" disabled={busy || !(replies[tk.id] || '').trim()} onClick={() => sendReply(tk.id)} aria-label={t('submit')}><CheckCircle2 size={15} /></Button>
            </div>
          </CardContent>
        </Card>
      ))}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('newTicket')}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <TextField label={t('subject')} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} error={errors.subject} required />
            <div className="space-y-1.5">
              <Label htmlFor="ticket-category">{lang === 'fa' ? 'دسته' : 'Category'}</Label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger id="ticket-category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['GENERAL', 'ORDER', 'PAYMENT', 'MEDICAL', 'SHIPPING', 'OTHER'].map((c) => <SelectItem key={c} value={c}>{CATEGORY_LABEL[c]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ticket-priority">{lang === 'fa' ? 'فوریت' : 'Priority'}</Label>
              <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                <SelectTrigger id="ticket-priority"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((p) => <SelectItem key={p} value={p}>{PRIORITY_LABEL[p]}</SelectItem>)}
                </SelectContent>
              </Select>
              {errors.priority && <p className="text-xs text-destructive">{errors.priority}</p>}
            </div>
            <TextAreaField label={t('message')} rows={3} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} error={errors.message} required />
          </div>
          <DialogFooter><Button onClick={create} disabled={busy || !form.subject || !form.message}>{t('submit')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Follow-ups ──────────────────────────────────────────────────────────
export function FollowupsPage() {
  const { t } = useApp()
  const { data, error, loading, refetch } = useApiQuery<{ followups: { id: string; dueDate: string; status: string; note?: string; resultNote?: string; case: { code: string; status: string } }[] }>('/api/v1/followups')

  if (loading) return <LoadingRows />
  if (error) return <ErrorState message={error.supportRef} onRetry={refetch} />
  const followups = data?.followups || []
  return (
    <div className="space-y-4 max-w-3xl">
      <h1 className="text-2xl font-bold">{t('followups')}</h1>
      {followups.length === 0 ? <EmptyState /> : (
        <div className="space-y-2">
          {followups.map((f) => (
            <Card key={f.id}>
              <CardContent className="p-3.5 flex items-center gap-3 flex-wrap text-sm">
                <span className="tabular-nums text-muted-foreground">{f.case.code}</span>
                <Badge variant={f.status === 'COMPLETED' ? 'secondary' : f.status === 'OVERDUE' ? 'destructive' : 'outline'}>{f.status}</Badge>
                <span className="ms-auto"><JalaliDate date={f.dueDate} /></span>
                {f.note && <div className="w-full text-xs text-muted-foreground">{f.note}</div>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Notifications page ──────────────────────────────────────────────────
export function NotificationsPage() {
  const { t, lang, api, refreshNotifCount } = useApp()
  const { data, error, loading, refetch } = useApiQuery<{ notifications: { id: string; titleFa: string; titleEn: string; bodyFa?: string; bodyEn?: string; read: boolean; createdAt: string }[] }>('/api/v1/notifications')
  const items = data?.notifications || []
  const load = refetch

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center gap-3">
        <h1 className="page-title"><Bell size={22} />{t('notifications')}</h1>
        <Button variant="outline" size="sm" className="ms-auto" onClick={async () => { await api('/api/v1/notifications', { method: 'PATCH', json: {} }); load(); refreshNotifCount() }}>{t('markAllRead')}</Button>
      </div>
      {loading ? <LoadingRows /> : error ? <ErrorState message={error.supportRef} onRetry={refetch} /> : items.length === 0 ? <EmptyState /> : (
        <div className="space-y-2">
          {items.map((n) => (
            <Card key={n.id} className={n.read ? 'opacity-60' : ''}>
              <CardContent className="p-3.5">
                <div className="flex items-start gap-2">
                  {!n.read && <span className="size-2 rounded-full bg-brand-light mt-2 shrink-0" />}
                  <div className="min-w-0">
                    <div className="font-medium text-sm">{lang === 'fa' ? n.titleFa : n.titleEn}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{lang === 'fa' ? n.bodyFa : n.bodyEn}</div>
                    <div className="text-[10px] text-muted-foreground mt-1"><JalaliDate date={n.createdAt} withTime /></div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
