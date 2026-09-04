'use client'
// Design System living style guide (PHASE 07, ED-85).
// Route: in-app view "designSystem" (SPA constraint — single / route).
// Purpose: §37 order (tokens→theme→typography→spacing→components→layout→responsive)
// rendered live for QA per §38; docs at docs/DESIGN-SYSTEM.md.
import React, { useState } from 'react'
import { useTheme } from 'next-themes'
import { useApp } from '@/contexts/app'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Logo } from '@/components/app/shared/Logo'
import { brand, brandDerived, spacing, breakpoints, grid, radius, iconSize } from '@/design-system/tokens'
import { DsForms, DsTables, DsCards, DsDialogs, DsNavigation, DsNotifications, DsCharts, DsStatuses, DsStates } from './ds/DsShowcase'
import { ArrowLeft, ArrowRight, Moon, Sun, Languages, LayoutDashboard, Bot, CheckCircle2, Heart, ShieldCheck, Bot as BotIcon } from 'lucide-react'

const SWATCHES: { name: string; hex: string; usageFa: string; usageEn: string; className: string }[] = [
  { name: 'Primary Dark', hex: brand.primaryDark, usageFa: 'هدر، سایدبار، فوتر، تیترهای مهم', usageEn: 'Header, sidebar, footer, key titles', className: 'bg-brand-dark' },
  { name: 'Primary Blue', hex: brand.primary, usageFa: 'دکمه اصلی، CTA، تب فعال', usageEn: 'Primary button, CTA, active tab', className: 'bg-brand' },
  { name: 'Sky Blue', hex: brand.primaryLight, usageFa: 'اکنت ثانویه، نمودار، هایلایت، Progress', usageEn: 'Secondary accent, charts, highlight, progress', className: 'bg-brand-light' },
  { name: 'Neutral Gray', hex: brand.neutral, usageFa: 'حاشیه، جداکننده، پس‌زمینه خنثی', usageEn: 'Border, divider, neutral surface', className: 'bg-brand-neutral' },
  { name: 'White', hex: brand.white, usageFa: 'سطح پایه برای خوانایی (§5)', usageEn: 'Base surface for readability (§5)', className: 'bg-white border' },
]

const DERIVED = [
  { k: 'hover', v: brandDerived.primaryHover }, { k: 'active', v: brandDerived.primaryActive },
  { k: 'sky-15', v: brandDerived.sky15 }, { k: 'sky-25', v: brandDerived.sky25 },
  { k: 'navy-08', v: brandDerived.navy08 }, { k: 'navy-15', v: brandDerived.navy15 },
  { k: 'navy-30', v: brandDerived.navy30 }, { k: 'navy-60', v: brandDerived.navy60 },
  { k: 'ink', v: brandDerived.ink }, { k: 'neutral-40', v: brandDerived.neutral40 },
]

export function DesignSystemView({ navigate }: { navigate: (p: string, params?: Record<string, string>) => void }) {
  const { t, lang, setLang, user } = useApp()
  const { resolvedTheme, setTheme } = useTheme()
  const l = (fa: string, en: string) => (lang === 'fa' ? fa : en)
  const dark = resolvedTheme === 'dark'
  const Arrow = lang === 'fa' ? ArrowLeft : ArrowRight

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="h-16 border-b border-border bg-background/95 backdrop-blur sticky top-0 z-40 flex items-center gap-3 px-4">
        <Logo size={34} variant="dark" showText />
        <Badge variant="secondary" className="ms-2">{t('designSystem')} · v1.0</Badge>
        <div className="ms-auto flex items-center gap-1.5">
          <Button variant="ghost" size="icon" aria-label="Theme" onClick={() => setTheme(dark ? 'light' : 'dark')}>
            {dark ? <Sun size={17} className="text-brand-light" /> : <Moon size={17} />}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setLang(lang === 'fa' ? 'en' : 'fa')} className="gap-1.5">
            <Languages size={16} /> {lang === 'fa' ? 'EN' : 'فا'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate(user ? 'dashboard' : 'landing')} className="gap-1.5">
            <Arrow size={15} /> {user ? t('dashboard') : t('back')}
          </Button>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-8 space-y-8">
        <section className="space-y-2">
          <h1 className="text-display">{t('designSystem')}</h1>
          <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">{t('dsIntro')}</p>
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground pt-1">
            <span className="rounded-full border px-2.5 py-1">Vazirmatn · §23</span>
            <span className="rounded-full border px-2.5 py-1">RTL/LTR · §24</span>
            <span className="rounded-full border px-2.5 py-1">Dark Mode · §28</span>
            <span className="rounded-full border px-2.5 py-1">WCAG AA · §34</span>
            <span className="rounded-full border px-2.5 py-1">Design Tokens · §27/§39</span>
          </div>
        </section>

        {/* §2-4 Brand palette */}
        <section className="space-y-3">
          <h2 className="text-title flex items-center gap-2"><Bot size={18} className="text-primary" />{t('dsColors')}</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {SWATCHES.map((s) => (
              <div key={s.name} className="rounded-xl border bg-card shadow-card overflow-hidden">
                <div className={`h-16 ${s.className}`} />
                <div className="p-3 space-y-1">
                  <div className="text-sm font-semibold">{s.name}</div>
                  <code className="text-xs text-muted-foreground" dir="ltr">{s.hex}</code>
                  <div className="text-[11px] text-muted-foreground leading-relaxed">{l(s.usageFa, s.usageEn)}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-xl border bg-card shadow-card p-4">
            <div className="text-xs font-medium text-muted-foreground mb-2">{l('سایه‌های مشتق‌شده (فقط از ۴ رنگ برند — §3)', 'Derived shades (only from the 4 brand colors — §3)')}</div>
            <div className="flex flex-wrap gap-2">
              {DERIVED.map((d) => (
                <span key={d.k} className="flex items-center gap-1.5 rounded-md border ps-1 pe-2.5 py-1 text-[11px]">
                  <span className="size-4 rounded" style={{ backgroundColor: d.v }} />
                  <code dir="ltr">{d.k}</code>
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* §23 Typography */}
        <section className="space-y-3">
          <h2 className="text-title">{t('dsTypography')}</h2>
          <div className="rounded-xl border bg-card shadow-card p-5 space-y-3">
            <div className="text-display">{l('عنوان نمایشی — باباحکیم', 'Display heading — BabaHakim')}</div>
            <div className="text-2xl font-bold">{l('عنوان H1 — متن عنوان صفحه', 'H1 — page title text')}</div>
            <div className="text-xl font-bold">{l('عنوان H2 — عنوان بخش', 'H2 — section heading')}</div>
            <div className="text-lg font-semibold">{l('عنوان H3 — عنوان کارت', 'H3 — card heading')}</div>
            <div className="text-title">text-title — {l('عنوان معنایی', 'semantic title')}</div>
            <div className="text-base">{l('متن بدنه بزرگ — برای پاراگراف‌های مهم و خلاصه‌های بالینی استفاده می‌شود.', 'Large body — for key paragraphs and clinical summaries.')}</div>
            <div className="text-sm">{l('متن بدنه استاندارد — رایج‌ترین متن رابط کاربری در تمام صفحات.', 'Standard body — the most common UI text across all pages.')}</div>
            <div className="text-xs text-muted-foreground">{l('متن کمکی — راهنما و توضیحات فرم‌ها (Neutral Gray، هرگز برای متن کوچک خالص §34).', 'Caption — form hints and helper text (never pure Neutral Gray for small text, §34).')}</div>
            <div className="text-caption text-muted-foreground">text-caption — {l('ریز‌متن (۱۱px)', 'micro text (11px)')}</div>
            <div className="font-mono text-sm" dir="ltr">TC-1001 · 09123456789 · 2026-09-04</div>
            <p className="text-xs text-muted-foreground">{l('اعداد و کدها: tabular-nums و جهت LTR داخل dir="ltr" (§24).', 'Numbers & codes: tabular-nums, LTR inside dir="ltr" (§24).')}</p>
          </div>
        </section>

        {/* §37 spacing / radius / shadow */}
        <section className="space-y-3">
          <h2 className="text-title">{t('dsSpacing')}</h2>
          <div className="rounded-xl border bg-card shadow-card p-5 space-y-4">
            <div className="flex flex-wrap gap-3 items-end">
              {spacing.scale.filter((s) => s > 0).map((s) => (
                <div key={s} className="text-center">
                  <div className="rounded bg-brand-light/40 border border-brand-light/60" style={{ width: s * 2, height: s * 2 }} />
                  <code className="text-[10px] text-muted-foreground" dir="ltr">{s}px</code>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-3">
              <div className="rounded-sm border border-brand bg-brand-light/20 size-12 flex items-center justify-center text-[10px]">sm {radius.sm}</div>
              <div className="rounded-md border border-brand bg-brand-light/20 size-12 flex items-center justify-center text-[10px]">md {radius.md}</div>
              <div className="rounded-lg border border-brand bg-brand-light/20 size-12 flex items-center justify-center text-[10px]">lg {radius.lg}</div>
              <div className="rounded-xl border border-brand bg-brand-light/20 size-12 flex items-center justify-center text-[10px]">xl {radius.xl}</div>
              <div className="rounded-lg border bg-card shadow-card size-12 flex items-center justify-center text-[10px]">shadow-card</div>
              <div className="rounded-lg border bg-card shadow-card-hover size-12 flex items-center justify-center text-[10px]">hover</div>
            </div>
            <p className="text-xs text-muted-foreground">{l('شبکه ۴px پایه · کارت p-4/p-6 · gap-4 بین کارت‌ها · max-w-1400 محتوا · سایدبار 288px · هدر 64px.', '4px base grid · card p-4/p-6 · gap-4 between cards · 1400px content max · 288px sidebar · 64px header.')}</p>
          </div>
        </section>

        {/* §8 Buttons */}
        <section className="space-y-3">
          <h2 className="text-title">{t('dsButtons')}</h2>
          <div className="rounded-xl border bg-card shadow-card p-5 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button className="btn-brand-hover">{l('دکمه اصلی', 'Primary')}</Button>
              <Button variant="secondary">{l('دکمه ثانویه', 'Secondary')}</Button>
              <Button className="bg-brand-light text-status-info-fg hover:bg-brand-light/85">{l('دکمه اکنت', 'Accent')}</Button>
              <Button variant="outline">{l('دکمه لبه‌دار', 'Outline')}</Button>
              <Button variant="ghost">{l('دکمه شبح', 'Ghost')}</Button>
              <Button variant="destructive">{l('دکمه مخرب', 'Destructive')}</Button>
              <Button variant="link">{l('لینک', 'Link')}</Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm">{l('کوچک', 'Small')}</Button>
              <Button size="default">{l('پیش‌فرض', 'Default')}</Button>
              <Button size="lg">{l('بزرگ', 'Large')}</Button>
              <Button size="icon" aria-label="icon"><CheckCircle2 size={16} /></Button>
              <Button disabled>{l('غیرفعال — ترکیب خنثی #DEDBDB (§8)', 'Disabled — neutral #DEDBDB mix (§8)')}</Button>
              <Button><span className="size-4 rounded-full border-2 border-white/40 border-t-white animate-spin" aria-hidden /> {l('در حال انجام…', 'Working…')}</Button>
            </div>
            <p className="text-xs text-muted-foreground">{l('دکمه اکنت فقط برای متن درشت/بولد (کنتراست 4.31:1 — ED-87).', 'Accent button only for large/bold labels (contrast 4.31:1 — ED-87).')}</p>
          </div>
        </section>

        {/* Icons */}
        <section className="space-y-3">
          <h2 className="text-title">{t('dsIcons')}</h2>
          <div className="rounded-xl border bg-card shadow-card p-5 flex flex-wrap items-end gap-6">
            {(['xs', 'sm', 'md', 'lg'] as const).map((k) => (
              <div key={k} className="text-center space-y-1">
                <BotIcon size={iconSize[k]} className="text-primary mx-auto" />
                <code className="text-[10px] text-muted-foreground" dir="ltr">{k} · {iconSize[k]}px</code>
              </div>
            ))}
            <div className="ps-6 border-s border-border space-y-2">
              <div className="flex items-center gap-2 text-sm">
                {lang === 'fa' ? <ArrowRight size={16} /> : <ArrowLeft size={16} />}
                <span className="text-xs text-muted-foreground">{l('آیکون‌های جهت‌دار با زبان برعکس می‌شوند (§24)', 'Directional icons flip with language (§24)')}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Heart size={16} className="text-destructive" /><ShieldCheck size={16} className="text-status-success" />
                <span className="text-xs text-muted-foreground">{l('رنگ آیکون فقط از توکن', 'Icon color from tokens only')}</span>
              </div>
            </div>
          </div>
        </section>

        {/* §9 statuses + states */}
        <DsStatuses />
        <DsStates />

        {/* Components */}
        <DsForms />
        <DsTables />
        <DsCards />
        <section className="space-y-3">
          <h2 className="text-title">{t('dsDialogs')}</h2>
          <DsDialogs />
        </section>
        <DsNavigation />
        <DsNotifications />
        <section className="space-y-3">
          <h2 className="text-title">{t('dsCharts')}</h2>
          <DsCharts />
        </section>

        {/* §29 responsive */}
        <section className="space-y-3">
          <h2 className="text-title">{t('dsBreakpoints')}</h2>
          <div className="rounded-xl border bg-card shadow-card p-5">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center text-xs">
              {Object.entries(breakpoints).map(([k, v]) => (
                <div key={k} className="rounded-lg border bg-muted/50 py-2.5">
                  <code dir="ltr" className="font-semibold">{k}</code>
                  <div className="text-muted-foreground" dir="ltr">≥ {v}px</div>
                </div>
              ))}
            </div>
            <ul className="text-xs text-muted-foreground mt-4 space-y-1.5 list-disc ps-5">
              <li>{l('بیمار: Mobile-First — ناوبری ساده، CTA بزرگ، آپلود آسان، جدول‌ها به کارت تبدیل می‌شوند (§29).', 'Patient: mobile-first — simple nav, large CTAs, easy upload, tables become cards (§29).')}</li>
              <li>{l('کارکنان: Desktop-First — چیدمان سه‌ستونی §80، صف سریع، ترکیبات کلیدی.', 'Staff: desktop-first — three-column §80 layout, fast queue, keyboard combos.')}</li>
              <li>{l('سایدبار دسکتاپ 288px، در موبایل Sheet + هدر 64px چسبان.', 'Desktop sidebar 288px; on mobile a Sheet + sticky 64px header.')}</li>
            </ul>
          </div>
        </section>
      </main>

      <footer className="mt-auto bg-brand-dark dark:bg-sidebar text-white/80 py-4 px-4 text-center text-xs">
        {t('appName')} — {t('designSystem')} · {l('ممیزی یکپارچگی', 'Consistency audit')}: <code dir="ltr">bun run audit:ui</code>
        <button onClick={() => navigate(user ? 'dashboard' : 'landing')} className="footer-link">{user ? t('dashboard') : t('back')}</button>
      </footer>
    </div>
  )
}
