# QA — تضمین کیفیت جامع (PHASE 18)

> سند فاز ۱۸ طبق فرمان محصول: «ممیزی تست‌های موجود + ایجاد/تکمیل ۱۰ نوع تست (Unit/Integration/API/Database/Security/E2E/Regression/Performance/Load/Contract) برای Critical Path + کیفیت پوشش مهم‌تر از عدد پوشش + برای هر باگ یک Regression Test + هدف: Critical Bug = ۰»
>
> نسخه: 1.0.0 · وضعیت: **اجراشده و قفل‌شده** · گیت CI: `npm run audit:qa` (QA1..QA10) · ورودی اجرای واحد: `bash scripts/qa-run.sh`

---

## §1 ممیزی وضعیت تست‌ها قبل از فاز (صداقت کامل)

ممیزی ۵۹۳ تست موجود نشان داد چهار شکاف ساختاری:

- **شکاف نوع‌بندی**: تست‌ها وجود داشتند اما «۱۰ نوع» فرمان، کاتالوگ اعلام‌نشده بود — Load و Regression و Contract به‌عنوان نوع مجزا وجود نداشتند (تست بارِ پراکنده در reliability بود؛ حافظهٔ باگ نداشتیم؛ قرارداد سیم در integrationها پخش بود).
- **شکاف شاخص پوشش**: Critical Path فرمان (مسیر طلایی بیمار، مسیر پول، ماتریس RBAC، جداسازی داده) هرگز «نقشهٔ صریح» نشد — پوشش عددی داشتیم، نقشه نداشتیم.
- **شکاف تولیدپذیری (Repeatability)**: دو دفعه اجرای پشت‌سرهم suite سبز نمی‌ماند: (۱) stock محصولات seed در اجرای اول مصرف می‌شود و `limit=5` در تست golden-path در اجرای دوم به دیوار می‌خورد؛ (۲) سرور dev رهاشده روی :3000 کل suite را می‌بلعد و نتیجهٔ مسموم می‌دهد (بند §7).
- **شکاف حافظهٔ باگ**: باگهای شکارشده در فازهای ۱۴–۱۷ (upload مفقود، integrations/test هرگز commitنشده، alert-reopen، paidAt، 4xx نرخ کاذب، S-1) در تست قفل نشده بودند — رفع باگ بدون قفل رگرسیون، فقط تعویق باگ است.

## §2 کاتالوگ ۱۰ نوع تست (ترتیب فرمان)

| # | نوع | فایل/سوئیت | ماهیت | وضعیت قبل → بعد |
|---|---|---|---|---|
| 1 | Unit | `src/server/__tests__` · `src/lib/security/__tests__` · `src/lib/workflow/__tests__` + بستههای زیرساخت | دامنه/سیاست/موتور — بدون I/O | ~۳۰۰ → همان + بهبود |
| 2 | Integration | `tests/integration/api-golden-path.test.ts` + ۱۰ فایل دیگر | سرور production واقعی + DB واقعی | موجود → سازمان‌یافته |
| 3 | API | golden-path (مثبت) + contract (منفی/لبه) + authz | قرارداد HTTP کامل | موجود |
| 4 | Database | `tests/integration/database.test.ts` | قیدها/soft-delete/قیمت/parity زیر همزمانی | **جدید** (DB-1..DB-7) |
| 5 | Security | `tests/security-pentest.sh` (۴۵) + `tests/integration/authz.test.ts` (ماتریس ۶نقش×مسیر) | نفوذ + مجوز | موجود |
| 6 | E2E | `tests/e2e/run-e2e.mjs` (agent-browser) | سفر مرورگر FA/EN | موجود |
| 7 | Regression | `tests/regression/regression.test.ts` | **حافظهٔ باگ REG-01..REG-07** | **جدید** |
| 8 | Performance | `tests/integration/performance.test.ts` + هارنسهای فاز ۱۶ | قراردادهای کارایی اندازه‌گیری‌محور | موجود (فاز ۱۶) |
| 9 | Load | `tests/load/load.test.ts` | §79: raceها + بودجهٔ صادق (zero-5xx، p95) | **جدید** |
| 10 | Contract | `tests/integration/contract.test.ts` | §85/§86/§87: پاکت/نسخه/request-id/صفحه‌بندی | **جدید** |

سوئیتهای جدید همه سربرگ «provenance» دارند (چرا وجود دارند، کدام بخش spec/فرمان، کدام ED) — گیت QA9 آن را الزام میکند.

## §3 نقشهٔ Critical Path (کیفیت پوشش، نه عدد)

چهار مسیر بحرانی صریحاً map و قفل شدند (QA10):

1. **سفر طلایی بیمار**: پرسشنامه → آپلود زبان → پرونده → تحلیل AI → گردش‌کار کامل (Claim→Assessment→Approval→نسخه→Review→Doctor→Proforma→پرداخت→ارسال→پیگیری) — golden-path suite.
2. **مسیر پول**: اتمیکیتی checkout (موجودی+سبد در tx) + Idempotency دابل‌کلیک (بازپخش همان سفارش) + callback تکراری zarinpal (`alreadyPaid`) + «هرگز دو سفارش» — load + reliability + golden.
3. **ماتریس RBAC ۶نقش + جداسازی بیمار**: هر مسیر admin × ۶ نقش (فقط ADMIN ۲۰۰، بقیه ۴۰۳، anon ۴۰۱) + بیمار فقط دادهٔ خودش — authz suite.
4. **خطای مسیر بحرانی**: proactive route inventory — هر مسیری که frontend/تست/سند ارجاع میدهد باید handler واقعی داشته باشد (کلاس REG-01/02) — regression suite + گیت QA2.

قاعدهٔ «کیفیت > عدد»: هیچ عدد پوشش درصدی هدف گرفته نشد؛ معیار پذیرش = سبز بودن همین نقشه + صفر Critical Bug باز.

## §4 حافظهٔ باگ (Regression Catalog)

| قفل | باگ تاریخی | تست |
|---|---|---|
| REG-01 | route آپلود تصویر از working-tree حذف شده بود (سفر بیمار مرده؛ 405-cascade) | inventory + upload زنده |
| REG-02 | route `admin/integrations/test` در فاز ۱۳ فقط در لایهٔ سرویس/سند بود، route فایل هرگز commit نشد و بعداً کلاً مفقود شد | بازسازی route + قرارداد 400/403/audit |
| REG-03 | کلاسِ بالای دو مورد: هر مسیر ارجاع‌شده باید handler داشته باشد | inventory کل پروژه در تست + گیت |
| REG-04 | AlertEvent P2002 (فاز ۱۷): هشدار resolveشده هرگز دوباره fire نمی‌شد و کل tick fail می‌کرد | reopen-after-resolve |
| REG-05 | business-today روی فیلد ناموجود paidAt (فاز ۱۵) | aggregate روی verifiedAt |
| REG-06 | شمارش 4xx در api_errors نرخ کاذب ۲۴٪ و CRITICAL کاذب می‌ساخت (فاز ۱۵) | تفکیک 5xx/4xx |
| REG-07 | فیلتر JS-side بیمار (فاز ۱۴ S-1): نقض جداسازی SQL-side | isolation بیمار |

## §5 Runner واحد و تولیدپذیری (`scripts/qa-run.sh`)

یک نقطهٔ ورود تکرارپذیر: بوت سرور production standalone با `BH_CHAOS=1` (سوئیتهای قابلیت اطمینان به کنسول آشوب نیاز دارند) + پاکسازی listener قبلی :3000 + انتظار readiness + پنجرهٔ settle (بوت DurableJobهای batch اولیه را میپرد تا lock نوشتن SQLite صف نشود) + اجرای `NODE_ENV=test bun test` (NODE_ENV به فرایند تست نشت نمیکند — کدهای dev و fail-fast سهمان) + teardown با trap.

**دو عیب واقعی که همین فاز در runner شکار و رفع شد**:

- **مسمومیت پورت (خطرناک)**: runner فقط `standalone/server.js` را pkill میکرد؛ سرور `next dev` رهاشده از bootstrap محیط روی :3000 میماند، سرور QA با EADDRINUSE میمُرد و **کل suite به‌صورت خاموش علیه سرور dev اجرا میشد** — بدون BH_CHAOS → کنسول آشوب 404 → ۹ شکست کاذب. رفع: پاکسازی «هر» listener :3000 + **گارد مالکیت پورت**: بعد از بوت، pid مالک :3000 باید همان pid سرور QA باشد، وگرنه run با خطای صریح متوقف میشود («refusing a poisoned run»).
- **شکنندگی stock**: golden-path از صفحهٔ اول (`limit=5`) محصول میگرفت؛ اجراهای مشروع قبلی (۲۲۰+ سفارش در suiteهای بار/قابلیت اطمینان) stock را میمصرفند و تست در اجرای بعدی میشکست. رفع: اسکن کل صفحهٔ کاتالوگ (`limit=100` سقف SEARCH_BOUNDS)؛ کاتالوگ کاملاً خالی هنوز به‌صورت صدا شکست میخورد (درست همین است).

## §6 سوئیتهای جدید — قراردادهای قفل‌شده

**Load (§79 + بودجهٔ صادق)**: race دو CLAIM همزمان (دقیقاً یک برنده) · دابل-checkout دقیقاً-یکبار (`myOrders.length === 1`) · burst کاتالوگ: zero 5xx + p95 < 1500ms + بدون خطای اتصال · تغییر قیمت همزمان: تاریخچه append-only میماند (بدون overwrite).

**Contract (§85/§86/§87 + §89)**: هدر `x-api-version: v1` روی موفقیت و هر خطا · پاکت خطا `{error اول، code، requestId، details}` · برابری هدر `x-request-id` ↔ بدنه (قابلیت ردیابی لاگ) · صفحه‌بندی flat در ۳ endpoint لیست · `Retry-After` روی 429 · انضباط متد (405 هرگز 500).

**Database**: parity اسکیما↔DB در هر دو جهت · قید یکتایی زیر نوشتن همزمان (P2002 — دقیقاً یک برنده) · FK (P2003) · تاریخچهٔ قیمت append-only · soft-delete (ردیف میماند، خوانده نمیشود) · نامتغیرهای پول (PAID⇒verifiedAt، بدون منفی) · قرارداد WAL (فاز ۱۶).

**Regression**: کاتالوگ §4 + inventory مسیر بحرانی — درخواست ناشناس به هر مسیر ارجاع‌شده باید توسط «API ما» پاسخ داده شود (401/403/200/4xx)، نه صفحهٔ 404 فریم‌ورک.

## §7 چرخهٔ Fix واقعی در طول فاز (خودِ QA خودِ پروژه را شکار کرد)

1. **سه خطای syntax در خودِ گیت qa-audit.mjs** (فاز نیمه‌کاره رها شده بود: ternary خردشده، پرانتز اضافی، عبارت tautology `.toString() !== undefined`) → بازسازی + `node --check` در گردش کار.
2. **باگ منطقی walk()**: پارامتر filter بهجای acc پاس میشد (`acc.push is not a function`).
3. **جهت اشتباه تطبیق مسیر**: regex از «مرجع» ساخته میشد و با actual تطبیق داده میشد؛ refs بدون placeholder هرگز match نمیشدند + دوبل-اسلش در actual (`[id]`→`/{P}` روی اسلش موجود) → refهای سالم false-positive. رفع: actual مرجع همیشگی است؛ تطبیق سه‌گانه (دقیق/پیشوند string-concat/الگوی dynamic) + نرمالسازی `${fragment` ناتمام.
4. **افعال hygiene کاذب**: مقدار تست `HACKED_FIELD` (ورودی adversarial عمدی برای validateAiOutput) با regex بدون word-boundary بهعنوان «علامت HACK» گیر میافتاد → `\b(TODO|FIXME|HACK)\b`.
5. **REG-02 واقعی بود**: route مفقود از git reconstruct شد (از قرارداد قفل‌شدهٔ تستها) و حالا inventory + خود تست پاس آن را نگه میدارد.

## §8 گیت CI — QA1..QA10 (`scripts/qa-audit.mjs`)

| گیت | الزام |
|---|---|
| QA1 | ۱۰ نوع تست به‌صورت suite واقعی موجود |
| QA2 | inventory مسیر: هر مسیر ارجاع‌شده handler دارد (کلاس REG-01/02) |
| QA3 | رفعهای بحرانی فاز ۱۸ committed و wired هستند |
| QA4 | کاتالوگ regression: هر باگ قفل REG-* دارد |
| QA5 | runner: بوت chaos + جداسازی NODE_ENV + settle + teardown |
| QA6 | load: raceها + بودجههای صادق |
| QA7 | contract: §85/§86/§87 |
| QA8 | database: قیدها/soft-delete/قیمت/parity |
| QA9 | بهداشت تست: بدون skip/only/TODO؛ سربرگ provenance؛ کش session کلاینت مشترک |
| QA10 | نقشهٔ Critical Path صریح (سفر طلایی/پول/RBAC/inventory) |

`package.json`: `npm run audit:qa` · usage: `bash scripts/qa-run.sh` (کل چرخه در یک فرمان).

## §9 کاتالوگ تصمیمهای مهندسی (ED-197..206)

| ED | تصمیم |
|---|---|
| ED-197 | کاتالوگ ۱۰نوع تستِ اعلام‌شده — نوع‌بندی کد واقعی، نه برچسب |
| ED-198 | نقشهٔ Critical Path صریح ۴مسیره؛ پذیرش = نقشهٔ سبز، نه عدد درصدی |
| ED-199 | حافظهٔ باگ REG-*: هر باگ شکارشده = یک تست قفل (فرمان «برای هر باگ») |
| ED-200 | Runner واحد qa-run.sh با env جداشده و settle-window |
| ED-201 | گارد مالکیت پورت: suite هرگز علیه سرور «جاعل» اجرا نمیشود |
| ED-202 | inventory proactive مسیر (actual مرجع؛ تطبیق دقیق/پیشوند/dynamic) |
| ED-203 | تولیدپذیری تست داده: اسکن صفحهٔ کامل کاتالوگ (مصرف stock مشروع است) |
| ED-204 | سربرگ provenance الزامی هر suite جدید |
| ED-205 | hygiene با word-boundary (ورودیهای adversarial عمدی مجازند) |
| ED-206 | کش session کلاینت مشترک (login rate-limit بین suiteها امن) |

## §10 بدهیهای صریح (D-18-*)

- **D-18-1** ابزار پوشش خط-to-خط (c8/istanbul) — فعلاً نقشهٔ مسیر صریح جایگزین عدد است (طبق فرمان: کیفیت > عدد).
- **D-18-2** اجرای contract suite علیه replays واقعی ترافیک production.
- **D-18-3** Load تست خارج-پردازش (k6/Artillery) برای p95 زیر ترافیک واقعی multi-user.
- **D-18-4** mutation testing (Stryker) برای صداقت شاخص تستها.
- **D-18-5** فلکِ async-export زیر suite کامل — یکبار دیده شد؛ واتچ میشود (در اجراهای مجدد سبز).
- **D-18-6** فاز ۰۹ remediation (۷۳ صفحه SC-ID) همچنان باز.

## §11 اجرای مجدد (Runbook)

```bash
bun run build                                   # standalone به‌روز
bash scripts/qa-run.sh                          # کل suite علیه سرور production + chaos
npm run audit:qa                                # گیت QA1..QA10
bash tests/security-pentest.sh                  # ۴۵ سناریوی نفوذ
bash scripts/smoke-phase18.sh                   # دود مستقل curl (بخش §12)
```

## §12 نتایج راستیآزمایی نهایی

- **bun test: ۵۹۳/۵۹۳** (۲۵ فایل؛ ۲۸۹۸ expect) روی سرور production standalone با BH_CHAOS=1
- گیت QA: **۱۰/۱۰ PASSED** (پس از رفع ۳ خطای syntax + ۲ باگ منطقی خودِ گیت)
- pentest ۴۵/۴۵ · lint ۰ خطا
- دو اجرای کامل پشت‌سرهم سبز (تولیدپذیری) — دفعهٔ دوم بعد از رفع stock/پورت
- Critical Bug باز: **۰** (هدف فرمان)
