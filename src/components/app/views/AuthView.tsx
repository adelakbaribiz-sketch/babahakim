'use client'
// BabaHakim Auth (§10–11): brand login/register — clean, professional,
// Primary Dark #173F76 brand panel + Primary Blue #225BBE CTA
import React, { useState } from 'react'
import { useApp } from '@/contexts/app'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'
import { Logo } from '@/components/app/shared/Logo'
import { Languages, LogIn, UserPlus, ShieldCheck, Bot, Stethoscope } from 'lucide-react'

const DEMO = [
  { role: 'مدیر سیستم', roleEn: 'Admin', phone: '09120000001' },
  { role: 'کارشناس اول', roleEn: 'Expert 1', phone: '09120000002' },
  { role: 'کارشناس دوم', roleEn: 'Expert 2', phone: '09120000003' },
  { role: 'اپراتور', roleEn: 'Operator', phone: '09120000004' },
  { role: 'پزشک', roleEn: 'Doctor', phone: '09120000005' },
  { role: 'بیمار (سارا)', roleEn: 'Patient (Sara)', phone: '09120000006' },
]

export function AuthView() {
  const { t, lang, setLang, navigate, setUser, api } = useApp()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setBusy(true)
    try {
      const payload = Object.fromEntries(form.entries())
      const path = mode === 'login' ? '/api/v1/auth/login' : '/api/v1/auth/register'
      const data = await api<{ user: { id: string; phone: string; role: string; firstName: string; lastName: string; referralCode?: string } }>(path, { method: 'POST', json: payload })
      setUser(data.user)
      toast.success(mode === 'login' ? `${t('login')} ✓` : `${t('register')} ✓`)
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
      const data = await api<{ user: { id: string; phone: string; role: string; firstName: string; lastName: string } }>('/api/v1/auth/login', { method: 'POST', json: { phone, password: 'Pass1234' } })
      setUser(data.user)
      navigate('dashboard')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-[#173F76]/[0.05] to-background dark:from-[#173F76]/25 dark:to-background">
      <header className="h-16 flex items-center px-4 md:px-8 max-w-6xl w-full mx-auto">
        <button onClick={() => navigate('landing')} className="flex items-center gap-2" aria-label={t('appName')}>
          <Logo size={34} variant="dark" showText />
        </button>
        <Button variant="ghost" size="sm" className="ms-auto gap-1.5" onClick={() => setLang(lang === 'fa' ? 'en' : 'fa')}>
          <Languages size={16} /> {lang === 'fa' ? 'English' : 'فارسی'}
        </Button>
      </header>
      <main className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-5xl grid lg:grid-cols-[1.1fr_1fr] gap-8 items-stretch">

          {/* Brand panel (§10) — Primary Dark */}
          <div className="hidden lg:flex flex-col justify-between rounded-2xl bg-[#173F76] dark:bg-[#0F2440] p-10 relative overflow-hidden">
            <div className="absolute inset-0 opacity-[0.12]" style={{ backgroundImage: 'linear-gradient(rgba(87,175,226,.6) 1px, transparent 1px), linear-gradient(90deg, rgba(87,175,226,.6) 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
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
                  <span className="size-7 rounded-lg bg-[#57AFE2]/20 text-[#57AFE2] flex items-center justify-center shrink-0 mt-0.5">{f.icon}</span>
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
                <Tabs value={mode} onValueChange={(v) => setMode(v as 'login' | 'register')}>
                  <TabsList className="grid grid-cols-2 mb-4">
                    <TabsTrigger value="login" className="gap-1.5"><LogIn size={14} />{t('login')}</TabsTrigger>
                    <TabsTrigger value="register" className="gap-1.5"><UserPlus size={14} />{t('register')}</TabsTrigger>
                  </TabsList>
                  <TabsContent value="login">
                    <form onSubmit={submit} className="space-y-4">
                      <Field label={t('phone')} name="phone" placeholder="0912…" required dir="ltr" />
                      <Field label={t('password')} name="password" type="password" placeholder="••••••••" required dir="ltr" />
                      <Button type="submit" className="w-full btn-brand-hover" disabled={busy}>{t('login')}</Button>
                    </form>
                  </TabsContent>
                  <TabsContent value="register">
                    <form onSubmit={submit} className="space-y-4">
                      <div className="grid grid-cols-2 gap-3">
                        <Field label={t('firstName')} name="firstName" required />
                        <Field label={t('lastName')} name="lastName" required />
                      </div>
                      <Field label={t('phone')} name="phone" placeholder="0912…" required dir="ltr" />
                      <Field label={t('password')} name="password" type="password" required dir="ltr" />
                      <Field label={t('referralCode')} name="referralCode" dir="ltr" />
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
                    className="flex items-center justify-between rounded-lg border border-brand-neutral bg-card px-3.5 py-2 text-sm hover:border-[#225BBE] hover:bg-[#57AFE2]/[0.06] transition-colors disabled:opacity-50">
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

function Field({ label, name, type = 'text', placeholder, required, dir }: { label: string; name: string; type?: string; placeholder?: string; required?: boolean; dir?: 'ltr' | 'rtl' }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name} className="text-[#173F76] dark:text-[#CFE4F5]">{label}</Label>
      <Input id={name} name={name} type={type} placeholder={placeholder} required={required} dir={dir} autoComplete="off" />
    </div>
  )
}
