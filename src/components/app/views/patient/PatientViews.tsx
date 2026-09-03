'use client'
// Patient views: Dashboard, Profile, Questionnaire wizard, New case (upload + quality gate), Cases list
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '@/contexts/app'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { SectionCard, StatusBadge, StatCard, JalaliDate, LoadingRows, EmptyState, Money } from '../../shared/atoms'
import { CaseWorkspace } from '../CaseWorkspace'
import { fmtMoney } from '@/lib/i18n'
import { LayoutDashboard, FolderOpen, Package, Ticket, ClipboardList, ImagePlus, ScanHeart, CheckCircle2, Upload, Sparkles, User, Heart, Activity } from 'lucide-react'

// ── Patient Dashboard ───────────────────────────────────────────────────
export function PatientDashboard({ navigate }: { navigate: (p: string, params?: Record<string, string>) => void }) {
  const { t, lang, api, user } = useApp()
  const [data, setData] = useState<{
    stats: { totalCases: number; activeCases: number; totalOrders: number; openTickets: number }
    cases: { id: string; code: string; status: string; createdAt: string }[]
    orders: { id: string; code: string; status: string; total: number; createdAt: string }[]
    lastMizaj: { mizajFa: string; mizajEn: string; createdAt: string } | null
  } | null>(null)

  useEffect(() => { api('/api/v1/dashboard').then(setData).catch(() => {}) }, [api])

  if (!data) return <LoadingRows rows={5} />
  const activeCase = data.cases.find((c) => !['CLOSED', 'CANCELLED'].includes(c.status))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{user?.firstName} {user?.lastName} 👋</h1>
        <p className="text-muted-foreground text-sm mt-1">{t('appDesc')}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard title={t('myCases')} value={data.stats.totalCases} icon={<FolderOpen size={18} />} />
        <StatCard title={t('status') + ' (فعال)'} value={data.stats.activeCases} icon={<Activity size={18} />} tone="bg-emerald-500/10 text-emerald-600" />
        <StatCard title={t('orders')} value={data.stats.totalOrders} icon={<Package size={18} />} />
        <StatCard title={t('tickets')} value={data.stats.openTickets} icon={<Ticket size={18} />} tone="bg-amber-500/10 text-amber-600" />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 border-primary/25 bg-gradient-to-br from-primary/5 to-transparent">
          <CardContent className="p-6">
            {activeCase ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="size-10 rounded-lg bg-primary/15 text-primary flex items-center justify-center"><ScanHeart size={20} /></div>
                  <div className="font-bold">{t('caseCode')} {activeCase.code}</div>
                  <StatusBadge status={activeCase.status} />
                </div>
                <p className="text-sm text-muted-foreground">برای مشاهده جزئیات و اقدامات لازم کلیک کنید.</p>
                <Button onClick={() => navigate('caseDetail', { id: activeCase.id })}>{t('details')}</Button>
              </div>
            ) : (
              <div className="space-y-3 text-center py-4">
                <div className="mx-auto size-14 rounded-2xl bg-primary/15 text-primary flex items-center justify-center"><ImagePlus size={28} /></div>
                <div className="font-bold">{t('newCase')}</div>
                <p className="text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed">{t('uploadHint')}</p>
                <div className="flex justify-center gap-2 flex-wrap">
                  {!data.lastMizaj && <Button variant="outline" onClick={() => navigate('questionnaire')} className="gap-1.5"><ClipboardList size={16} />{t('questionnaire')}</Button>}
                  <Button onClick={() => navigate('newCase')} className="gap-1.5"><ImagePlus size={16} />{t('newCase')}</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <SectionCard title={t('mizaj')}>
          {data.lastMizaj ? (
            <div className="space-y-2">
              <Badge className="bg-teal-600 text-white text-sm py-1.5 px-3">{lang === 'fa' ? data.lastMizaj.mizajFa : data.lastMizaj.mizajEn}</Badge>
              <div className="text-xs text-muted-foreground"><JalaliDate date={data.lastMizaj.createdAt} /></div>
              <Button variant="outline" size="sm" onClick={() => navigate('questionnaire')}>{t('retake')}</Button>
            </div>
          ) : (
            <div className="space-y-3 text-center py-2">
              <Heart size={28} className="mx-auto text-rose-400" />
              <p className="text-xs text-muted-foreground leading-relaxed">برای شروع، پرسشنامه مزاج‌شناسی را تکمیل کنید.</p>
              <Button size="sm" onClick={() => navigate('questionnaire')} className="gap-1.5"><ClipboardList size={14} />{t('questionnaire')}</Button>
            </div>
          )}
        </SectionCard>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <SectionCard title={t('orders')}>
          {data.orders.length === 0 ? <EmptyState /> : (
            <div className="space-y-2">
              {data.orders.slice(0, 4).map((o) => (
                <button key={o.id} onClick={() => navigate('orders')} className="w-full flex items-center justify-between rounded-lg border p-2.5 hover:bg-muted/50 transition-colors text-sm">
                  <span className="tabular-nums">{o.code}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{fmtMoney(o.total, lang)}</span>
                  <StatusBadge status={o.status} kind="order" />
                </button>
              ))}
            </div>
          )}
        </SectionCard>
        <SectionCard title={t('myCases')}>
          {data.cases.length === 0 ? <EmptyState /> : (
            <div className="space-y-2">
              {data.cases.slice(0, 4).map((c) => (
                <button key={c.id} onClick={() => navigate('caseDetail', { id: c.id })} className="w-full flex items-center justify-between rounded-lg border p-2.5 hover:bg-muted/50 transition-colors text-sm">
                  <span className="tabular-nums">{c.code}</span>
                  <JalaliDate date={c.createdAt} />
                  <StatusBadge status={c.status} />
                </button>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  )
}

// ── Profile ─────────────────────────────────────────────────────────────
export function ProfilePage() {
  const { t, api, user } = useApp()
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({})

  useEffect(() => {
    api<{ user: Record<string, string>; profile: Record<string, string> | null }>('/api/v1/patients/profile').then((d) => {
      const u: Record<string, string> = { firstName: d.user.firstName || '', lastName: d.user.lastName || '', email: d.user.email || '', gender: d.user.gender || '', birthDate: d.user.birthDate?.slice(0, 10) || '' }
      const p = d.profile || {}
      setForm({ ...u, ...p, referralCode: d.user.referralCode || '' })
    }).catch(() => {})
  }, [api])

  const set = (k: string, v: string) => setForm({ ...form, [k]: v })

  async function save() {
    setBusy(true)
    try {
      await api('/api/v1/patients/profile', { method: 'PUT', json: form })
      toast.success('✓')
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }

  const F = (k: string, label: string, opts?: { type?: string; ltr?: boolean }) => (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input value={form[k] || ''} onChange={(e) => set(k, e.target.value)} type={opts?.type} dir={opts?.ltr ? 'ltr' : undefined} />
    </div>
  )

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold flex items-center gap-2"><User size={24} />{t('profile')}</h1>
      <SectionCard title={t('profile')}>
        <div className="grid sm:grid-cols-2 gap-3">
          {F('firstName', t('firstName'))}
          {F('lastName', t('lastName'))}
          <div className="space-y-1.5"><Label className="text-xs">{t('phone')}</Label><Input value={user?.phone || ''} disabled dir="ltr" /></div>
          {F('email', t('email'), { ltr: true })}
          <div className="space-y-1.5">
            <Label className="text-xs">{lang2('جنسیت', 'Gender')}</Label>
            <Select value={form.gender || ''} onValueChange={(v) => set('gender', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="MALE">{lang2('مرد', 'Male')}</SelectItem>
                <SelectItem value="FEMALE">{lang2('زن', 'Female')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {F('birthDate', lang2('تاریخ تولد', 'Birth date'), { type: 'date' })}
          {F('heightCm', lang2('قد (سانتی‌متر)', 'Height (cm)'), { ltr: true })}
          {F('weightKg', lang2('وزن (کیلوگرم)', 'Weight (kg)'), { ltr: true })}
          {F('province', lang2('استان', 'Province'))}
          {F('city', lang2('شهر', 'City'))}
          {F('postalCode', lang2('کد پستی', 'Postal code'), { ltr: true })}
          {F('emergencyPhone', lang2('تماس اضطراری', 'Emergency phone'), { ltr: true })}
        </div>
        <div className="grid sm:grid-cols-2 gap-3 mt-3">
          {F('allergies', lang2('حساسیت‌های دارویی/غذایی', 'Allergies'))}
          {F('pastIllnesses', lang2('بیماری‌های قبلی', 'Past illnesses'))}
        </div>
        <div className="mt-3 space-y-1.5">
          <Label className="text-xs">{lang2('آدرس', 'Address')}</Label>
          <Textarea rows={2} value={form.addressLine || ''} onChange={(e) => set('addressLine', e.target.value)} />
        </div>
        <Button onClick={save} disabled={busy} className="mt-4 gap-1.5"><CheckCircle2 size={16} />{t('save')}</Button>
      </SectionCard>

      <SectionCard title={lang2('کد معرف شما', 'Your referral code')}>
        <div className="flex items-center gap-3">
          <code className="rounded-lg bg-muted px-4 py-2 font-mono text-sm" dir="ltr">{form.referralCode || '—'}</code>
          <Button variant="outline" size="sm" onClick={() => { navigator.clipboard?.writeText(form.referralCode); toast.success('کپی شد ✓') }}>کپی</Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{lang2('این کد را با دوستان خود به اشتراک بگذارید؛ پس از اولین خرید آن‌ها، کمیسیون معرفی ثبت می‌شود.', 'Share this code with friends; a referral commission is recorded after their first purchase.')}</p>
      </SectionCard>
    </div>
  )
}

const lang2 = (fa: string, en: string) => {
  return (typeof window !== 'undefined' && document.documentElement.lang === 'en') ? en : fa
}

// ── Questionnaire wizard ────────────────────────────────────────────────
export function QuestionnairePage() {
  const { t, lang, api, navigate } = useApp()
  const [q, setQ] = useState<{ id: string; version: number; questions: { id: string; textFa: string; textEn: string; options: { id: string; textFa: string; textEn: string }[] }[] } | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ mizajFa: string; mizajEn: string; scores: Record<string, number>; summary?: string } | null>(null)

  useEffect(() => {
    api<{ questionnaire: typeof q }>('/api/v1/questionnaires/active').then((d) => setQ(d.questionnaire)).catch(() => {})
  }, [api])

  if (!q) return <LoadingRows rows={4} />
  if (q.questions.length === 0) return <EmptyState />

  const total = q.questions.length
  const answered = Object.keys(answers).length

  async function submit() {
    setBusy(true)
    try {
      const d = await api<{ response: { mizajFa: string; mizajEn: string; scores: Record<string, number>; summary?: string } }>('/api/v1/questionnaires/submit', {
        method: 'POST', json: { answers: Object.entries(answers).map(([questionId, optionId]) => ({ questionId, optionId })) },
      })
      setResult(d.response)
      toast.success('✓')
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }

  if (result) {
    return (
      <div className="max-w-xl mx-auto space-y-5">
        <Card className="border-teal-500/40 bg-gradient-to-br from-teal-500/10 to-transparent">
          <CardContent className="p-8 text-center space-y-4">
            <Sparkles size={40} className="mx-auto text-teal-500" />
            <div className="text-xs text-muted-foreground">{t('mizajResult')}</div>
            <div className="text-3xl font-black">{lang === 'fa' ? result.mizajFa : result.mizajEn}</div>
            <div className="flex justify-center flex-wrap gap-2">
              {Object.entries(result.scores).map(([k, v]) => (
                <Badge key={k} variant="outline" className="text-xs tabular-nums">
                  {({ HOT: 'گرما', COLD: 'برودت', WET: 'رطوبت', DRY: 'خشکی' } as Record<string, string>)[k]}: {lang === 'fa' ? new Intl.NumberFormat('fa-IR').format(v) : v}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
        <div className="flex gap-2 justify-center">
          <Button onClick={() => navigate('newCase')} className="gap-1.5"><ImagePlus size={16} />{t('newCase')}</Button>
          <Button variant="outline" onClick={() => { setResult(null); setAnswers({}); setStep(0) }}>{t('retake')}</Button>
        </div>
      </div>
    )
  }

  const page = q.questions.slice(step, step + 4)
  const isLast = step + 4 >= total

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <ClipboardList className="text-primary" size={22} />
        <h1 className="text-xl font-bold">{t('questionnaire')}</h1>
        <span className="text-xs text-muted-foreground ms-auto tabular-nums">{lang === 'fa' ? `${new Intl.NumberFormat('fa-IR').format(answered)}/${new Intl.NumberFormat('fa-IR').format(total)}` : `${answered}/${total}`}</span>
      </div>
      <Progress value={(answered / total) * 100} />
      <div className="space-y-4">
        {page.map((qq) => (
          <Card key={qq.id}>
            <CardContent className="p-4 space-y-3">
              <div className="font-medium text-sm">{lang === 'fa' ? qq.textFa : qq.textEn}</div>
              <div className="grid gap-2">
                {qq.options.map((o) => (
                  <button key={o.id} onClick={() => setAnswers({ ...answers, [qq.id]: o.id })}
                    className={`text-start rounded-lg border px-3.5 py-2.5 text-sm transition-all ${answers[qq.id] === o.id ? 'border-primary bg-primary/10 font-medium' : 'hover:border-primary/40'}`}>
                    {lang === 'fa' ? o.textFa : o.textEn}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="flex justify-between">
        <Button variant="outline" disabled={step === 0} onClick={() => setStep(Math.max(0, step - 4))}>{t('back')}</Button>
        {isLast ? (
          <Button disabled={answered < total || busy} onClick={submit} className="gap-1.5"><CheckCircle2 size={16} />{t('submit')}</Button>
        ) : (
          <Button disabled={answered < step + 4} onClick={() => setStep(step + 4)}>{lang === 'fa' ? 'بعدی' : 'Next'}</Button>
        )}
      </div>
    </div>
  )
}

// ── New case: image upload + quality gate + create ─────────────────────
export function NewCasePage() {
  const { t, lang, api, navigate } = useApp()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [uploadResult, setUploadResult] = useState<{ image: { id: string }; qualityOk: boolean; message: string; issues: string[]; quality?: { score: number; blur: number; brightness: number; exposure: string; resolution: string; issues: string[] } } | null>(null)
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState('NORMAL')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function doUpload(f: File) {
    setBusy(true); setFile(f); setPreview(URL.createObjectURL(f)); setUploadResult(null)
    try {
      const fd = new FormData()
      fd.append('file', f)
      fd.append('type', 'TONGUE')
      const d = await api<{ image: { id: string }; qualityOk: boolean; message: string; issues: string[]; quality?: { score: number; blur: number; brightness: number; exposure: string; resolution: string; issues: string[] } }>('/api/v1/images/upload', { method: 'POST', body: fd })
      setUploadResult(d)
      if (d.qualityOk) toast.success(d.message)
      else toast.warning(d.message)
    } catch (e) {
      toast.error((e as Error).message)
      setFile(null); setPreview(null)
    } finally { setBusy(false) }
  }

  async function createCase() {
    if (!uploadResult?.qualityOk) return
    setBusy(true)
    try {
      const d = await api<{ case: { id: string; code: string } }>('/api/v1/cases', { method: 'POST', json: { description, imageId: uploadResult.image.id, priority } })
      toast.success(`پرونده ${d.case.code} ایجاد شد ✓`)
      navigate('caseDetail', { id: d.case.id })
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <h1 className="text-2xl font-bold flex items-center gap-2"><ImagePlus size={24} className="text-primary" />{t('newCase')}</h1>

      <Card className={`border-2 border-dashed transition-colors ${uploadResult?.qualityOk === true ? 'border-emerald-500/60' : uploadResult ? 'border-amber-500/60' : 'border-border'}`}>
        <CardContent className="p-6">
          <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) doUpload(f) }} />
          {preview ? (
            <div className="space-y-4">
              <div className="relative max-w-xs mx-auto">
                { }
                <img src={preview} alt="preview" className="rounded-xl w-full" />
                {uploadResult?.quality?.score != null && (
                  <Badge className={`absolute top-2 end-2 text-white ${uploadResult.qualityOk ? 'bg-emerald-600' : 'bg-amber-600'}`}>Q: {uploadResult.quality.score}/100</Badge>
                )}
              </div>
              {uploadResult && (
                <div className="space-y-2">
                  {uploadResult.quality && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                      <Metric label={lang === 'fa' ? 'وضوح' : 'Sharpness'} value={`${uploadResult.quality.blur}`} />
                      <Metric label={lang === 'fa' ? 'روشنایی' : 'Brightness'} value={`${uploadResult.quality.brightness}`} />
                      <Metric label={lang === 'fa' ? 'نوردهی' : 'Exposure'} value={uploadResult.quality.exposure} />
                      <Metric label={lang === 'fa' ? 'رزولوشن' : 'Resolution'} value={uploadResult.quality.resolution} />
                    </div>
                  )}
                  {uploadResult.issues.length > 0 && (
                    <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-300/50 p-3 space-y-1 text-xs text-amber-700 dark:text-amber-400">
                      {uploadResult.issues.map((iss, i) => <div key={i}>⚠ {iss}</div>)}
                    </div>
                  )}
                  <div className="flex gap-2 justify-center">
                    <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={busy} className="gap-1.5"><Upload size={14} />{lang === 'fa' ? 'تصویر دیگر' : 'Retry image'}</Button>
                  </div>
                </div>
              )}
              {busy && !uploadResult && <div className="text-center text-sm text-muted-foreground animate-pulse">…{lang === 'fa' ? 'اعتبارسنجی و پردازش تصویر (حذف متادیتا، فشرده‌سازی هوشمند، ۴ نسخه)' : 'Validating & processing (metadata strip, smart compression, 4 variants)'}</div>}
            </div>
          ) : (
            <button onClick={() => inputRef.current?.click()} className="w-full py-10 flex flex-col items-center gap-3 text-muted-foreground hover:text-primary transition-colors">
              <ScanHeart size={44} />
              <div className="font-medium">{t('uploadImage')}</div>
              <div className="text-xs max-w-sm text-center leading-relaxed">{t('uploadHint')}</div>
            </button>
          )}
        </CardContent>
      </Card>

      <SectionCard title={t('description')}>
        <Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={lang === 'fa' ? 'شرح کامل مشکل، علائم، مدت زمان، داروهای مصرفی…' : 'Describe your symptoms, duration, current medications…'} />
        <div className="mt-3 w-44">
          <Label className="text-xs">{t('priority')}</Label>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="LOW">{lang === 'fa' ? 'کم' : 'Low'}</SelectItem>
              <SelectItem value="NORMAL">{lang === 'fa' ? 'عادی' : 'Normal'}</SelectItem>
              <SelectItem value="HIGH">{lang === 'fa' ? 'زیاد' : 'High'}</SelectItem>
              <SelectItem value="URGENT">{lang === 'fa' ? 'فوری' : 'Urgent'}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button className="mt-4 w-full gap-1.5" disabled={!uploadResult?.qualityOk || busy || description.trim().length < 10} onClick={createCase}>
          <Sparkles size={16} />{t('createCase')}
        </Button>
      </SectionCard>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="font-bold tabular-nums">{value}</div>
    </div>
  )
}

// ── Cases list ──────────────────────────────────────────────────────────
export function CasesList({ navigate }: { navigate: (p: string, params?: Record<string, string>) => void }) {
  const { t, api } = useApp()
  const [cases, setCases] = useState<{ id: string; code: string; status: string; priority: string; createdAt: string; waitingHours?: number; images: { id: string }[] }[]>([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    queueMicrotask(() => setLoading(true))
    api<{ cases: typeof cases }>('/api/v1/cases').then((d) => setCases(d.cases)).catch(() => {}).finally(() => setLoading(false))
  }, [api])
  useEffect(load, [load])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-2xl font-bold">{t('myCases')}</h1>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search')} className="w-64 ms-auto" />
      </div>
      {loading ? <LoadingRows /> : cases.length === 0 ? <EmptyState /> : (
        <div className="grid gap-3 md:grid-cols-2">
          {cases.filter((c) => !q || c.code.includes(q)).map((c) => (
            <button key={c.id} onClick={() => navigate('caseDetail', { id: c.id })} className="text-start">
              <Card className="hover:border-primary/50 transition-colors">
                <CardContent className="p-4 flex items-center gap-3 flex-wrap">
                  <div className="font-bold tabular-nums">{c.code}</div>
                  <StatusBadge status={c.status} />
                  <Badge variant="outline">{c.priority}</Badge>
                  <div className="ms-auto text-xs text-muted-foreground"><JalaliDate date={c.createdAt} /></div>
                </CardContent>
              </Card>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function CaseDetailForPatient({ id, navigate }: { id: string; navigate: (p: string, params?: Record<string, string>) => void }) {
  return <CaseWorkspace caseId={id} onChanged={() => navigate('cases')} />
}
