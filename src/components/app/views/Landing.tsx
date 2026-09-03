'use client'
import React from 'react'
import { useApp } from '@/contexts/app'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Logo } from '@/components/app/shared/Logo'
import { ScanHeart, ShieldCheck, UserCheck, Stethoscope, Truck, Bot, Languages, CheckCircle2, Activity } from 'lucide-react'

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
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-[#173F76]/[0.05] via-background to-[#57AFE2]/[0.07] dark:from-[#173F76]/20 dark:via-background dark:to-[#57AFE2]/10">
      <header className="h-16 flex items-center px-4 md:px-8 max-w-6xl w-full mx-auto">
        <button onClick={() => navigate('landing')} className="flex items-center gap-2" aria-label={t('appName')}>
          <Logo size={38} variant="dark" showText textClassName="text-lg" />
        </button>
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
            <Badge className="bg-[#57AFE2]/15 text-[#173F76] dark:text-[#9CCBEF] border-[#57AFE2]/30 hover:bg-[#57AFE2]/15">
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
            <Card className="overflow-hidden border-brand-neutral shadow-xl shadow-[#173F76]/10">
              <CardContent className="p-0">
                <div className="bg-[#173F76] p-8 flex items-center justify-center relative overflow-hidden">
                  {/* subtle AI scan grid */}
                  <div className="absolute inset-0 opacity-[0.14]" style={{ backgroundImage: 'linear-gradient(rgba(87,175,226,.6) 1px, transparent 1px), linear-gradient(90deg, rgba(87,175,226,.6) 1px, transparent 1px)', backgroundSize: '26px 26px' }} />
                  <div className="relative">
                    {/* stylized tongue mark in brand colors */}
                    <svg width="130" height="130" viewBox="0 0 100 100" fill="none" aria-hidden="true" className="drop-shadow-lg">
                      <path d="M50 12 C69 12 80 27 80 46 C80 71 66 88 50 88 C34 88 20 71 20 46 C20 27 31 12 50 12 Z" fill="#57AFE2" />
                      <path d="M50 28 C53 40 53 58 50 74" stroke="#173F76" strokeWidth="4" strokeLinecap="round" opacity="0.5" />
                      <line x1="10" y1="40" x2="90" y2="40" stroke="#FFFFFF" strokeWidth="5" strokeLinecap="round" opacity="0.92" />
                    </svg>
                    <div className="absolute -top-2 -end-5 size-9 rounded-full bg-[#57AFE2] text-[#173F76] flex items-center justify-center shadow-lg"><CheckCircle2 size={18} /></div>
                  </div>
                </div>
                <div className="p-4 space-y-2.5">
                  {[['رنگ بدنه: طبیعی', 'Body color: normal', 78, '#57AFE2'], ['پوشش: سفید غلیظ', 'Coating: thick white', 85, '#225BBE'], ['رطوبت: معتدل', 'Moisture: moderate', 61, '#57AFE2']].map(([fa, en, conf, bar]) => (
                    <div key={fa as string} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <span className="size-2 rounded-full" style={{ backgroundColor: bar as string }} />
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
              <Card key={i} className="border-brand-neutral">
                <CardContent className="p-5 flex items-start gap-4">
                  <div className="size-10 rounded-lg bg-[#173F76]/10 text-[#173F76] dark:bg-[#57AFE2]/15 dark:text-[#57AFE2] flex items-center justify-center shrink-0">{s.icon}</div>
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
                <div className="size-11 rounded-xl bg-[#57AFE2]/15 text-[#225BBE] dark:text-[#57AFE2] flex items-center justify-center">{f.icon}</div>
                <div className="font-bold">{f.title}</div>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              </CardContent>
            </Card>
          ))}
        </section>
      </main>

      <footer className="bg-[#173F76] dark:bg-[#0F2440] text-white/80 py-5 px-4 text-center text-xs">
        © 2026 {t('appName')} · {t('appDesc')}
      </footer>
    </div>
  )
}
