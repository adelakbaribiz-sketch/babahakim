'use client'
import React from 'react'
import { useApp } from '@/contexts/app'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Sparkles, ScanHeart, ShieldCheck, UserCheck, Stethoscope, Truck, Bot, Languages, CheckCircle2, Activity } from 'lucide-react'

export function Landing() {
  const { t, lang, setLang, navigate } = useApp()

  const steps = [
    { icon: <UserCheck size={20} />, fa: 'ثبت‌نام و تکمیل پروفایل', en: 'Register & complete profile' },
    { icon: <Activity size={20} />, fa: 'پرسشنامه مزاج‌شناسی', en: 'Temperament questionnaire' },
    { icon: <ScanHeart size={20} />, fa: 'ارسال تصویر زبان و تحلیل AI', en: 'Upload tongue image → AI analysis' },
    { icon: <UserCheck size={20} />, fa: 'ارزیابی کارشناس اول + تأیید شما', en: 'Expert 1 assessment + your approval' },
    { icon: <Stethoscope size={20} />, fa: 'نسخه، بازبینی کارشناس دوم و تأیید پزشک', en: 'Prescription, Expert 2 review, doctor approval' },
    { icon: <Truck size={20} />, fa: 'پیش‌فاکتور، پرداخت و ارسال دارو', en: 'Proforma, payment & delivery' },
  ]

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-emerald-50 via-background to-teal-50/50 dark:from-emerald-950/30 dark:via-background dark:to-teal-950/20">
      <header className="h-16 flex items-center px-4 md:px-8 max-w-6xl w-full mx-auto">
        <div className="flex items-center gap-2">
          <div className="size-9 rounded-xl bg-primary text-primary-foreground flex items-center justify-center"><Sparkles size={20} /></div>
          <span className="font-bold text-lg">{t('appName')}</span>
        </div>
        <div className="ms-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setLang(lang === 'fa' ? 'en' : 'fa')} className="gap-1.5">
            <Languages size={16} /> {lang === 'fa' ? 'English' : 'فارسی'}
          </Button>
          <Button size="sm" onClick={() => navigate('login')}>{t('login')}</Button>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 md:px-8 py-10 md:py-16">
        <section className="grid lg:grid-cols-2 gap-10 items-center">
          <div className="space-y-6">
            <Badge className="bg-primary/10 text-primary border-primary/20 hover:bg-primary/10">
              <Bot size={13} className="me-1" /> AI-Assisted Clinical Decision Support
            </Badge>
            <h1 className="text-3xl md:text-5xl font-black leading-tight tracking-tight">
              {t('heroTitle')}
            </h1>
            <p className="text-muted-foreground text-base md:text-lg leading-relaxed max-w-xl">{t('heroSub')}</p>
            <div className="flex flex-wrap gap-3">
              <Button size="lg" onClick={() => navigate('register')} className="h-12 px-8 text-base">{t('getStarted')}</Button>
              <Button size="lg" variant="outline" onClick={() => navigate('login')} className="h-12 px-8 text-base">{t('loginTitle')}</Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('disclaimerMedical')}</p>
          </div>
          <div className="relative">
            <Card className="overflow-hidden border-2 border-primary/15 shadow-xl">
              <CardContent className="p-0">
                <div className="bg-gradient-to-br from-emerald-500/10 to-teal-500/10 p-6 flex items-center justify-center">
                  <div className="relative">
                    <div className="text-8xl select-none" style={{ filter: 'drop-shadow(0 10px 15px rgb(13 148 136 / 0.3))' }}>👅</div>
                    <div className="absolute -top-2 -end-6 size-9 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-lg"><CheckCircle2 size={18} /></div>
                  </div>
                </div>
                <div className="p-4 space-y-2.5">
                  {[['رنگ بدنه: طبیعی', 'Body color: normal', 78], ['پوشش: سفید غلیظ', 'Coating: thick white', 85], ['رطوبت: معتدل', 'Moisture: moderate', 61]].map(([fa, en, conf]) => (
                    <div key={fa as string} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <span className="size-2 rounded-full bg-primary" />
                        {lang === 'fa' ? fa : en}
                      </span>
                      <span className="tabular-nums text-xs text-muted-foreground">
                        {lang === 'fa' ? `${new Intl.NumberFormat('fa-IR').format(conf as number)}٪` : `${conf}%`}
                      </span>
                    </div>
                  ))}
                  <div className="pt-2 text-[11px] text-muted-foreground border-t">{t('aiDisclaimer')}</div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="mt-16">
          <h2 className="text-xl font-bold mb-6">{t('howItWorks')}</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {steps.map((s, i) => (
              <Card key={i} className="border-border/60">
                <CardContent className="p-5 flex items-start gap-4">
                  <div className="size-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">{s.icon}</div>
                  <div>
                    <div className="text-xs text-muted-foreground">{t('step')} {lang === 'fa' ? new Intl.NumberFormat('fa-IR').format(i + 1) : i + 1}</div>
                    <div className="font-medium text-sm leading-relaxed">{lang === 'fa' ? s.fa : s.en}</div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="mt-14 grid md:grid-cols-3 gap-4">
          {[
            { icon: <Bot size={22} />, title: t('feature1Title'), desc: t('feature1Desc') },
            { icon: <ShieldCheck size={22} />, title: t('feature2Title'), desc: t('feature2Desc') },
            { icon: <ScanHeart size={22} />, title: t('feature3Title'), desc: t('feature3Desc') },
          ].map((f, i) => (
            <Card key={i} className="border-border/60">
              <CardContent className="p-5 space-y-3">
                <div className="size-11 rounded-xl bg-teal-500/10 text-teal-600 dark:text-teal-400 flex items-center justify-center">{f.icon}</div>
                <div className="font-bold">{f.title}</div>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              </CardContent>
            </Card>
          ))}
        </section>
      </main>

      <footer className="border-t py-5 px-4 text-center text-xs text-muted-foreground">
        © 2026 {t('appName')} · {t('appDesc')}
      </footer>
    </div>
  )
}
