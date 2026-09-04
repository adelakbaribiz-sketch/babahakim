'use client'
// Design System showcase — forms, tables, cards, dialogs, navigation,
// notifications, charts, workflow statuses (PHASE 07 style guide, ED-85).
// Every element uses design tokens only (§27/§39).
import React, { useState } from 'react'
import { useApp } from '@/contexts/app'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'
import { Pagination, PaginationContent, PaginationItem, PaginationLink } from '@/components/ui/pagination'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Progress } from '@/components/ui/progress'
import { toast } from 'sonner'
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { SectionCard, StatCard, StatusBadge, EmptyState, ErrorState, SuccessState, LoadingRows, LoadingCard, PageState, ConfirmDialog, ConfidenceBar, Money, JalaliDate } from '../../shared/atoms'
import { chartTheme, status, statusClass, type StatusToken } from '@/design-system/tokens'
import { CASE_STATUS, STATUS_META } from '@/lib/constants'
import { FolderOpen, Bell, ShoppingCart, CheckCircle2, AlertTriangle, Info, Menu, Plus } from 'lucide-react'

// ─── Forms (§20) ───────────────────────────────────────────────────────────
export function DsForms() {
  const { t, lang } = useApp()
  const [val, setVal] = useState('')
  const [sel, setSel] = useState('')
  const [sw, setSw] = useState(true)
  const [chk, setChk] = useState(true)
  const [radio, setRadio] = useState('a')
  const l = (fa: string, en: string) => (lang === 'fa' ? fa : en)

  return (
    <SectionCard title={t('dsForms')}>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="ds-default">{l('پیش‌فرض', 'Default')}</Label>
          <Input id="ds-default" placeholder={l('متن ورودی…', 'Placeholder…')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ds-focus">{l('حالت فوکوس', 'Focus state')}</Label>
          <Input id="ds-focus" defaultValue="باباحکیم" className="ring-2 ring-ring/40" />
          <p className="text-xs text-muted-foreground">{l('رنگ فوکوس: #225BBE (§20)', 'Focus color: #225BBE (§20)')}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ds-error" className="text-destructive">{l('خطای اعتبارسنجی', 'Validation error')}</Label>
          <Input id="ds-error" defaultValue="0" className="border-destructive focus-visible:ring-destructive/40" aria-invalid />
          <p className="text-xs text-destructive">{l('شماره موبایل نامعتبر است', 'Invalid phone number')}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ds-success">{l('اعتبارسنجی موفق', 'Validation success')}</Label>
          <Input id="ds-success" defaultValue="09123456789" className="border-status-success focus-visible:ring-status-success/40" />
          <p className="text-xs text-status-success">{l('شماره معتبر است', 'Valid number')}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ds-disabled">{l('غیرفعال', 'Disabled')}</Label>
          <Input id="ds-disabled" disabled placeholder={l('غیرقابل ویرایش', 'Read-only')} />
        </div>
        <div className="space-y-1.5">
          <Label>{l('انتخاب (Select)', 'Select')}</Label>
          <Select value={sel} onValueChange={setSel}>
            <SelectTrigger><SelectValue placeholder={t('all')} /></SelectTrigger>
            <SelectContent>
              {['EXPERT_1', 'EXPERT_2', 'DOCTOR'].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-3 pt-6">
          <Switch checked={sw} onCheckedChange={setSw} id="ds-switch" />
          <Label htmlFor="ds-switch">{l('دارای نسخه (Rx)', 'Prescription required')}</Label>
        </div>
        <div className="flex items-center gap-3 pt-6">
          <Checkbox checked={chk} onCheckedChange={(v) => setChk(v === true)} id="ds-chk" />
          <Label htmlFor="ds-chk">{l('موجود در انبار', 'In stock')}</Label>
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label>{l('گزینه‌های مزاج', 'Temperament options')}</Label>
          <RadioGroup value={radio} onValueChange={setRadio} className="flex flex-wrap gap-4">
            {['a', 'b', 'c'].map((v) => (
              <div key={v} className="flex items-center gap-2">
                <RadioGroupItem value={v} id={`ds-r-${v}`} />
                <Label htmlFor={`ds-r-${v}`}>{['گرم و خشک', 'سرد و تر', 'معتدل'][Number(v) - 1]}</Label>
              </div>
            ))}
          </RadioGroup>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="ds-textarea">{l('شرح حال (Textarea)', 'Description')}</Label>
          <Textarea id="ds-textarea" rows={2} placeholder={t('description')} />
        </div>
      </div>
      <div className="mt-4">
        <Progress value={66} className="[&>div]:bg-brand-light" />
        <p className="text-xs text-muted-foreground mt-1">{l('نوار پیشرفت ثبت‌نام — #57AFE2 (§11)', 'Registration progress — #57AFE2 (§11)')}</p>
      </div>
    </SectionCard>
  )
}

// ─── Tables (§19) ──────────────────────────────────────────────────────────
export function DsTables() {
  const { t, lang } = useApp()
  const l = (fa: string, en: string) => (lang === 'fa' ? fa : en)
  const rows = [
    { code: 'TC-1001', status: 'EXPERT_1_REVIEW', total: 1280000 },
    { code: 'TC-1002', status: 'WAITING_FOR_PAYMENT', total: 890000 },
    { code: 'TC-1003', status: 'DELIVERED', total: 2100000 },
  ]
  return (
    <SectionCard title={t('dsTables')}>
      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-brand-dark hover:bg-brand-dark text-white">
              <TableHead className="text-white/80">{t('caseCode')}</TableHead>
              <TableHead className="text-white/80">{t('status')}</TableHead>
              <TableHead className="text-white/80">{t('date')}</TableHead>
              <TableHead className="text-white/80 text-end">{t('amount')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.code} className="table-row-hover">
                <TableCell className="font-mono text-xs" dir="ltr">{r.code}</TableCell>
                <TableCell><StatusBadge status={r.status} /></TableCell>
                <TableCell className="text-xs"><JalaliDate date={new Date()} /></TableCell>
                <TableCell className="text-end"><Money amount={r.total} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground mt-2">{l('هدر: #173F76 یا سفید با متن سرمه‌ای · هاور ردیف: تینت #57AFE2 · حاشیه: #DEDBDB (§19)', 'Header: #173F76 or white with navy text · row hover: #57AFE2 tint · border: #DEDBDB (§19)')}</p>
    </SectionCard>
  )
}

// ─── Cards (§18/§21) ───────────────────────────────────────────────────────
export function DsCards() {
  const { t, lang } = useApp()
  const l = (fa: string, en: string) => (lang === 'fa' ? fa : en)
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard title={l('بیماران امروز', 'Patients today')} value={12} icon={<FolderOpen size={18} />} />
        <StatCard title={l('پرونده‌های جدید', 'New cases')} value={7} icon={<Plus size={18} />} tone="bg-brand-light/15 text-brand-dark dark:text-brand-light" />
        <StatCard title={l('بازبینی‌های در انتظار', 'Pending reviews')} value={9} icon={<Bell size={18} />} tone="bg-status-warning/10 text-status-warning" />
        <StatCard title={l('درآمد', 'Revenue')} value="۴٫۲ م" icon={<ShoppingCart size={18} />} tone="bg-status-success/10 text-status-success" sub={l('در ۲۴ ساعت', 'last 24h')} />
      </div>
      <SectionCard title={l('کارت بخش (SectionCard)', 'Section card')}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <ConfidenceBar value={0.82} />
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="destructive">Destructive</Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-3">{l('کارت: سفید · حاشیه #DEDBDB · شعاع متوسط · سایه بسیار ملایم (§21)', 'Card: white · #DEDBDB border · medium radius · very subtle shadow (§21)')}</p>
      </SectionCard>
    </div>
  )
}

// ─── Dialogs (§26) ─────────────────────────────────────────────────────────
export function DsDialogs() {
  const { t, lang } = useApp()
  const l = (fa: string, en: string) => (lang === 'fa' ? fa : en)
  const [confirmOpen, setConfirmOpen] = useState(false)
  return (
    <div className="grid sm:grid-cols-3 gap-4">
      <Dialog>
        <DialogTrigger asChild><Button variant="outline">{l('دیالوگ ساده', 'Basic dialog')}</Button></DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{l('عنوان دیالوگ', 'Dialog title')}</DialogTitle>
            <DialogDescription>{l('محتوای دیالوگ با توکن‌های طراحی — دکمه‌ها و فوکوس کاملاً دسترس‌پذیرند.', 'Dialog body using design tokens — buttons and focus fully accessible.')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline">{t('cancel')}</Button>
            <Button className="btn-brand-hover">{t('confirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        trigger={<Button variant="destructive">{l('تأیید مخرب', 'Destructive confirm')}</Button>}
        title={l('لغو پرونده؟', 'Cancel this case?')}
        description={l('این عمل قابل بازگشت نیست و پرونده به حالت CANCELLED می‌رود.', 'This action is irreversible; the case moves to CANCELLED.')}
        destructive
        onConfirm={() => { setConfirmOpen(false); toast.success(l('پرونده لغو شد (نمایشی)', 'Case cancelled (demo)')) }}
      />
      <Sheet>
        <SheetTrigger asChild><Button variant="outline"><Menu size={16} className="me-1.5" />{l('دراور موبایل', 'Mobile drawer')}</Button></SheetTrigger>
        <SheetContent side={lang === 'fa' ? 'right' : 'left'}>
          <SheetHeader>
            <SheetTitle>{l('منوی موبایل', 'Mobile menu')}</SheetTitle>
            <SheetDescription>{l('سمت دراور با جهت زبان هماهنگ است (§24).', 'Drawer side follows language direction (§24).')}</SheetDescription>
          </SheetHeader>
        </SheetContent>
      </Sheet>
      <span hidden data-keep={confirmOpen} />
    </div>
  )
}

// ─── Navigation ────────────────────────────────────────────────────────────
export function DsNavigation() {
  const { t, lang } = useApp()
  const l = (fa: string, en: string) => (lang === 'fa' ? fa : en)
  return (
    <SectionCard title={t('dsNavigation')}>
      <div className="space-y-5">
        <Breadcrumb dir="ltr" className="flex-row-reverse">
          <BreadcrumbList>
            <BreadcrumbItem><BreadcrumbLink href="#">{l('داشبورد', 'Dashboard')}</BreadcrumbLink></BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbLink href="#">{t('myCases')}</BreadcrumbLink></BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbPage>TC-1001</BreadcrumbPage></BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <Tabs defaultValue="a">
          <TabsList>
            <TabsTrigger value="a">{l('صف', 'Queue')}</TabsTrigger>
            <TabsTrigger value="b">{t('tickets')}</TabsTrigger>
            <TabsTrigger value="c">{t('reports')}</TabsTrigger>
          </TabsList>
          <TabsContent value="a" className="text-sm text-muted-foreground pt-2">{l('تب فعال با رنگ اصلی #225BBE (§4).', 'Active tab uses primary #225BBE (§4).')}</TabsContent>
          <TabsContent value="b" className="text-sm text-muted-foreground pt-2">{l('محتوای تب دوم.', 'Second tab content.')}</TabsContent>
          <TabsContent value="c" className="text-sm text-muted-foreground pt-2">{l('محتوای تب سوم.', 'Third tab content.')}</TabsContent>
        </Tabs>
        <Pagination dir="ltr" className="flex-row-reverse">
          <PaginationContent>
            <PaginationItem><PaginationLink href="#">1</PaginationLink></PaginationItem>
            <PaginationItem><PaginationLink href="#" isActive>2</PaginationLink></PaginationItem>
            <PaginationItem><PaginationLink href="#">3</PaginationLink></PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    </SectionCard>
  )
}

// ─── Notifications ─────────────────────────────────────────────────────────
export function DsNotifications() {
  const { t, lang } = useApp()
  const l = (fa: string, en: string) => (lang === 'fa' ? fa : en)
  return (
    <SectionCard title={t('dsNotifications')}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => toast.success(l('پرداخت تأیید شد', 'Payment confirmed'))}>{l('توست موفق', 'Success toast')}</Button>
          <Button size="sm" variant="outline" onClick={() => toast.error(l('خطا در ارتباط با سرور', 'Server connection error'))}>{l('توست خطا', 'Error toast')}</Button>
          <Button size="sm" variant="secondary" onClick={() => toast(l('پرونده در صف بررسی قرار گرفت', 'Case queued for review'))}>{l('توست ساده', 'Default toast')}</Button>
        </div>
        <Alert>
          <Info size={16} />
          <AlertTitle>{l('اعلان اطلاع‌رسانی', 'Info alert')}</AlertTitle>
          <AlertDescription>{l('تحلیل AI صرفاً پیشنهادی است (§14).', 'AI analysis is assistive only (§14).')}</AlertDescription>
        </Alert>
        <Alert className="border-status-warning/30 bg-status-warning/10">
          <AlertTriangle size={16} className="text-status-warning" />
          <AlertTitle>{l('هشدار', 'Warning')}</AlertTitle>
          <AlertDescription>{l('موجودی محصول رو به اتمام است.', 'Product stock is running low.')}</AlertDescription>
        </Alert>
        <Alert variant="destructive">
          <AlertTriangle size={16} />
          <AlertTitle>{l('خطا', 'Error')}</AlertTitle>
          <AlertDescription>{l('رسید پرداخت تأیید نشد؛ لطفاً مجدداً اقدام کنید.', 'Payment receipt rejected; please retry.')}</AlertDescription>
        </Alert>
      </div>
    </SectionCard>
  )
}

// ─── Charts (§22) ──────────────────────────────────────────────────────────
const CHART_DATA = Array.from({ length: 10 }, (_, i) => ({ d: `${i + 1}`, a: 20 + Math.round(Math.sin(i) * 8 + 12), b: 8 + i % 4 }))
export function DsCharts() {
  const { t } = useApp()
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <SectionCard title={t('dsCharts')}>
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={CHART_DATA}>
            <defs><linearGradient id="ds-rev" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.35} /><stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} /></linearGradient></defs>
            <CartesianGrid strokeDasharray={chartTheme.grid.strokeDasharray} stroke={chartTheme.grid.stroke} vertical={chartTheme.grid.vertical} />
            <XAxis dataKey="d" {...chartTheme.axis} />
            <YAxis {...chartTheme.axis} />
            <Tooltip contentStyle={{ ...chartTheme.tooltip }} cursor={{ stroke: 'var(--chart-2)', strokeDasharray: '4 4' }} />
            <Area type="monotone" dataKey="a" stroke="var(--chart-1)" fill="url(#ds-rev)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </SectionCard>
      <SectionCard title={t('dsCharts')}>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={CHART_DATA}>
            <CartesianGrid strokeDasharray={chartTheme.grid.strokeDasharray} stroke={chartTheme.grid.stroke} vertical={chartTheme.grid.vertical} />
            <XAxis dataKey="d" {...chartTheme.axis} />
            <YAxis {...chartTheme.axis} />
            <Tooltip contentStyle={{ ...chartTheme.tooltip }} cursor={{ fill: 'var(--chart-1)', opacity: 0.06 }} />
            <Bar dataKey="b" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </SectionCard>
    </div>
  )
}

// ─── Workflow status system (§9) ───────────────────────────────────────────
export function DsStatuses() {
  const { t, lang } = useApp()
  const l = (fa: string, en: string) => (lang === 'fa' ? fa : en)
  return (
    <SectionCard title={t('dsStatus')}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(status) as StatusToken[]).map((k) => (
            <span key={k} className={`rounded-md px-2.5 py-1 text-xs ${statusClass[k]}`}>{k}</span>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {CASE_STATUS.map((s) => <StatusBadge key={s} status={s} />)}
        </div>
        <p className="text-xs text-muted-foreground">{l('چیپ‌ها mode-invariant هستند و همه جفت‌های متن/زمینه ≥ ۴.۵:۱ دارند (ED-82).', 'Chips are mode-invariant; every fg/bg pair is ≥ 4.5:1 (ED-82).')}</p>
      </div>
    </SectionCard>
  )
}

// ─── Four states (§31/§32) ─────────────────────────────────────────────────
export function DsStates() {
  const { t, lang } = useApp()
  const l = (fa: string, en: string) => (lang === 'fa' ? fa : en)
  const [demo, setDemo] = useState<'loading' | 'error' | 'empty' | 'success'>('empty')
  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <CardLike><EmptyState title={l('نسخه‌ای نیست', 'No prescriptions')} hint={l('پس از ارزیابی اولیه، نسخه اینجا نمایش داده می‌شود.', 'After initial assessment your prescription appears here.')} /></CardLike>
        <CardLike><LoadingRows rows={3} /></CardLike>
        <CardLike><ErrorState message={l('خطای شبکه — اتصال را بررسی کنید.', 'Network error — check connection.')} onRetry={() => toast(l('تلاش مجدد…', 'Retrying…'))} /></CardLike>
        <CardLike><SuccessState message={l('پرداخت با موفقیت تأیید شد.', 'Payment confirmed successfully.')} action={<Button size="sm" variant="outline">{t('receipt')}</Button>} /></CardLike>
      </div>
      <SectionCard title={`${t('dsStates')} — PageState`}>
        <div className="flex flex-wrap gap-2 mb-3">
          {(['loading', 'error', 'empty', 'success'] as const).map((s) => (
            <Button key={s} size="sm" variant={demo === s ? 'default' : 'outline'} onClick={() => setDemo(s)}>{s}</Button>
          ))}
        </div>
        <div className="rounded-lg border min-h-32">
          <PageState
            loading={demo === 'loading'} skeleton="card"
            error={demo === 'error' ? l('HTTP 500 — سرور پاسخ نداد', 'HTTP 500 — server did not respond') : null}
            empty={demo === 'empty'}
            emptyTitle={l('موردی نیست', 'Nothing here yet')}
            emptyHint={l('برای شروع، یک پرونده جدید بسازید.', 'Start by creating a new case.')}
            onRetry={() => setDemo('success')}
          >
            {demo === 'success' ? <SuccessState message={l('داده‌ها با موفقیت بارگذاری شدند.', 'Data loaded successfully.')} /> : <div className="p-4 text-sm text-muted-foreground">{l('محتوای واقعی صفحه اینجا قرار می‌گیرد.', 'Real page content renders here.')}</div>}
          </PageState>
        </div>
        <div className="grid sm:grid-cols-2 gap-3 mt-3">
          <LoadingCard lines={2} />
          <CardLike><EmptyState text /></CardLike>
        </div>
      </SectionCard>
    </div>
  )
}

function CardLike({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border bg-card shadow-card p-3">{children}</div>
}
