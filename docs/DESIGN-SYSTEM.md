# BabaHakim — Design System مرکزی (PHASE 07)

> منبع حاکم: «BabaHakim Master UI Branding Prompt» §1–39 + `docs/UX.md` (SP-1..8، ED-71..80) + فرمان محصول PHASE 07.
> این سند مرجع رسمی سیستم طراحی است؛ **هیچ رنگ/فاصله/کامپوننتی خارج از این سیستم ساخته نمی‌شود (§35/§39)**.
> مرجع خلاصه برند: `docs/BRANDING.md` · راهنمای زنده درون‌برنامه‌ای: نمای `designSystem` (ED-85) · ممیزی: `bun run audit:ui` (ED-90).

---

## ۱. معماری توکن (ED-81)

سیستم طراحی «دو-منبعی» است با یک قرارداد همگام‌سازی:

| لایه | فایل | نقش |
|---|---|---|
| RUNTIME (CSS) | `src/app/globals.css` | متغیرهای `--bh-*` (برند + وضعیت) + متغیرهای معنایی shadcn + نگاشت `@theme inline` → کلاس‌های Tailwind |
| JS/TS | `src/design-system/tokens.ts` | آینه TypeScript برای Charts/Canvas/JS: `brand`, `brandDerived`, `status`, `statusText`, `chartVars/chartPalette`, `chartTheme`, `typography`, `spacing`, `breakpoints`, `grid`, `radius`, `shadow`, `zIndex`, `iconSize` |
| ممیزی | `scripts/ui-audit.mjs` | قانون **E6**: هر hex در tokens.ts باید عیناً در globals.css باشد (و ۴ رنگ برند در tokens.ts) — درغیراین‌صورت بیلد UI می‌شکند (exit 1) |

**قاعده طلایی (§27/§39):** هیچ کامپوننتی رنگ برند را Hardcode نمی‌کند — همیشه از توکن‌ها: `bg-brand`, `bg-brand-dark`, `bg-brand-light`, `border-brand-neutral`, `text-primary`, `bg-status-*`, `chartVars.*`.

## ۲. پالت برند (§2–§5، غیرقابل مذاکره §39)

| توکن | Hex | کاربرد (§4) |
|---|---|---|
| `brand.primaryDark` | `#173F76` | Header، Sidebar، Footer، تیترهای مهم، Navigation، عناصر برند |
| `brand.primary` | `#225BBE` | Primary Button، CTA، لینک اصلی، Tab فعال، Interactive |
| `brand.primaryLight` | `#57AFE2` | Secondary Accent، Charts، Highlight، Info، Progress، Focus/Hover |
| `brand.neutral` | `#DEDBDB` | Border، Divider، Card/Input Border، سطوح خنثی |
| `brand.white` | `#FFFFFF` | Base Surface خوانایی (§5) — جایگزین هویت برند نیست |

سایه‌های مشتق (§3 — فقط از همین ۴ رنگ): `--bh-primary-hover #1D4FA6` · `--bh-primary-active #18418A` · `--bh-sky-15 #E7F1FA` · `--bh-sky-25 #CFE4F5` · `--bh-navy-08/15/30` · `--bh-ink #0F2A50` · سطوح دارک `--bh-surface-dark-1..4`.

## ۳. توکن‌های وضعیت (§9 — ED-82)

**هشت توکن معنایی** جایگزین کلاس‌های خام (قبلاً: `bg-[#57AFE2] text-[#173F76]`, `bg-amber-500` و… — ۱۳۳ تخلف، اکنون صفر):

| توکن | bg / fg | وضعیت‌ها |
|---|---|---|
| `status.info` | `#57AFE2` / `#122F5C` | Pending، در صف، Waiting Expert |
| `status.progress` | `#225BBE` / `#FFFFFF` | In Progress، بررسی/آماده‌سازی |
| `status.success` | `#157347` / `#FFFFFF` | Completed، تأیید، تحویل |
| `status.warning` | `#B45309` / `#FFFFFF` | در انتظار کاربر/پرداخت، Overdue |
| `status.danger` | `#B91C1C` / `#FFFFFF` | Error، لغو، ناموفق |
| `status.neutral` | `#3F5070` / `#FFFFFF` | بسته/خنثی |
| `status.navy` | `#173F76` / `#FFFFFF` | پزشک، پیش‌فاکتور، ارسال |
| `status.revision` | `#6D28D9` / `#FFFFFF` | اصلاح، ارجاع مجدد، پیگیری |

- **چیپ‌ها mode-invariant هستند**: جفت bg/fg در دو حالت روشن/تاریک یکسان است (کنتراست جفت، مستقل از تم) — بدون override در `.dark`.
- **درجه متنی (`text-status-*-text`)** برای متن مستقل روی پس‌زمینه صفحه — mode-aware: روشن `#B45309/#157347/#B91C1C/#1D6BB5`، تاریک `#E8A94D/#4ADE80/#F87171/#57AFE2` (هر دو ≥ 4.5:1).
- نگاشت وضعیت‌ها: `STATUS_META` / `ORDER_` / `PAYMENT_` / `TICKET_STATUS_META` در `constants.ts` فقط `statusClass.*` ارجاع می‌دهند (تک‌منبع).

## ۴. توکن‌های معنایی (shadcn) — روشن/تاریک

| توکن | روشن | تاریک | یادداشت |
|---|---|---|---|
| `background/foreground` | `#FFFFFF`/`#0F2A50` | `#0D1B30`/`#E7EEF8` | متن اصلی: ۱۴.۹:۱ روشن، ۱۳.۹:۱ تاریک |
| `primary(-foreground)` | `#225BBE`/سفید | `#57AFE2`/`#0F2A50` | 6.35:1 / 7.65:1 |
| `muted-foreground` | `#5B6F91` | `#8FA5C2` | **ED-86**: قبلاً `#64799A` (4.43:1) — تیره‌تر شد تا AA (5.09:1) |
| `secondary` | `#E7F1FA`/`#173F76` | `#1A2E4D`/`#CFE4F5` | سطح برند ظریف |
| `destructive` | `#DC2626` | `#F87171` | خطا (§9) |
| `border/input` | `#DEDBDB` | rgba خنثی | Neutral Gray (§4) |
| `ring` | `#225BBE` | `#57AFE2` | فوکوس (§20) |
| `sidebar*` | `#173F76`… | `#0F2440`… | §7 |

## ۵. تایپوگرافی (§23)

فونت: **Vazirmatn** (فارسی + لاتین، self-host از next/font) با fallback سیستم. رَمپ متمرکز:

| سطح | کلاس | مشخصات |
|---|---|---|
| Display | `text-display` | ۲۸/۳۶ · ۷۰۰ (alias اختصاصی §23) |
| H1 | `text-2xl font-bold` | ۲۴/۳۲ |
| H2 | `text-xl font-bold` | ۲۰/۲۸ |
| H3 | `text-lg font-semibold` | ۱۸/۲۸ |
| Title | `text-title` | ۱۸/۲۶ · ۶۰۰ (alias) |
| Body | `text-sm` | ۱۴/۲۰ (رایج‌ترین) |
| BodyLg | `text-base` | ۱۶/۲۴ |
| Caption | `text-xs` | ۱۲/۱۶ — همراه `text-muted-foreground` |
| Micro | `text-caption` | ۱۱/۱۶ (alias) |
| کد/عدد | `font-mono` + `tabular-nums` + `dir="ltr"` | کدهای TC-، شماره‌ها، تاریخ میلادی (§24) |

## ۶. فاصله، شبکه، شعاع، سایه، z-index

- **فاصله**: شبکه ۴px پایه (مقیاس Tailwind). قواعد: کارت فشرده `p-4`، کارت محتوایی `p-6`، `gap-4` بین کارت‌ها، `gap-6` بین بخش‌ها، `p-4 md:p-6` برای main.
- **شبکه**: ۱۲ ستون دسکتاپ · گاتر ۱۶px (`gap-4`) · حداکثر محتوا ۱۴۰۰px · سایدبار ۲۸۸px (`w-72`) · هدر ۶۴px (`h-16`).
- **شعاع**: sm 6 / md 8 / lg 10 (پایه `--radius 0.625rem`) / xl 14 — «مدرن و متوسط» (§21).
- **سایه**: `shadow-card` (خیلی ملایم، rgb سرمه‌ای) و `shadow-card-hover` — سایه‌های سنگین ممنوع (§6).
- **z-index**: هدر چسبان ۴۰ · Dropdown/Overlay ۵۰ · Toast ۶۰.

## ۷. Breakpoints و واکنش‌گرایی (§29)

`sm 640 · md 768 · lg 1024 · xl 1280 · 2xl 1536` — موبایل در `<md` (سایدبار → Sheet + هدر ۶۴px چسبان).

| قاعده | شرح |
|---|---|
| بیمار = Mobile-First | ناوبری ساده، CTA بزرگ (≥۴۴px لمس)، Upload راحت، Timeline اسکرولی |
| کارکنان = Desktop-First | چیدمان سه‌ستونی §80 (۲۴/۴۰/۳۶)، صف سریع (ED-75) |
| جدول → کارت در موبایل | §29: Tables در `<sm` به کارت تبدیل می‌شوند |
| فوتر چسبان | `min-h-screen flex flex-col` + `mt-auto` — کوتاه: چسبان پایین؛ بلند: هل طبیعی |

## ۸. کامپوننت‌ها (§26)

پایه: **shadcn/ui (New York)** در `src/components/ui/` + آتوم‌های اختصاصی در `src/components/app/shared/atoms.tsx`. عناصر §26 و محل ارائه:

| کامپوننت | منبع | یادداشت |
|---|---|---|
| Button/Input/Select/Modal(Dialog)/Drawer(Sheet)/Table/Card/Badge/Tabs/Dropdown/Toast/Alert/Pagination/DatePicker/Stepper/Slider/Switch… | shadcn | تم‌شده با توکن‌های §۴؛ Hover دکمه اصلی: `.btn-brand-hover` (#1D4FA6 §8) |
| Timeline | `shared/clinical.tsx` | سلسله‌مراتب رنگی برند (§13) |
| FileUploader | `PatientViews` (NewCasePage) | Dropzone §30: Preview→Quality→Compression→Progress→Complete |
| ImageViewer | `shared/clinical.tsx` (ImageGallery) | Zoom/Pan/Fullscreen/Before-After (§15) |
| Search/Filter | `Input` + الگوی Queue | `t('search')` |
| StatsCard | `atoms.tsx` | §18: سطح سفید + حاشیه برند + اکسنت آبی |
| Chart | recharts + `chartTheme` | §۹ این سند |
| Breadcrumb/Navbar/Sidebar/Footer | shadcn + `AppShell.tsx` | §7: سایدبار `#173F76`، Active `#225BBE` |
| Spinner | `ui/spinner.tsx` | §32 — currentColor |
| StatusBadge/ConfirmDialog/Empty/Loading/Error/Success/PageState | `atoms.tsx` | §۱۰ این سند |

**کلاس‌های idiom مشترک** (تک‌منبع در `@layer components` — رفع W1، ED-92): `.page-title` · `.meta-inline` · `.footer-link` · `.tile-row` · `.btn-brand-hover` · `.table-row-hover`.

## ۹. آیکون‌ها

- کتابخانه: **lucide-react** — هیچ ایموجی تصویری به‌عنوان آیکون (قانون W2 ممیزی).
- اندازه‌ها: xs 14 (درون‌متنی) · sm 16 (فرم/دکمه) · md 18 (ناو) · lg 24 (تیتر).
- رنگ فقط از توکن (`text-primary`, `text-status-success`, `text-destructive`…).
- **جهت‌آگاهی (§24)**: آیکون‌های جهت‌دار (فلش‌ها) با زبان برعکس می‌شوند؛ در RTL برای چرخش: `rtl:rotate-180` / آیکون منطقی انتخاب کن.
- ✓/✗/⚠ «گلیف متنی» مجازند؛ 📦👤🔬💬 و… ممنوع → lucide.

## ۱۰. وضعیت‌های چهارگانه (§31/§32 — ED-91)

پیاده‌سازی SP-1..SP-8 از UX.md در `atoms.tsx`:

| کامپوننت | کاربرد |
|---|---|
| `EmptyState` | آیکون + عنوان + hint + action (§31) — حالت ساده `text` برای سازگاری |
| `LoadingRows` / `LoadingCard` / `LoadingSpinner` | Skeleton/Progress/Spinner (§32) — با `aria-busy` و `role=status` |
| `ErrorState` | `role=alert` + پیام + دکمه **تلاش مجدد** (SP-5) |
| `SuccessState` | لحظه تأیید + action اختیاری |
| `PageState` | ارکستراتور: loading→error→empty→content (SP-7) |
| `ConfirmDialog` | تأیید مخرب/معمول روی AlertDialog — destructive = `bg-destructive` |

## ۱۱. فرم‌ها (§20)

زمینه سفید · حاشیه `#DEDBDB` · فوکوس `ring` `#225BBE` · لیبل `text-foreground` (سرمه‌ای §20) · Helper متن `text-muted-foreground` · خطا `destructive` + `aria-invalid` · موفق `status-success`. اعداد/تلفن/کد: `dir="ltr"` + `font-mono`. دکمه‌های async: اسپینر + disabled (SP-3، idempotent).

## ۱۲. جداول (§19)

هدر: `bg-brand-dark` با متن سفید (یا سفید + متن سرمه‌ای) · ردیف: `.table-row-hover` (تینت ۸٪ `#57AFE2`) · حاشیه `#DEDBDB` · `tabular-nums` برای ستون‌های عددی · موبایل: تبدیل به کارت (§29).

## ۱۳. نمودارها (§22 — ED-88)

- رنگ‌ها فقط از `--chart-1..5` (روشن: `#225BBE #57AFE2 #173F76 #9CCBEF #DEDBDB`؛ تاریک: معکوس‌شده روشن‌تر) — از طریق `chartVars`/`chartTheme` در `tokens.ts`.
- `chartTheme.grid` (خط‌چین ۴۴، `--border`) · `chartTheme.axis` (متن ۱۲، بدون tickline) · `chartTheme.tooltip` (popover + حاشیه).
- hex خام (`chartPalette`) فقط برای Canvas (بدون پشتیبانی var). **`hsl(var(--x))` ممنوع** — توکن‌ها hex‌اند (E4؛ باگ گرید AdminReports اصلاح شد).
- RTL: هندسه LTR، برچسب‌ها بومی؛ Currency/Locale از `fmtMoney`.

## ۱۴. Dark Mode (§28)

استراتژی «سطوح مشتق از سرمه‌ای، نه معکوس‌سازی»: پس‌زمینه `#0D1B30` → کارت `#12233C` → elevated `#1A2E4D` → hover `#233757`؛ primary می‌شود `#57AFE2` (۷.۶۵:۱). چیپ‌های وضعیت بدون تغییر (§۳). سوییچ: `ThemeToggle` در هدر (next-themes, class).

## ۱۵. RTL / LTR (§24)

- جهت با زبان: `contexts/app.tsx` روی `document.documentElement.dir/lang` (fa→RTL، en→LTR) + ذخیره localStorage.
- **قانون E5 ممیزی**: در سطح اپ، ابزار فیزیکی (`ml-/mr-/pl-/pr-/left-/right-/text-left/text-right`) ممنوع → منطقی: `ms-/me-/ps-/pe-/start-/end-/text-start/text-end/border-s/border-e/rounded-s`.
- Toast: `AppToaster` (داخل AppProvider) با `dir` زنده سونر؛ Sheet/Dropdown سمت = جهت.
- اعداد/کدها همیشه LTR داخل `dir="ltr"`؛ تاریخ شمسی render-only (ED، UX §9).

## ۱۶. دسترس‌پذیری (§34)

- **۳۲ جفت کنتراست تحت گیت خودکار (E7) — همه PASS**: متن اصلی ۱۴.۹/۱۳.۹:۱؛ muted 5.09/6.8:۱؛ همه چیپ‌ها ≥4.5:۱؛ توکن‌های متنی وضعیت در دو حالت ≥4.5:۱.
- **ED-87**: دکمه Accent (`#57AFE2`/`#173F76` = 4.31:1) فقط برای لیبل درشت/بولد و اجزای UI (≥3:1) — برای متن بدنه از Primary.
- `#DEDBDB` هرگز برای متن کوچک (§34) — فقط حاشیه/سطح.
- کیبورد/فوکوس: `outline-ring/50` سراسری + ring قابل‌مشاهده؛ semantic HTML (main/header/nav/footer)؛ aria-label برای آیکون‌دکمه‌ها؛ `role=status/alert` برای Loading/Error؛ `suppressHydrationWarning` برای محتوای زمان/تم.

## ۱۷. ممیزی یکپارچگی (ED-90) — `bun run audit:ui`

`scripts/ui-audit.mjs` روی ۱۵۲ فایل `src/`:

| قانون | شرح | وضعیت فعلی |
|---|---|---|
| E1 | کلاس hex اختیاری (`bg-[#…]`) | ۰ |
| E2 | کلاس پالت خام Tailwind (slate/amber/…) در سطح اپ | ۰ |
| E3 | hex/rgba خام بیرون منابع توکن (کامنت‌ها مستثنی؛ `#FFFFFF` §5 مجاز؛ نمای DS مستندات‌نما مستثنی) | ۰ |
| E4 | `hsl(var(…))` قدیمی | ۰ |
| E5 | ابزار جهت فیزیکی در سطح اپ | ۰ |
| E6 | همگام‌سازی tokens.ts ⇄ globals.css + ۴ رنگ برند | PASS |
| E7 | ۳۲ جفت کنتراست WCAG | PASS |
| W1/W2 | کلاس‌های تکراری ≥۳ / ایموجی‌آیکون | ۵ هشدار درون-اتمی (مجاز) |

گیت خروجی: خطا → exit 1 (CI-ready). گزارش JSON: `scripts/ui-audit-report.json`. خط پایه شروع: **۱۳۳ تخلف (۵۷ hex + ۷۶ پالت خام در ۱۱ فایل)** → اکنون **صفر**.

## ۱۸. Style Guide زنده (ED-85)

نمای درون‌برنامه‌ای `designSystem` (قید تک-مسیر `/`): لینک «سیستم طراحی» در فوتر Landing و AppShell. بخش‌ها: توکن‌ها · رنگ‌ها · وضعیت‌ها (۸ توکن + ۲۱ وضعیت گردش کار) · تایپوگرافی · فاصله/شعاع/سایه · دکمه‌ها (۸ واریانت × ۴ اندازه + حالت‌ها) · فرم‌ها (۶ حالت §20) · جداول · کارت‌ها · دیالوگ‌ها (ساده/مخرب/Sheet جهت‌آگاه) · ناوبری (Breadcrumb/Tabs/Pagination) · اعلان‌ها (توست×۳ + Alert×۳) · نمودارها (Area/Bar) · چهار State + دموی PageState · آیکون‌ها · Breakpoints — همراه سوییچ زنده تم/زبان. تصاویر تأیید: `verify-ds-*.png`.

## ۱۹. خط پایه و بدهی

- ۸۶/۸۶ تست رگرسیون (workflow+security) سبز؛ lint ۰ خطا؛ dev سرور ۲۰۰ بدون خطای کنسول/Hydration.
- بدهی: رادُکس `use-toast` فریز شده (legacy — ED-89)؛ مهاجرت باقی‌مانده viewها به `PageHeader` کامپوننتی به‌جای `.page-title` (اختیاری)؛ `DatePicker` جلالی اختصاصی v2؛ Contrast self-check در Cypress (فعلاً اسکریپت Node).
