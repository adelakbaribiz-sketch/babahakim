'use client'
import React, { useState } from 'react'
import { useApp } from '@/contexts/app'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'
import { Sparkles, Languages, LogIn, UserPlus } from 'lucide-react'

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
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-emerald-50 to-background dark:from-emerald-950/30 dark:to-background">
      <header className="h-16 flex items-center px-4 md:px-8 max-w-6xl w-full mx-auto">
        <button onClick={() => navigate('landing')} className="flex items-center gap-2">
          <div className="size-9 rounded-xl bg-primary text-primary-foreground flex items-center justify-center"><Sparkles size={20} /></div>
          <span className="font-bold text-lg">{t('appName')}</span>
        </button>
        <Button variant="ghost" size="sm" className="ms-auto gap-1.5" onClick={() => setLang(lang === 'fa' ? 'en' : 'fa')}>
          <Languages size={16} /> {lang === 'fa' ? 'English' : 'فارسی'}
        </Button>
      </header>
      <main className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-4xl grid lg:grid-cols-2 gap-8 items-center">
          <Card className="w-full max-w-md mx-auto">
            <CardHeader>
              <CardTitle>{mode === 'login' ? t('loginTitle') : t('registerTitle')}</CardTitle>
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
                    <Button type="submit" className="w-full" disabled={busy}>{t('login')}</Button>
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
                    <Button type="submit" className="w-full" disabled={busy}>{t('register')}</Button>
                  </form>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          <div className="hidden lg:block space-y-3">
            <div className="text-sm font-semibold text-muted-foreground">{t('demoAccounts')} — Pass1234</div>
            {DEMO.map((d) => (
              <button key={d.phone} onClick={() => quickLogin(d.phone)} disabled={busy}
                className="w-full flex items-center justify-between rounded-lg border bg-card px-4 py-2.5 text-sm hover:bg-muted transition-colors">
                <span>{lang === 'fa' ? d.role : d.roleEn}</span>
                <span className="text-xs tabular-nums text-muted-foreground" dir="ltr">{d.phone}</span>
              </button>
            ))}
          </div>
        </div>
      </main>
      <footer className="border-t py-4 text-center text-[11px] text-muted-foreground px-4">{t('disclaimerMedical')}</footer>
    </div>
  )
}

function Field({ label, name, type = 'text', placeholder, required, dir }: { label: string; name: string; type?: string; placeholder?: string; required?: boolean; dir?: 'ltr' | 'rtl' }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type} placeholder={placeholder} required={required} dir={dir} autoComplete="off" />
    </div>
  )
}
