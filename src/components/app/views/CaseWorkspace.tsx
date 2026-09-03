'use client'
// CaseWorkspace: single role-aware view for the entire clinical workflow
// Patient: timeline, AI, assessment approval, prescription, proforma, payment, shipping
// Expert1: claim, assessment, prescription editor | Expert2: review+pricing+doctor+proforma
// Doctor: approve/reject/revision | Operator: payment verify, shipping, delivery, follow-up
import React, { useCallback, useEffect, useState } from 'react'
import { useApp } from '@/contexts/app'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { SectionCard, StatusBadge, JalaliDate, Money, LoadingRows, EmptyState } from '../shared/atoms'
import { AIAnalysisCard, ImageGallery, PrescriptionCard, PaymentPanel, Timeline } from '../shared/clinical'
import { STATUS_META } from '@/lib/constants'
import { ArrowLeft, CheckCircle2, XCircle, ClipboardCheck, Pill, FileText, Truck, PackageCheck, CalendarClock, Stethoscope, User } from 'lucide-react'

interface CaseData {
  id: string; code: string; status: string; priority: string; description?: string
  createdAt: string; followUpAt?: string; followUpDays?: number; expert1Summary?: string
  patient: { id: string; firstName: string; lastName: string; phone: string; email?: string; gender?: string; birthDate?: string }
  expert1?: { firstName: string; lastName: string } | null
  expert2?: { firstName: string; lastName: string } | null
  doctor?: { firstName: string; lastName: string } | null
  mizajSnapshot?: { mizajFa: string; mizajEn: string; scores?: Record<string, number> } | null
  patientProfile?: { province?: string; city?: string; allergies?: string; heightCm?: number; weightKg?: number } | null
  images: { id: string; type: string; status: string; quality?: { score?: number; issues?: string[] } | null; urls: { thumb: string; compressed: string; ai: string }; createdAt: string }[]
  aiAnalyses: Parameters<typeof AIAnalysisCard>[0]['analysis'][]
  diagnoses: { id: string; title: string; notes?: string; createdAt: string; expert: { firstName: string; lastName: string }; disease?: { nameFa: string; nameEn: string } | null; confidence?: number }[]
  prescriptions: Parameters<typeof PrescriptionCard>[0]['prescription'][]
  orders: { id: string; code: string; status: string; total: number; type: string; payments: { id: string; code: string; method: string; status: string; amount: number; refNumber?: string; trackingCode?: string; receiptImageId?: string }[]; invoice?: { code: string; total: number; status: string } | null; shipment?: { id: string; method: string; status: string; driverName?: string; driverPhone?: string; trackingCode?: string; shippingDate?: string; deliveryDate?: string; cost?: number } | null; items: { nameFa: string; quantity: number; total: number }[] }[]
  timeline: { at: string; desc: string; actor: string; actorRole: string; code: string }[]
  followUps: { id: string; dueDate: string; status: string; note?: string }[]
}

export function CaseWorkspace({ caseId, onChanged }: { caseId: string; onChanged?: () => void }) {
  const { t, lang, api, user } = useApp()
  const [data, setData] = useState<CaseData | null>(null)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    try {
      const d = await api<{ case: CaseData }>(`/api/v1/cases/${caseId}`)
      setData(d.case)
    } catch (e) { setErr((e as Error).message) }
  }, [api, caseId])

  useEffect(() => { load() }, [load])

  const refresh = () => { load(); onChanged?.() }

  async function action(actionName: string, payload?: Record<string, unknown>) {
    try {
      const res = await api(`/api/v1/cases/${caseId}/action`, { method: 'POST', json: { action: actionName, ...payload } })
      if (res && (res as { error?: string }).error) throw new Error((res as { error: string }).error)
      toast.success('✓')
      refresh()
      return true
    } catch (e) {
      toast.error((e as Error).message)
      return false
    }
  }

  if (err) return <Alert variant="destructive"><AlertDescription>{err}</AlertDescription></Alert>
  if (!data) return <LoadingRows rows={6} />

  const role = user?.role || 'PATIENT'
  const latestRx = data.prescriptions[0]
  const rxOrder = data.orders.find((o) => o.type === 'PRESCRIPTION')

  return (
    <div className="space-y-5">
      {/* header */}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => window.history.length > 1 ? window.history.back() : onChanged?.()} className="gap-1"><ArrowLeft size={15} />{t('back')}</Button>
        <h1 className="text-xl font-bold">{t('caseCode')} {data.code}</h1>
        <StatusBadge status={data.status} />
        <Badge variant="outline">{t('priority')}: {data.priority}</Badge>
        <span className="ms-auto text-xs text-muted-foreground flex items-center gap-1"><User size={12} />{data.patient.firstName} {data.patient.lastName}</span>
      </div>

      {/* progress bar */}
      <ProgressTrack status={data.status} />

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="space-y-5 lg:col-span-2">
          {/* patient complaint + mizaj */}
          <SectionCard title={lang === 'fa' ? 'شرح حال و مزاج' : 'History & temperament'}>
            <div className="space-y-3">
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{data.description || '—'}</p>
              <Separator />
              <div className="flex flex-wrap gap-2 text-xs">
                {data.mizajSnapshot && <Badge className="bg-teal-600 text-white">{t('mizaj')}: {lang === 'fa' ? data.mizajSnapshot.mizajFa : data.mizajSnapshot.mizajEn}</Badge>}
                {data.patientProfile?.heightCm && <Badge variant="outline">{data.patientProfile.heightCm} cm</Badge>}
                {data.patientProfile?.weightKg && <Badge variant="outline">{data.patientProfile.weightKg} kg</Badge>}
                {data.patientProfile?.province && <Badge variant="outline">{data.patientProfile.province}{data.patientProfile.city ? ` / ${data.patientProfile.city}` : ''}</Badge>}
                {data.patientProfile?.allergies && <Badge variant="outline" className="text-rose-600">حساسیت: {data.patientProfile.allergies}</Badge>}
              </div>
            </div>
          </SectionCard>

          {/* images */}
          <SectionCard title={t('tongueImage')}>
            <ImageGallery images={data.images.filter((i) => i.type === 'TONGUE' || i.type === 'FACE')} />
          </SectionCard>

          {/* AI */}
          {data.aiAnalyses[0] && <AIAnalysisCard analysis={data.aiAnalyses[0]} />}

          {/* expert 1 assessment */}
          {(data.status !== 'WAITING_FOR_EXPERT_1' && data.status !== 'EXPERT_1_REVIEW') && data.expert1Summary && (
            <SectionCard title={t('assessment')}>
              <div className="space-y-2">
                <div className="text-sm leading-relaxed whitespace-pre-wrap">{data.expert1Summary}</div>
                {data.expert1 && <div className="text-xs text-muted-foreground">{data.expert1.firstName} {data.expert1.lastName}</div>}
              </div>
            </SectionCard>
          )}

          {/* Expert1: claim + submit assessment */}
          {role === 'EXPERT_1' && data.status === 'WAITING_FOR_EXPERT_1' && (
            <Card className="border-primary/30">
              <CardHeader className="pb-2"><CardTitle className="text-base">{lang === 'fa' ? 'دریافت پرونده' : 'Claim case'}</CardTitle></CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-3">{lang === 'fa' ? 'این پرونده در صف انتظار است؛ با دریافت، جهت ارزیابی اولیه به شما تخصیص می‌یابد.' : 'This case is waiting in queue; claim it to begin the initial assessment.'}</p>
                <Button onClick={() => action('CLAIM')} className="gap-1.5"><ClipboardCheck size={16} />{lang === 'fa' ? 'دریافت و شروع بررسی' : 'Claim & review'}</Button>
              </CardContent>
            </Card>
          )}
          {role === 'EXPERT_1' && data.status === 'EXPERT_1_REVIEW' && (
            <AssessmentEditor onSubmit={async (summary) => action('SUBMIT_ASSESSMENT', { summary })} />
          )}

          {/* Patient approval */}
          {role === 'PATIENT' && data.status === 'WAITING_FOR_USER_APPROVAL' && (
            <Card className="border-amber-400/50">
              <CardHeader className="pb-2"><CardTitle className="text-base">{t('assessment')} — {t('confirm')}</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="text-sm leading-relaxed whitespace-pre-wrap">{data.expert1Summary}</div>
                <div className="grid grid-cols-2 gap-2">
                  <Button className="bg-emerald-600 hover:bg-emerald-700 gap-1.5" onClick={() => action('USER_APPROVE')}><CheckCircle2 size={16} />{t('continueTreatment')}</Button>
                  <Button variant="outline" className="text-rose-600 gap-1.5" onClick={() => action('USER_DECLINE', { reason: 'عدم تمایل به ادامه' })}><XCircle size={16} />{t('declineTreatment')}</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Expert1: prescription editor */}
          {role === 'EXPERT_1' && ['WAITING_FOR_EXPERT_1_PRESCRIPTION', 'REVISION_REQUESTED'].includes(data.status) && (
            <PrescriptionEditor onSubmit={async (items, notes) => action('SUBMIT_PRESCRIPTION', { items, notes })} />
          )}

          {/* prescription display */}
          {latestRx && <PrescriptionCard prescription={latestRx} role={role} />}

          {/* Expert2 review editor */}
          {role === 'EXPERT_2' && data.status === 'WAITING_FOR_EXPERT_2' && latestRx && (
            <Expert2Review prescription={latestRx} onSubmit={async (items, notes) => action('EXPERT2_REVIEW', { items, notes })} />
          )}

          {/* Doctor decision */}
          {role === 'DOCTOR' && data.status === 'WAITING_FOR_DOCTOR' && (
            <DoctorDecision onSubmit={async (decision, comment, followUpDays) => {
              if (decision === 'APPROVE') return action('DOCTOR_APPROVE', { comment, followUpDays })
              if (decision === 'REJECT') return action('DOCTOR_REJECT', { comment })
              return action('DOCTOR_REVISION', { comment })
            }} />
          )}

          {/* proforma + payment + shipment for prescription order */}
          {rxOrder && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <FileText size={16} className="text-primary" />
                  <CardTitle className="text-base">{t('proforma')} — {rxOrder.invoice?.code || rxOrder.code}</CardTitle>
                  <StatusBadge status={rxOrder.status} kind="order" />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  {rxOrder.items.map((it, i) => (
                    <div key={i} className="flex justify-between text-sm">
                      <span>{it.nameFa} ×{it.quantity}</span>
                      <span className="tabular-nums"><Money amount={it.total} /></span>
                    </div>
                  ))}
                </div>
                <Separator />
                <div className="flex justify-between font-bold"><span>{t('total')}</span><span><Money amount={rxOrder.total} /></span></div>

                {/* patient: confirm proforma */}
                {role === 'PATIENT' && data.status === 'PROFORMA_CREATED' && (
                  <div className="grid grid-cols-2 gap-2">
                    <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => action('CONFIRM_PROFORMA')}>{t('confirmProforma')}</Button>
                    <Button variant="outline" className="text-rose-600" onClick={() => action('REJECT_PROFORMA')}>{t('rejectProforma')}</Button>
                  </div>
                )}

                {/* payment */}
                <PaymentPanel order={rxOrder} onDone={refresh} />

                {/* shipment info */}
                {rxOrder.shipment && <ShipmentInfo shipment={rxOrder.shipment} />}
              </CardContent>
            </Card>
          )}
        </div>

        {/* sidebar */}
        <div className="space-y-5">
          {/* staff meta */}
          <SectionCard title={lang === 'fa' ? ' تیم درمان' : 'Care team'}>
            <div className="space-y-2 text-sm">
              <TeamRow icon={<ClipboardCheck size={14} />} label={t('expert')} name={data.expert1 ? `${data.expert1.firstName} ${data.expert1.lastName}` : '—'} />
              <TeamRow icon={<Pill size={14} />} label={`${t('expert')} ۲`} name={data.expert2 ? `${data.expert2.firstName} ${data.expert2.lastName}` : '—'} />
              <TeamRow icon={<Stethoscope size={14} />} label={t('doctor')} name={data.doctor ? `${data.doctor.firstName} ${data.doctor.lastName}` : '—'} />
            </div>
          </SectionCard>

          {/* follow-up */}
          {(role !== 'PATIENT' || data.followUpAt) && (
            <SectionCard title={t('followups')}>
              <div className="space-y-2 text-sm">
                {data.followUpAt && <div className="flex items-center gap-2"><CalendarClock size={14} className="text-primary" /><JalaliDate date={data.followUpAt} /></div>}
                {data.followUps.map((f) => (
                  <div key={f.id} className="flex items-center justify-between text-xs">
                    <JalaliDate date={f.dueDate} />
                    <Badge variant={f.status === 'COMPLETED' ? 'secondary' : f.status === 'OVERDUE' ? 'destructive' : 'outline'}>{f.status}</Badge>
                  </div>
                ))}
                {!data.followUpAt && data.followUps.length === 0 && <EmptyState text="—" />}
              </div>
            </SectionCard>
          )}

          {/* Expert2/Operator: create proforma after doctor approval */}
          {['EXPERT_2', 'OPERATOR', 'ADMIN'].includes(role) && data.status === 'PRESCRIPTION_APPROVED' && (
            <Card className="border-primary/30">
              <CardHeader className="pb-2"><CardTitle className="text-base">{t('proforma')}</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">{lang === 'fa' ? 'پس از تأیید پزشک، پیش‌فاکتور با اقلام و قیمت‌های تعیین‌شده صادر و به کاربر ارسال می‌شود.' : 'Issue the proforma with priced items and send it to the patient.'}</p>
                <div className="space-y-1.5 w-48">
                  <Label className="text-xs">{t('shippingCost')}</Label>
                  <Input type="number" defaultValue={50000} id="proforma-ship-cost" dir="ltr" />
                </div>
                <Button onClick={() => action('CREATE_PROFORMA', { shippingCost: Number((document.getElementById('proforma-ship-cost') as HTMLInputElement)?.value || 50000) })} className="gap-1.5">
                  <FileText size={16} />{lang === 'fa' ? 'صدور پیش‌فاکتور و ارسال برای کاربر' : 'Issue proforma'}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* operator: shipping + delivery actions */}
          {['OPERATOR', 'EXPERT_2', 'ADMIN'].includes(role) && ['PAYMENT_CONFIRMED', 'PREPARING_SHIPMENT', 'SHIPPED'].includes(data.status) && (
            <OperatorShipping caseId={data.id} status={data.status} onSubmit={refresh} />
          )}
          {['OPERATOR', 'EXPERT_1', 'ADMIN'].includes(role) && data.status === 'DELIVERED' && (
            <SectionCard title={t('followups')}>
              <FollowupScheduler caseId={data.id} onSubmit={refresh} />
            </SectionCard>
          )}

          {/* timeline */}
          <SectionCard title={t('timeline')}>
            <Timeline items={data.timeline} />
          </SectionCard>
        </div>
      </div>
    </div>
  )
}

function TeamRow({ icon, label, name }: { icon: React.ReactNode; label: string; name: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-xs text-muted-foreground">{label}:</span>
      <span className="font-medium text-sm">{name}</span>
    </div>
  )
}

function ProgressTrack({ status }: { status: string }) {
  const { t } = useApp()
  const flow = ['WAITING_FOR_EXPERT_1', 'EXPERT_1_REVIEW', 'WAITING_FOR_USER_APPROVAL', 'WAITING_FOR_EXPERT_1_PRESCRIPTION', 'WAITING_FOR_EXPERT_2', 'WAITING_FOR_DOCTOR', 'PRESCRIPTION_APPROVED', 'PROFORMA_CREATED', 'WAITING_FOR_PAYMENT', 'PAYMENT_CONFIRMED', 'SHIPPED', 'DELIVERED']
  const idx = flow.indexOf(status)
  if (idx === -1) return null
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1">
      {flow.map((s, i) => (
        <React.Fragment key={s}>
          <div className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] whitespace-nowrap ${i < idx ? 'bg-emerald-600 text-white' : i === idx ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
            {(STATUS_META as Record<string, { fa: string; en: string }>)[s]?.fa || s}
          </div>
          {i < flow.length - 1 && <div className={`h-0.5 w-4 shrink-0 ${i < idx ? 'bg-emerald-600' : 'bg-muted'}`} />}
        </React.Fragment>
      ))}
    </div>
  )
}

// ── Expert 1 assessment editor ──────────────────────────────────────────
function AssessmentEditor({ onSubmit }: { onSubmit: (summary: string) => Promise<boolean> }) {
  const { t, lang } = useApp()
  const [summary, setSummary] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-3"><CardTitle className="text-base">{t('assessment')} — {lang === 'fa' ? 'ثبت ارزیابی اولیه' : 'Submit initial assessment'}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <Alert className="py-2"><AlertDescription className="text-xs">{t('aiDisclaimer')}</AlertDescription></Alert>
        <Textarea rows={5} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder={lang === 'fa' ? 'خلاصه یافته‌ها از تصویر زبان و شرح حال، تشخیص اولیه و توصیه‌ها…' : 'Findings from tongue image and history, initial diagnosis and advice…'} />
        <Button onClick={async () => { setBusy(true); const ok = await onSubmit(summary); setBusy(false); if (ok) setSummary('') }} disabled={busy || summary.trim().length < 10} className="gap-1.5">
          <ClipboardCheck size={16} />{t('submit')}
        </Button>
      </CardContent>
    </Card>
  )
}

// ── Prescription editor (Expert 1) ─────────────────────────────────────
interface RxItemDraft { productId?: string; drugName: string; dosage: string; frequency: string; duration: string; instructions: string; warnings: string }
export function PrescriptionEditor({ onSubmit, products }: { onSubmit: (items: RxItemDraft[], notes: string) => Promise<boolean>; products?: { id: string; nameFa: string }[] }) {
  const { t, lang } = useApp()
  const [items, setItems] = useState<RxItemDraft[]>([{ drugName: '', dosage: '', frequency: '', duration: '', instructions: '', warnings: '' }])
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const add = () => setItems([...items, { drugName: '', dosage: '', frequency: '', duration: '', instructions: '', warnings: '' }])
  const set = (i: number, k: keyof RxItemDraft, v: string) => setItems(items.map((it, idx) => idx === i ? { ...it, [k]: v } : it))

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-3"><CardTitle className="text-base">{t('prescription')} — {lang === 'fa' ? 'تنظیم نسخه' : 'Compose'}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {items.map((it, i) => (
          <div key={i} className="rounded-lg border p-3 space-y-2.5 relative">
            {items.length > 1 && <Button variant="ghost" size="sm" className="absolute top-2 end-2 h-6 text-rose-600" onClick={() => setItems(items.filter((_, x) => x !== i))}>×</Button>}
            <div className="grid sm:grid-cols-2 gap-2.5">
              <div className="space-y-1"><Label className="text-xs">{lang === 'fa' ? 'نام دارو / محصول' : 'Drug'} *</Label>
                {products && products.length > 0 ? (
                  <Select onValueChange={(v) => { const p = products.find((x) => x.id === v); set(i, 'drugName', p?.nameFa || ''); setItems(items.map((x, idx) => idx === i ? { ...x, productId: v } : x)) }}>
                    <SelectTrigger><SelectValue placeholder={lang === 'fa' ? 'انتخاب یا تایپ' : 'Select or type'} /></SelectTrigger>
                    <SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.nameFa}</SelectItem>)}</SelectContent>
                  </Select>
                ) : <Input value={it.drugName} onChange={(e) => set(i, 'drugName', e.target.value)} />}
              </div>
              <div className="space-y-1"><Label className="text-xs">{t('dosage')}</Label><Input value={it.dosage} onChange={(e) => set(i, 'dosage', e.target.value)} placeholder="۱ قاشق" /></div>
              <div className="space-y-1"><Label className="text-xs">{t('frequency')}</Label><Input value={it.frequency} onChange={(e) => set(i, 'frequency', e.target.value)} placeholder="روزی ۲ بار بعد غذا" /></div>
              <div className="space-y-1"><Label className="text-xs">{t('duration')}</Label><Input value={it.duration} onChange={(e) => set(i, 'duration', e.target.value)} placeholder="۷ روز" /></div>
            </div>
            <div className="space-y-1"><Label className="text-xs">{t('instructions')}</Label><Input value={it.instructions} onChange={(e) => set(i, 'instructions', e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">⚠ {lang === 'fa' ? 'هشدارها' : 'Warnings'}</Label><Input value={it.warnings} onChange={(e) => set(i, 'warnings', e.target.value)} /></div>
          </div>
        ))}
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={add} className="gap-1">+ {lang === 'fa' ? 'قلم جدید' : 'Add item'}</Button>
        </div>
        <div className="space-y-1"><Label className="text-xs">{lang === 'fa' ? 'توضیحات کارشناس اول' : 'Expert notes'}</Label><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        <Button disabled={busy || !items.some((i) => i.drugName.trim())} onClick={async () => { setBusy(true); const ok = await onSubmit(items.filter((i) => i.drugName.trim()), notes); if (ok) { setItems([{ drugName: '', dosage: '', frequency: '', duration: '', instructions: '', warnings: '' }]); setNotes('') } setBusy(false) }} className="gap-1.5">
          <Pill size={16} />{t('submit')}
        </Button>
      </CardContent>
    </Card>
  )
}

// ── Expert 2 review: availability + pricing ─────────────────────────────
export function Expert2Review({ prescription, onSubmit }: {
  prescription: Parameters<typeof PrescriptionCard>[0]['prescription']
  onSubmit: (items: { id: string; available: boolean; missing: boolean; unitPrice: number }[], notes: string) => Promise<boolean>
}) {
  const { t, lang } = useApp()
  const [rows, setRows] = useState(prescription.items.map((it) => ({ id: it.id, available: it.available, missing: it.missing, unitPrice: it.unitPrice ?? 0 })))
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  return (
    <Card className="border-teal-500/40">
      <CardHeader className="pb-3"><CardTitle className="text-base">{lang === 'fa' ? 'بازبینی کارشناس دوم — اقلام و قیمت' : 'Expert 2 Review — items & pricing'}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={r.id} className="rounded-lg border p-3 grid sm:grid-cols-[1fr_auto_auto_auto] gap-2.5 items-center">
              <span className="text-sm font-medium">{prescription.items[i]?.drugName}</span>
              <div className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" id={`av-${r.id}`} checked={r.available} onChange={(e) => setRows(rows.map((x, idx) => idx === i ? { ...x, available: e.target.checked, missing: !e.target.checked } : x))} className="size-4 accent-emerald-600" />
                <label htmlFor={`av-${r.id}`}>{t('available')}</label>
              </div>
              <div className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" id={`ms-${r.id}`} checked={r.missing} onChange={(e) => setRows(rows.map((x, idx) => idx === i ? { ...x, missing: e.target.checked } : x))} className="size-4 accent-amber-600" />
                <label htmlFor={`ms-${r.id}`}>{t('missing')}</label>
              </div>
              <Input type="number" value={r.unitPrice} onChange={(e) => setRows(rows.map((x, idx) => idx === i ? { ...x, unitPrice: Number(e.target.value) } : x))} className="w-32 h-8 text-xs" dir="ltr" placeholder={lang === 'fa' ? 'قیمت (تومان)' : 'Price'} />
            </div>
          ))}
        </div>
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={lang === 'fa' ? 'توضیحات بازبینی کارشناس دوم…' : 'Expert 2 notes…'} />
        <Button disabled={busy} onClick={async () => { setBusy(true); const ok = await onSubmit(rows, notes); setBusy(false) }} className="gap-1.5 bg-teal-600 hover:bg-teal-700">
          <CheckCircle2 size={16} />{lang === 'fa' ? 'ثبت بازبینی و ارسال برای پزشک' : 'Review & send to doctor'}
        </Button>
      </CardContent>
    </Card>
  )
}

// ── Doctor decision ─────────────────────────────────────────────────────
function DoctorDecision({ onSubmit }: { onSubmit: (decision: 'APPROVE' | 'REJECT' | 'REVISION', comment: string, followUpDays: number) => Promise<boolean> }) {
  const { t, lang } = useApp()
  const [comment, setComment] = useState('')
  const [days, setDays] = useState('40')
  const [busy, setBusy] = useState(false)
  return (
    <Card className="border-cyan-500/40">
      <CardHeader className="pb-3"><CardTitle className="text-base">{t('doctorComment')}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={lang === 'fa' ? 'اظهارنظر پزشک…' : 'Doctor comment…'} />
        <div className="flex items-end gap-2">
          <div className="space-y-1 w-40">
            <Label className="text-xs">{lang === 'fa' ? 'مدت پیگیری (روز)' : 'Follow-up (days)'}</Label>
            <Input type="number" value={days} onChange={(e) => setDays(e.target.value)} dir="ltr" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Button className="bg-emerald-600 hover:bg-emerald-700 gap-1" disabled={busy} onClick={async () => { setBusy(true); await onSubmit('APPROVE', comment, Number(days) || 40); setBusy(false) }}><CheckCircle2 size={15} />{t('confirm')}</Button>
          <Button variant="outline" className="gap-1" disabled={busy} onClick={async () => { setBusy(true); await onSubmit('REVISION', comment, Number(days) || 40); setBusy(false) }}>↺ {lang === 'fa' ? 'اصلاح' : 'Revise'}</Button>
          <Button variant="outline" className="text-rose-600 gap-1" disabled={busy} onClick={async () => { setBusy(true); await onSubmit('REJECT', comment, Number(days) || 40); setBusy(false) }}><XCircle size={15} />{t('reject')}</Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ── Operator shipping panel ─────────────────────────────────────────────
function OperatorShipping({ caseId, status, onSubmit }: { caseId: string; status: string; onSubmit: () => void }) {
  const { t, lang, api } = useApp()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ method: 'MOTORCYCLE', driverName: '', driverPhone: '', trackingCode: '', cost: '50000' })

  async function ship() {
    setBusy(true)
    try {
      await api(`/api/v1/cases/${caseId}/action`, { method: 'POST', json: { action: 'START_SHIPPING', ...form, cost: Number(form.cost) } })
      toast.success('✓')
      setOpen(false)
      onSubmit()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  async function deliver() {
    setBusy(true)
    try {
      await api(`/api/v1/cases/${caseId}/action`, { method: 'POST', json: { action: 'MARK_DELIVERED' } })
      toast.success('✓')
      onSubmit()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <SectionCard title={lang === 'fa' ? 'ارسال و تحویل' : 'Shipping & delivery'}>
      <div className="space-y-2">
        {status !== 'SHIPPED' ? (
          <>
            <Button className="w-full gap-1.5" onClick={() => setOpen(true)}><Truck size={15} />{lang === 'fa' ? 'ثبت اطلاعات ارسال' : 'Register shipment'}</Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogContent>
                <DialogHeader><DialogTitle>{lang === 'fa' ? 'اطلاعات ارسال' : 'Shipment info'}</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>{lang === 'fa' ? 'روش ارسال' : 'Method'}</Label>
                    <Select value={form.method} onValueChange={(v) => setForm({ ...form, method: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MOTORCYCLE">{lang === 'fa' ? 'پیک موتوری' : 'Motorcycle'}</SelectItem>
                        <SelectItem value="CAR">{lang === 'fa' ? 'خودرو' : 'Car'}</SelectItem>
                        <SelectItem value="POST">{lang === 'fa' ? 'پست' : 'Post'}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5"><Label>{lang === 'fa' ? 'نام راننده' : 'Driver'}</Label><Input value={form.driverName} onChange={(e) => setForm({ ...form, driverName: e.target.value })} /></div>
                    <div className="space-y-1.5"><Label>{lang === 'fa' ? 'موبایل راننده' : 'Driver phone'}</Label><Input value={form.driverPhone} onChange={(e) => setForm({ ...form, driverPhone: e.target.value })} dir="ltr" /></div>
                    <div className="space-y-1.5"><Label>{lang === 'fa' ? 'کد رهگیری' : 'Tracking'}</Label><Input value={form.trackingCode} onChange={(e) => setForm({ ...form, trackingCode: e.target.value })} dir="ltr" /></div>
                    <div className="space-y-1.5"><Label>{lang === 'fa' ? 'هزینه (تومان)' : 'Cost'}</Label><Input type="number" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} dir="ltr" /></div>
                  </div>
                  <Button onClick={ship} disabled={busy} className="w-full">{t('submit')}</Button>
                </div>
              </DialogContent>
            </Dialog>
          </>
        ) : (
          <Button className="w-full gap-1.5 bg-emerald-600 hover:bg-emerald-700" onClick={deliver} disabled={busy}><PackageCheck size={15} />{lang === 'fa' ? 'ثبت تحویل' : 'Mark delivered'}</Button>
        )}
      </div>
    </SectionCard>
  )
}

function ShipmentInfo({ shipment }: { shipment: { method: string; status: string; driverName?: string; driverPhone?: string; trackingCode?: string; shippingDate?: string; deliveryDate?: string; cost?: number } }) {
  const { lang } = useApp()
  const methodFa: Record<string, string> = { MOTORCYCLE: 'پیک موتوری', CAR: 'خودرو', POST: 'پست' }
  return (
    <div className="rounded-lg border p-3 space-y-1.5 text-sm">
      <div className="flex items-center gap-2"><Truck size={14} className="text-primary" />
        <span>{lang === 'fa' ? methodFa[shipment.method] : shipment.method}</span>
        <Badge variant="outline" className="ms-auto">{shipment.status}</Badge>
      </div>
      {shipment.driverName && <div className="text-xs text-muted-foreground">👤 {shipment.driverName} {shipment.driverPhone ? `· ${shipment.driverPhone}` : ''}</div>}
      {shipment.trackingCode && <div className="text-xs text-muted-foreground" dir="ltr">#: {shipment.trackingCode}</div>}
      {shipment.shippingDate && <div className="text-xs text-muted-foreground">📤 <JalaliDate date={shipment.shippingDate} /></div>}
      {shipment.deliveryDate && <div className="text-xs text-muted-foreground">📦 <JalaliDate date={shipment.deliveryDate} /></div>}
    </div>
  )
}

function FollowupScheduler({ caseId, onSubmit }: { caseId: string; onSubmit: () => void }) {
  const { lang, api, t } = useApp()
  const [days, setDays] = useState('40')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <div className="space-y-2.5">
      <div className="space-y-1.5">
        <Label className="text-xs">{lang === 'fa' ? 'چند روز بعد پیگیری؟' : 'Follow-up after (days)'}</Label>
        <Input type="number" value={days} onChange={(e) => setDays(e.target.value)} dir="ltr" />
      </div>
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={lang === 'fa' ? 'یادداشت پیگیری…' : 'Note…'} />
      <Button className="w-full gap-1.5" disabled={busy} onClick={async () => {
        setBusy(true)
        try {
          await api(`/api/v1/cases/${caseId}/action`, { method: 'POST', json: { action: 'SCHEDULE_FOLLOWUP', days: Number(days), note } })
          toast.success('✓'); onSubmit()
        } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
      }}><CalendarClock size={15} />{t('submit')}</Button>
    </div>
  )
}
