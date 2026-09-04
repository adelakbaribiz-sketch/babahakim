# BabaHakim — Design System & Branding (برندینگ باباحکیم)

> منبع: «BabaHakim Master UI Branding Prompt» (§1–39) + قواعد Lead Engineer.
> این سند مرجع رسمی ظاهر پروژه است؛ هیچ صفحه‌ای خارج از این سیستم ساخته نمی‌شود.
> **PHASE 07:** مرجع مهندسی کامل (توکن‌ها/کامپوننت‌ها/حالت‌ها/RTL/A11y/ممیزی): `docs/DESIGN-SYSTEM.md` · Style Guide زنده: نمای «سیستم طراحی» در فوتر · ممیزی: `bun run audit:ui`

## ۱. هویت برند

| مورد | مقدار |
|---|---|
| نام محصول | **BabaHakim** |
| نام فارسی | **باباحکیم** |
| نام فنی پروژه | `babahakim` |
| فونت | Vazirmatn (فارسی + لاتین) |
| جهت | فارسی RTL / انگلیسی LTR (سوییچ زنده) |

## ۲. پالت رسمی (غیرقابل مذاکره)

| نقش رنگ | کد | کاربرد |
|---|---|---|
| Primary Dark | `#173F76` | Header، Sidebar، Footer، تیترهای مهم، Navigation، عناصر برند |
| Primary Blue | `#225BBE` | Primary Button، CTA، لینک اصلی، Tab فعال، Interactive |
| Sky Blue | `#57AFE2` | Secondary Accent، Charts، Highlight، Info، Progress، Focus/Hover |
| Neutral Gray | `#DEDBDB` | Border، Divider، Card Border، Input Border، سطوح خنثی |

سفید `#FFFFFF` فقط Base Surface برای خوانایی است — جایگزین هویت برند نیست.

## ۳. نقشه Design Tokens (globals.css)

توکن‌های مرکزی `--bh-*` تنها منبع رنگ برند هستند (§3):

```css
--bh-primary-dark:   #173F76;   /* sidebar, footer, doctor-pending status */
--bh-primary:        #225BBE;   /* --primary (CTA / active / ring / focus) */
--bh-primary-light:  #57AFE2;   /* accents, charts, pending statuses, progress */
--bh-neutral:        #DEDBDB;   /* --border, --input */
--bh-primary-hover:  #1D4FA6;   /* .btn-brand-hover — مشتق تیره‌شده #225BBE */
```

کلاس‌های کاربردی برند: `bg-brand-dark` / `text-brand` / `bg-brand-light` / `border-brand-neutral`
کلاس‌های کمکی: `.btn-brand-hover` (hover دکمه اصلی)، `.table-row-hover` (تینت ۸٪ #57AFE2 روی ردیف جدول)

## ۴. دارک‌مود (§28)

بر پایه سطوح سرمه‌ای مشتق‌شده — **نه Invert Colors**:

- Background: `#0D1B30` · Card: `#12233C` · Elevated: `#1A2E4D`
- Primary در دارک = `#57AFE2` (کنتراست AA روی سرمه‌ای) · Ring = `#57AFE2`
- Sidebar دارک: `#0F2440`
- تاگل: دکمه Moon/Sun در هدر (CSS-driven، بدون hydration mismatch)

## ۵. سیستم وضعیت‌ها (§9)

| وضعیت | رنگ | کلاس |
|---|---|---|
| Pending / در صف | `#57AFE2` + متن `#173F76` | `bg-[#57AFE2] text-[#173F76]` |
| In Progress / فعال | `#225BBE` | `bg-[#225BBE] text-white` |
| در انتظار پزشک / Proforma | `#173F76` | `bg-[#173F76] text-white` |
| Completed / Paid / Delivered | سبز معنایی | `bg-emerald-600 text-white` |
| نیازمند اقدام کاربر / پرداخت | کهربایی هشدار | `bg-amber-500/600 text-white` |
| Error / Cancelled | قرمز استاندارد | `bg-rose-700 text-white` |
| Revision / Follow-up | بنفش متمایز | `bg-violet-500/600/700 text-white` |

**قاعده:** رنگ برند هرگز نباید به‌عنوان Warning/Error برداشت شود؛ سبز/کهربایی/قرمز فقط معنای موفقیت/هشدار/خطا دارند.

## ۶. قواعد کلیدی اعمال‌شده

- **Logo (§25):** کامپوننت واحد و قابل‌تعویض `src/components/app/shared/Logo.tsx` — برای تعویض لوگو فقط همین فایل تغییر می‌کند.
- **Buttons (§8):** همه CTAهای تأیید/ثبت = پیش‌فرض `primary` (#225BBE) با `btn-brand-hover`؛ Secondary = outline؛ Reject = قرمز معنایی.
- **Charts (§22):** Area `#225BBE`، Bar `#57AFE2`.
- **Forms (§20):** Label `#173F76`، Border `#DEDBDB`، Focus `#225BBE`.
- **Stepper/Progress (§11):** انجام‌شده = `#57AFE2`، جاری = `#225BBE`.
- **Table (§19):** hover ردیف = تینت ۸٪ `#57AFE2`، Border `#DEDBDB`.
- **localStorage:** کلید زبان = `bh_lang`.

## ۷. QA Visual (§38) — نتیجه

هر ۶ نقش (Admin / Expert1 / Expert2 / Operator / Doctor / Patient) + Landing + Auth بررسی شدند:
رنگ‌های یکپارچه ✓ · RTL صحیح ✓ · LTR صحیح ✓ · Mobile 390px + منوی Sheet ✓ · دارک‌مود برند-محور ✓ · دکمه‌ها/فرم‌ها/جداول یکسان ✓ · Status خوانا ✓ · Brand/Logo صحیح ✓
مستندات تصویری: `download/qa-screenshots/` (۱۵ تصویر).

## ۸. تصمیمات معماری ثبت‌شده (§97)

1. shadcn tokens به‌جای سیستم جداگانه، مستقیم به پالت برند نگاشت شدند تا کل کتابخانه کامپوننت خودکار برند-محور شود.
2. `--primary` در دارک به `#57AFE2` تغییر می‌کند (نه #225BBE) چون کنتراست متن سفید روی سرمه‌ای کافی نیست؛ این انتخابِ برند-محور است چون #57AFE2 خودِ رنگ رسمی برند است.
3. رنگ‌های معنایی (emerald/amber/rose/violet) فقط برای معنا نگه داشته شدند؛ هیچ‌کجا به‌عنوان رنگ تزئینی برند استفاده نمی‌شوند.
4. تاگل دارک‌مود CSS-driven است (dark:hidden / dark:block) برای پرهیز از hydration mismatch و خطای lint setState-in-effect.
