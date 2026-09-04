'use client'
// BabaHakim Auth (§10–11): brand login/register — clean, professional,
// Primary Dark #173F76 brand panel + Primary Blue #225BBE CTA
//
// PHASE 09 (ED-111): controlled forms validated client-side with zod mirrors
// (src/lib/forms.ts) — identical messages to the server DTO; server stays
// authoritative. Login/register now store the server-issued permissions (S1).
import React, { useState } from 'react'
import { useApp } from '@/contexts/app'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'
import { Logo } from '@/components/app/shared/Logo'
import { TextField } from '@/components/app/shared/form'
import { loginFormSchema, registerFormSchema, zodFieldErrors } from '@/lib/forms'
import { Languages, LogIn, UserPlus, ShieldCheck, Bot, Stethoscope } from 'lucide-react'

const DEMO = [
  { role: 'مدیر سیستم', roleEn: 'Admin', phone: '09120000001' },
  { role: 'کارشناس اول', roleEn: 'Expert 1', phone: '09120000002' },
  { role: 'کارشناس دوم', roleEn: 'Expert 2', phone: '09120000003' },
  { role: 'اپراتور', roleEn: 'Operator', phone: '09120000004' },
  { role: 'پزشک', roleEn: 'Doctor', phone: '09120000005' },
  { role: 'بیمار (سارا)', roleEn: 'Patient (Sara)', phone: '09120000006' },
]

interface LoginFields { phone: string; password: string }
interface RegisterFields { phone: string; password: string; firstName: string; lastName: string; referralCode: string }

export function AuthView() {
  const { t, lang, setLang, navigate, setSession, api } = useApp()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [busy, setBusy] = useState(false)
  const [login, setLogin] = useState<LoginFields>({ phone: '', password: '' })
  const [reg, setReg] = useState<RegisterFields>({ phone: '', password: '', firstName: '', lastName: '', referralCode: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})

  async function submitLogin(e: React.FormEvent) {
    e.preventDefault()
    setErrors({})
    const parsed = loginFormSchema.safeParse(login)
    if (!parsed.success) { setErrors(zodFieldErrors(parsed.error)); return }
    setBusy(true)
    try {
      const data = await api<{ user: { id: string; phone: string; role: string; firstName: string; lastName: string; referralCode?: string }; permissions?: string[] }>('/api/v1/auth/login', { method: 'POST', json: parsed.data })
      setSession(data.user, data.permissions)
      toast.success(`${t('login')} ✓`)
      navigate('dashboard')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function submitRegister(e: React.FormEvent) {
    e.preventDefault()
    setErrors({})
    const parsed = registerFormSchema.safeParse(reg)
    if (!parsed.success) { setErrors(zodFieldErrors(parsed.error)); return }
    setBusy(true)
    try {
      const data = await api<{ user: { id: string; phone: string; role: string; firstName: string; lastName: string; referralCode?: string }; permissions?: string[] }>('/api/v1/auth/register', { method: 'POST', json: { ...parsed.data, acceptTerms: true } })
      setSession(data.user, data.permissions)
      toast.success(`${t('register')} ✓`)
      navigate('dashboard')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function quickLogin(phone: string) {
    setBusy(true)
    try {
      const data = await api<{ user: { id: string; phone: string; role: string; firstName: string; lastName: string }; permissions?: string[] }>('/api/v1/auth/login', { method: 'POST', json: { phone, password: 'Pass1234' } })
      setSession(data.user, data.permissions)
      navigate('dashboard')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-brand-dark/5 to-background dark:from-brand-dark/25 dark:to-background">
      <header className="h-16 flex items-center px-4 md:px-8 max-w-6xl w-full mx-auto">
        <button onClick={() => navigate('landing')} className="flex items-center gap-2" aria-label={t('appName')}>
          <Logo size={34} variant="dark" showText />
        </button>
        <Button variant="ghost" size="sm" className="ms-auto gap-1.5" onClick={() => setLang(lang === 'fa' ? 'en' : 'fa')} aria-label={t('switchLang')}>
          <Languages size={16} /> {lang === 'fa' ? 'English' : 'فارسی'}
        </Button>
      </header>
      <main className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-5xl grid lg:grid-cols-[1.1fr_1fr] gap-8 items-stretch">

          {/* Brand panel (§10) — Primary Dark */}
          <div className="hidden lg:flex flex-col justify-between rounded-2xl bg-brand-dark dark:bg-sidebar p-10 relative overflow-hidden">
            <div className="absolute inset-0 opacity-[0.12]" style={{ backgroundImage: 'linear-gradient(var(--bh-primary-light) 1px, transparent 1px), linear-gradient(90deg, var(--bh-primary-light) 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
            <div className="relative">
              <Logo size={56} variant="light" showText textClassName="text-white text-2xl" />
              <h2 className="mt-8 text-2xl font-black text-white leading-relaxed max-w-sm">
                {t('heroTitle')}
              </h2>
              <p className="mt-3 text-sm text-white/70 leading-relaxed max-w-sm">{t('heroSub')}</p>
            </div>
            <div className="relative space-y-3 mt-8">
              {[
                { icon: <Bot size={16} />, fa: 'تحلیل AI با نمایش اطمینان و نیاز به بررسی انسانی', en: 'AI analysis with confidence & human-review flags' },
                { icon: <ShieldCheck size={16} />, fa: 'بازبینی دومرحله‌ای کارشناسان و تأیید پزشک', en: 'Two-stage expert review and doctor approval' },
                { icon: <Stethoscope size={16} />, fa: 'تصاویر پزشکی فقط با لینک امن و موقت', en: 'Medical images served only via secure short-lived links' },
              ].map((f, i) => (
                <div key={i} className="flex items-start gap-3 text-[13px] text-white/85">
                  <span className="size-7 rounded-lg bg-brand-light/20 text-brand-light flex items-center justify-center shrink-0 mt-0.5">{f.icon}</span>
                  <span className="leading-relaxed">{lang === 'fa' ? f.fa : f.en}</span>
                </div>
              ))}
            </div>
            <p className="relative text-[11px] text-white/50 mt-6">{t('disclaimerMedical')}</p>
          </div>

          {/* Form + demo accounts */}
          <div className="space-y-4">
            <Card className="border-brand-neutral">
              <CardHeader>
                <CardTitle className="text-xl">{mode === 'login' ? t('loginTitle') : t('registerTitle')}</CardTitle>
                <CardDescription>{t('appDesc')}</CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs value={mode} onValueChange={(v) => { setMode(v as 'login' | 'register'); setErrors({}) }}>
                  <TabsList className="grid grid-cols-2 mb-4">
                    <TabsTrigger value="login" className="gap-1.5"><LogIn size={14} />{t('login')}</TabsTrigger>
                    <TabsTrigger value="register" className="gap-1.5"><UserPlus size={14} />{t('register')}</TabsTrigger>
                  </TabsList>
                  <TabsContent value="login">
                    <form onSubmit={submitLogin} className="space-y-4" noValidate>
                      <TextField label={t('phone')} value={login.phone} onChange={(e) => setLogin({ ...login, phone: e.target.value })} error={errors.phone} required dir="ltr" placeholder="0912…" inputMode="numeric" autoComplete="tel" />
                      <TextField label={t('password')} type="password" value={login.password} onChange={(e) => setLogin({ ...login, password: e.target.value })} error={errors.password} required dir="ltr" placeholder="••••••••" autoComplete="current-password" />
                      <Button type="submit" className="w-full btn-brand-hover" disabled={busy}>{t('login')}</Button>
                    </form>
                  </TabsContent>
                  <TabsContent value="register">
                    <form onSubmit={submitRegister} className="space-y-4" noValidate>
                      <div className="grid grid-cols-2 gap-3">
                        <TextField label={t('firstName')} value={reg.firstName} onChange={(e) => setReg({ ...reg, firstName: e.target.value })} error={errors.firstName} required autoComplete="given-name" />
                        <TextField label={t('lastName')} value={reg.lastName} onChange={(e) => setReg({ ...reg, lastName: e.target.value })} error={errors.lastName} required autoComplete="family-name" />
                      </div>
                      <TextField label={t('phone')} value={reg.phone} onChange={(e) => setReg({ ...reg, phone: e.target.value })} error={errors.phone} required dir="ltr" placeholder="0912…" inputMode="numeric" autoComplete="tel" />
                      <TextField label={t('password')} type="password" value={reg.password} onChange={(e) => setReg({ ...reg, password: e.target.value })} error={errors.password} required dir="ltr" hint={lang === 'fa' ? 'حداقل ۸ کاراکتر شامل حرف و رقم' : 'At least 8 characters with letters and digits'} autoComplete="new-password" />
                      <TextField label={t('referralCode')} value={reg.referralCode} onChange={(e) => setReg({ ...reg, referralCode: e.target.value })} error={errors.referralCode} dir="ltr" />
                      <Button type="submit" className="w-full btn-brand-hover" disabled={busy}>{t('register')}</Button>
                    </form>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            <div className="space-y-2">
              <div className="text-xs font-semibold text-muted-foreground">{t('demoAccounts')} — Pass1234</div>
              <div className="grid sm:grid-cols-2 gap-2">
                {DEMO.map((d) => (
                  <button key={d.phone} onClick={() => quickLogin(d.phone)} disabled={busy}
                    className="flex items-center justify-between rounded-lg border border-brand-neutral bg-card px-3.5 py-2 text-sm hover:border-primary hover:bg-brand-light/10 transition-colors disabled:opacity-50">
                    <span className="truncate">{lang === 'fa' ? d.role : d.roleEn}</span>
                    <span className="text-[11px] tabular-nums text-muted-foreground" dir="ltr">{d.phone}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
      <footer className="border-t border-brand-neutral py-4 text-center text-[11px] text-muted-foreground px-4">{t('disclaimerMedical')}</footer>
    </div>
  )
}
