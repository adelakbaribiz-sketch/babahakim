'use client'
// Shared clinical components: Timeline, AIAnalysisCard, ImageGallery, PrescriptionCard, PrescriptionEditor, PaymentPanel
import React, { useState } from 'react'
import { useApp } from '@/contexts/app'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import { ConfidenceBar, StatusBadge, JalaliDate, Money, SectionCard } from './atoms'
import { Bot, ShieldAlert, Clock, Upload, CreditCard, CheckCircle2, XCircle, Info } from 'lucide-react'

// ── Timeline ────────────────────────────────────────────────────────────
export function Timeline({ items }: { items: { at: string | Date; desc: string; actor: string; actorRole: string; code: string }[] }) {
  return (
    <ol className="relative border-s border-border ms-3 space-y-6">
      {items.map((e, i) => (
        <li key={i} className="ps-5">
          <span className="absolute -start-[7px] mt-1.5 size-3.5 rounded-full bg-primary/20 border-2 border-primary" />
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Clock size={12} />
            <JalaliDate date={e.at} withTime />
            {e.actor && <Badge variant="outline" className="text-[10px] py-0">{e.actor}</Badge>}
          </div>
          <div className="text-sm mt-1 leading-relaxed">{e.desc}</div>
        </li>
      ))}
    </ol>
  )
}

// ── AI Analysis (with confidence, uncertainty, human-review notice) ─────
export function AIAnalysisCard({ analysis }: { analysis: {
  modelName: string; modelVersion: number; confidence: number; quality: number; processingMs?: number
  predictions: { labelFa: string; labelEn: string; value: string; confidence: number; noteFa: string; noteEn: string }[]
  explainability: { fa: string[]; en: string[] }; humanReviewed: boolean; createdAt: string
} }) {
  const { lang, t } = useApp()
  const [open, setOpen] = useState(false)
  return (
    <Card className="border-primary/25 bg-primary/[0.03]">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="size-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center"><Bot size={16} /></div>
          <CardTitle className="text-base">{t('aiAnalysis')} — {analysis.modelName} v{analysis.modelVersion}</CardTitle>
          <div className="ms-auto flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {t('confidence')}: <ConfidenceBar value={analysis.confidence} />
            </div>
            <Button variant="ghost" size="sm" onClick={() => setOpen(!open)} className="h-7 text-xs gap-1"><Info size={13} />{t('details')}</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-2.5">
          {analysis.predictions.map((p, i) => (
            <div key={i} className="rounded-lg border bg-card p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">{lang === 'fa' ? p.labelFa : p.labelEn}</span>
                <Badge variant={p.confidence >= 0.7 ? 'secondary' : 'outline'} className="text-[10px]">{p.confidence >= 0.7 ? '' : '؟'} {Math.round(p.confidence * 100)}%</Badge>
              </div>
              <div className="font-semibold text-sm">{p.value}</div>
              <div className="text-[11px] text-muted-foreground leading-relaxed">{lang === 'fa' ? p.noteFa : p.noteEn}</div>
            </div>
          ))}
        </div>
        {open && (
          <div className="space-y-2 text-xs text-muted-foreground rounded-lg border p-3 bg-card">
            {(lang === 'fa' ? analysis.explainability.fa : analysis.explainability.en).map((x, i) => (
              <div key={i} className="flex gap-2"><span className="text-primary">•</span><span dir={lang === 'fa' ? 'rtl' : 'ltr'}>{x}</span></div>
            ))}
            {analysis.processingMs != null && <div>⏱ {analysis.processingMs} ms</div>}
          </div>
        )}
        <Alert className="py-2.5 border-amber-300/50 bg-amber-50/60 dark:bg-amber-950/30">
          <ShieldAlert size={16} className="text-amber-600 shrink-0" />
          <AlertDescription className="text-xs leading-relaxed">
            {t('aiDisclaimer')}
            {analysis.humanReviewed && <> · <b className="text-emerald-600">{t('needsReview')} ✓</b></>}
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  )
}

// ── Image gallery (signed URLs, authorized) ────────────────────────────
export function ImageGallery({ images, onUploaded }: { images: { id: string; type: string; urls: { thumb: string; compressed: string; ai: string }; quality?: { score?: number; issues?: string[] } | null; createdAt: string; status: string }[]; onUploaded?: () => void }) {
  const { t } = useApp()
  const [sel, setSel] = useState<string | null>(null)
  const selImg = images.find((i) => i.id === sel)
  return (
    <div className="space-y-3">
      <div className="flex gap-3 flex-wrap">
        {images.map((img) => (
          <button key={img.id} onClick={() => setSel(img.id)} className="group relative rounded-lg overflow-hidden border-2 hover:border-primary/50 transition-colors">
            { }
            <img src={img.urls.thumb} alt="medical" className="size-24 object-cover" />
            {img.quality?.score != null && (
              <span className="absolute bottom-1 start-1 text-[9px] px-1 rounded bg-black/60 text-white tabular-nums">Q:{img.quality.score}</span>
            )}
          </button>
        ))}
        {images.length === 0 && <div className="text-sm text-muted-foreground">{t('empty')}</div>}
      </div>
      <Dialog open={!!sel} onOpenChange={(o) => !o && setSel(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('tongueImage')} — {selImg?.type}</DialogTitle>
          </DialogHeader>
          {selImg && (
            <div className="space-y-3">
              { }
              <img src={selImg.urls.compressed} alt="medical" className="w-full rounded-lg" />
              {selImg.quality?.issues && selImg.quality.issues.length > 0 && (
                <div className="text-xs text-amber-700 dark:text-amber-400 space-y-1">
                  {selImg.quality.issues.map((iss, i) => <div key={i}>• {iss}</div>)}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Prescription (read view) ────────────────────────────────────────────
export function PrescriptionCard({ prescription, role }: {
  prescription: {
    version: number; status: string; expert1Notes?: string; expert2Notes?: string; doctorComment?: string
    createdAt: string; approvedAt?: string
    createdBy: { firstName: string; lastName: string; role: string }
    items: { id: string; drugName: string; dosage?: string; frequency?: string; duration?: string; instructionsFa?: string; warnings?: string; available: boolean; missing: boolean; unitPrice?: number }[]
  }
  role: string
}) {
  const { t, lang } = useApp()
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <CardTitle className="text-base">{t('prescription')} — {t('version')} {prescription.version}</CardTitle>
          <Badge variant="outline" className={
            prescription.status === 'APPROVED' ? 'border-emerald-500 text-emerald-600' :
            prescription.status === 'REJECTED' ? 'border-rose-500 text-rose-600' :
            prescription.status === 'REVISION_REQUESTED' ? 'border-amber-500 text-amber-600' : ''
          }>{prescription.status}</Badge>
          <span className="ms-auto text-xs text-muted-foreground"><JalaliDate date={prescription.createdAt} /></span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2">
          {prescription.items.map((it) => (
            <div key={it.id} className={`rounded-lg border p-3 ${it.missing ? 'border-amber-400/60 bg-amber-50/50 dark:bg-amber-950/20' : ''}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm">{it.drugName}</span>
                <div className="flex gap-1.5">
                  {it.available ? <Badge className="bg-emerald-600 text-white text-[10px]">{t('available')}</Badge> : <Badge className="bg-amber-600 text-white text-[10px]">{t('missing')}</Badge>}
                  {it.unitPrice != null && it.unitPrice > 0 && role !== 'PATIENT' && <span className="text-xs tabular-nums"><Money amount={it.unitPrice} /></span>}
                </div>
              </div>
              <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-4 gap-y-1">
                {it.dosage && <span>{t('dosage')}: {it.dosage}</span>}
                {it.frequency && <span>{t('frequency')}: {it.frequency}</span>}
                {it.duration && <span>{t('duration')}: {it.duration}</span>}
              </div>
              {it.instructionsFa && <div className="text-xs mt-1.5 text-muted-foreground leading-relaxed">{t('instructions')}: {it.instructionsFa}</div>}
              {it.warnings && <div className="text-xs mt-1 text-rose-600">⚠ {it.warnings}</div>}
            </div>
          ))}
        </div>
        <Separator />
        <div className="grid sm:grid-cols-3 gap-3 text-xs space-y-2">
          {prescription.expert1Notes && <Note author="کارشناس اول" text={prescription.expert1Notes} />}
          {prescription.expert2Notes && <Note author="کارشناس دوم" text={prescription.expert2Notes} />}
          {prescription.doctorComment && <Note author={t('doctor')} text={prescription.doctorComment} />}
        </div>
        <div className="text-xs text-muted-foreground">{prescription.createdBy.firstName} {prescription.createdBy.lastName} · {lang === 'fa' ? 'ایجاد' : 'created'} <JalaliDate date={prescription.createdAt} /></div>
      </CardContent>
    </Card>
  )
}

function Note({ author, text }: { author: string; text: string }) {
  return (
    <div className="rounded-lg bg-muted/60 p-2.5">
      <div className="font-medium mb-1">{author}</div>
      <p className="text-muted-foreground leading-relaxed">{text}</p>
    </div>
  )
}

// ── Payment panel (patient) ─────────────────────────────────────────────
export function PaymentPanel({ order, onDone }: {
  order: { id: string; code: string; total: number; status: string; payments: { id: string; code: string; method: string; status: string; amount: number; refNumber?: string; trackingCode?: string; receiptImageId?: string }[]; invoice?: { code: string; total: number } | null }
  onDone: () => void
}) {
  const { t, api } = useApp()
  const [busy, setBusy] = useState(false)
  const [c2cOpen, setC2cOpen] = useState(false)
  const [gw, setGw] = useState<{ authority: string; amount: number; merchant: string; paymentId: string } | null>(null)
  const active = order.payments.find((p) => !['FAILED', 'REJECTED', 'REFUNDED'].includes(p.status))

  async function startPayment(method: 'ZARINPAL' | 'CARD_TO_CARD') {
    setBusy(true)
    try {
      const d = await api<{ payment: { id: string; code: string; amount: number; authority?: string }; gatewayUrl?: string; mockGateway?: { authority: string; amount: number; merchant: string } }>('/api/v1/payments', { method: 'POST', json: { orderId: order.id, method } })
      if (method === 'ZARINPAL' && d.mockGateway) {
        setGw({ authority: d.mockGateway.authority, amount: d.mockGateway.amount, merchant: d.mockGateway.merchant, paymentId: d.payment.id })
      } else {
        setC2cOpen(true)
        toast.success('پرداخت کارت‌به‌کارت ثبت شد؛ رسید را ارسال کنید')
        onDone()
      }
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }

  async function gatewayPay(success: boolean) {
    if (!gw) return
    setBusy(true)
    try {
      const d = await api<{ refNumber?: number; failed?: boolean; alreadyPaid?: boolean }>(`/api/v1/payments/zarinpal/callback?authority=${gw.authority}&status=${success ? 'OK' : 'NOK'}`)
      if (d.failed) toast.error('پرداخت ناموفق / لغو شد')
      else toast.success(`${t('paymentSuccess')} — ${t('refNumber')}: ${d.refNumber}`)
      setGw(null)
      onDone()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-base">{t('payments')}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {active ? (
          <div className="rounded-lg border p-3 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="tabular-nums">{active.code}</span>
              <StatusBadge status={active.status} kind="payment" />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span><Money amount={active.amount} /></span>
              <span>{active.method === 'ZARINPAL' ? 'زرین‌پال' : 'کارت‌به‌کارت'}</span>
            </div>
            {active.refNumber && <div className="text-xs">{t('refNumber')}: <span dir="ltr" className="tabular-nums">{active.refNumber}</span></div>}
            {active.trackingCode && <div className="text-xs">{t('trackingCode')}: <span dir="ltr" className="tabular-nums">{active.trackingCode}</span></div>}
            {active.status === 'AWAITING_VERIFY' && (
              <Badge variant="outline" className="text-amber-600 border-amber-500">در انتظار تأیید اپراتور</Badge>
            )}
          </div>
        ) : null}

        {['PAYMENT_PENDING', 'WAITING_FOR_PAYMENT', 'PENDING_CONFIRMATION'].includes(order.status) && !active?.refNumber && (
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={() => startPayment('ZARINPAL')} disabled={busy} className="gap-1.5"><CreditCard size={16} />{t('payNow')}</Button>
            <Button onClick={() => startPayment('CARD_TO_CARD')} disabled={busy} variant="outline" className="gap-1.5"><Upload size={16} />{t('cardToCard')}</Button>
          </div>
        )}

        {/* Zarinpal gateway simulation */}
        <Dialog open={!!gw} onOpenChange={(o) => !o && setGw(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><CreditCard size={18} className="text-amber-500" />{t('paymentGateway')}</DialogTitle>
              <DialogDescription>Zarinpal · {gw?.merchant}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 text-center">
              <div className="rounded-xl bg-amber-500/10 p-4">
                <div className="text-xs text-muted-foreground">{t('amount')}</div>
                <div className="text-2xl font-black tabular-nums"><Money amount={gw?.amount || 0} /></div>
                <div className="text-[10px] text-muted-foreground mt-1" dir="ltr">Authority: {gw?.authority?.slice(0, 20)}…</div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button className="bg-emerald-600 hover:bg-emerald-700 gap-1" onClick={() => gatewayPay(true)} disabled={busy}><CheckCircle2 size={16} />{t('confirm')}</Button>
                <Button variant="outline" className="gap-1 text-rose-600" onClick={() => gatewayPay(false)} disabled={busy}><XCircle size={16} />{t('cancel')}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Card-to-card receipt upload */}
        <CardToCardReceipt orderId={order.id} open={c2cOpen} onOpenChange={setC2cOpen} onDone={onDone} />
      </CardContent>
    </Card>
  )
}

function CardToCardReceipt({ orderId, open, onOpenChange, onDone }: { orderId: string; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const { t, api } = useApp()
  const [busy, setBusy] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [tracking, setTracking] = useState('')

  async function submit() {
    setBusy(true)
    try {
      let imageId: string | null = null
      if (file) {
        const fd = new FormData()
        fd.append('file', file)
        fd.append('type', 'RECEIPT')
        const d = await api<{ image: { id: string } }>('/api/v1/images/upload', { method: 'POST', body: fd })
        imageId = d.image.id
      }
      const pays = await api<{ payments: { id: string; orderId: string; status: string }[] }>('/api/v1/payments')
      const pay = pays.payments.find((p) => p.orderId === orderId && p.status === 'AWAITING_VERIFY')
      if (!pay) throw new Error('پرداخت کارت‌به‌کارت یافت نشد')
      await api(`/api/v1/payments/${pay.id}/receipt`, { method: 'POST', json: { trackingCode: tracking, imageId } })
      toast.success('رسید پرداخت ارسال شد')
      onOpenChange(false)
      setFile(null); setTracking('')
      onDone()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{t('receipt')} — کارت‌به‌کارت</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>{t('trackingCode')}</Label>
            <Input value={tracking} onChange={(e) => setTracking(e.target.value)} dir="ltr" placeholder="1234…" />
          </div>
          <div className="space-y-1.5">
            <Label>{t('receipt')} (JPG/PNG)</Label>
            <Input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </div>
          <Button onClick={submit} disabled={busy || !tracking} className="w-full gap-1.5"><Upload size={16} />{t('uploadReceipt')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
