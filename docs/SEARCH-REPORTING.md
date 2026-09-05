# PHASE 14 — Search, Reporting & Analytics

> فرمان فاز: «Search Engine را بررسی کن. Filtering / Sorting / Pagination / Full Text Search / Internationalization را پیاده کن. Reporting: Operational / Financial / Business / User / Performance / Custom را طراحی کن. گزارش‌ها باید Permission-aware باشند. در صورت نیاز: CSV / Excel / PDF Export اضافه کن. از Queryهای بسیار سنگین و Unbounded جلوگیری کن.»
>
> وضعیت: **انجام‌شده و راستی‌آزمایی‌شده** — ۱۹ گزارش در ۶ دسته، موتور جستجوی SQL-side با Normalization فارسی، خروجی‌های CSV/XLSX/PDF (همزمان + ناهمزمان)، و قرارداد سخت **Unbounded-Query Prevention** (ED-153).

---

## 1. ممیزی پیش از فاز (S-1..S-10)

| # | یافته | اثر | رفع |
|---|---|---|---|
| S-1 | `q` **بعد از** صفحه‌بندی DB فیلتر می‌شد (`catalogService`، `caseService`، `listAdminUsers`، `listAuditLogs` با `textMatches` در JS) | صفحه‌ها با q کوچک می‌شدند؛ `total` تخمینی بود؛ over-fetch +200 | ED-151 — applyQ داخل SQL |
| S-2 | Normalization فقط در matcher حافظه‌ای؛ بدون واریانت رقمی/نیم‌فاصله | جستجوی فارسی ناقص | §2 normalize |
| S-3 | فیلترهای هر مسیر ad-hoc؛ بدون DSL مشترک Whitelist | سطح تزریق/پراکندگی | ED-152 |
| S-4 | **`getReports()` بدون هیچ where/take هفت جدول کامل را در JS reduce می‌کرد** — دقیقاً الگوی «سنگین و Unbounded» فرمان | حافظه/زمان رشد خطی با داده | ED-153/155/159 |
| S-5 | کامنت مسیر `?from=&to=&groupBy=` می‌گفت؛ سرویس پارامترها را **نادیده می‌گرفت** | قرارداد مرده | ED-159 |
| S-6 | Permission گزارش دانه‌درشت (ADMIN/OPERATOR/EXPERT_2)؛ EXPERT_2 کمیسیون رفرال و همهٔ مالی را می‌دید | نشت افقی | ED-154/157 |
| S-7 | خروجی فایل فقط CSV سمت کلاینت (۲۰ ردیف آخر) | FR-FIN-06 ناقص | ED-156 |
| S-8 | بدون کاتالوگ/دستهٔ گزارش؛ یک Aggregation هاردکد | توسعه‌ناپذیر | ED-154 |
| S-9 | منابع تله‌متری (AIInferenceLog فاز 11، IntegrationCallLog فاز 13، WorkflowState فاز 12) **گزارش نداشتند** | Performance نادیده | §6 |
| S-10 | سقف offset تا ۱M ردیف (page≤10k × limit≤100) | اسکن سنگین | ED-160 |

**بازسازی دو مسیر گم‌شده (ED-162، سومین رخداد الگوی «فایل commit‌نشده»):** `images/upload/route.ts` (بازگردانی از HEAD) و `admin/integrations/test/route.ts` (بازسازی از سرویس — هرگز commit نشده بود). تست‌های golden-path فاز 08/11 دقیقاً به همین دلیل FAIL شده بودند.

---

## 2. موتور جستجو — `src/server/infrastructure/search/`

### 2.1 Normalization (Master Prompt §25)

`normalize.ts` (خالص، client-safe — سوپرست `normalizeFa` قدیمی):

| تبدیل | مثال |
|---|---|
| ي/ى/ئ → ی · ك → ک · ة → ه · أ/إ/ٱ → ا · ؤ → و | «شيرازي» ≡ «شیرازی» |
| ارقام فارسی/عربی ↔ لاتین | ۰۹۱۲ ≡ 0912 |
| نیم‌فاصله: کلید compact حذف می‌کند، کلید spaced فاصله | «می‌خوام» ≡ «میخوام» ≡ «می خوام» |
| حذف: اعراب (U+064B-065F)، کشیده (ـ)، Bidi marks، کنترل‌ها | «بَابَا‌حکــیم» ≡ «باباحکیم» |
| Presentation Forms (FE70-FEFF) → حرف پایه | ligatureهای عربی |

**Needle Matrix (ED-151):** هر توکن تا ۴ واریانت جستجو می‌شود — as-typed، compact، spaced، رقمی-فارسی — تا متن ذخیره‌شده با خط/سبک متفاوت هم match شود. سقف ۵ توکن؛ توکن اضافه در `tokensDropped` گزارش می‌شود (صداقت، نه حذف بی‌صدا). ZWNJ «joiner کلمه» است: `می‌خوام` یک توکن است، نه دو.

### 2.2 جستجوی SQL-side (رفع S-1)

`applyQ(q, fields)` شرط `AND[ OR[contains × field × variant] ]` می‌سازد و **داخل کوئری Prisma** می‌نشیند؛ پشتیبانی از یک hop رابطه‌ای (`patient.firstName` → `{ patient: { is: {…} } }`). صفحه‌بندی/total دقیق می‌ماند؛ over-fetch حذف شد.

پیاده‌سازی‌شده: `products` (name/brand/category/sku/description) · `cases` (code/status/بیمار) · `admin/users` (نام/تلفن/ایمیل/نقش/کد معرف) · `audit-logs` (action/entity/actor) + جستجوی سراسری (§5).

### 2.3 DSL فیلتر Whitelist (ED-152)

`?f_<field>[_<op>]` با `ops ∈ {eq, ne, in, gte, lte, contains}`:
- فیلد/عملیات خارج از Whitelist → **رد** (نه 500، نه اجرای بی‌صدا)؛ در `rejected` ثبت می‌شود
- `enum` مجموعهٔ بسته؛ اعداد با `intMin/intMax`؛ `in` با سقف ۲۵ عضو
- چند عملیات روی یک فیلد merge می‌شوند (`{ amount: { gte, lte } }`)

### 2.4 محافظ‌های Unbounded (ED-153/160 — قلب فرمان فاز)

| Bound | مقدار | اجرا |
|---|---|---|
| `maxLimit` | 100 | `parseListQuery` |
| **`maxOffset`** | **10,000** | 422 `PAGINATION_TOO_DEEP` (ED-160) |
| `maxQ` / توکن | 120 / 5 | `SEARCH_LIMITS` |
| `maxWindowDays` | 400 (پیش‌فرض 30) | `clampWindow` → 422 `WINDOW_TOO_WIDE` |
| `maxViewRows` | 200 | runner ( defense-in-depth) |
| `syncExportRows()` | 2,000 (env `REPORT_SYNC_MAX_ROWS`) | 413 → پیشنهاد async |
| `asyncExportRows` | 20,000 | job |
| `maxBuckets` | 400 | bucket queries |
| `queryTimeoutMs` | 15,000 | `withReportTimeout` → 504 `REPORT_TIMEOUT` |
| Rate budgets | گزارش 30/min · sync export 30/min · async 10/min · search 60/min | per-user(+IP) |

i18n (§69): همهٔ توابع script-aware‌اند — کوئری فارسی روی ردیف انگلیسی (کدها/ارقام) و برعکس کار می‌کند.

---

## 3. مرجع گزارش‌ها — `src/server/infrastructure/reporting/`

### 3.1 معماری (ED-154/155)

```
registry.ts (19 ReportDef) ──► runner.ts (guard → zod → clampWindow → cache → timeout → row-cap)
  reports/operational|financial|business|user|performance|custom.ts          │
  sql.ts (bucketAggregate / groupAggregate — GROUP BY داخل SQLite)          ▼
  export/{csv,xlsx,pdf,exportService}.ts ──► routes (نازک) ──► ReportsCenter UI
```

- **هر گزارش یک ReportDef است** (id/category/fa/en/permission/params-zod/timeScoped/hasChart/run) — داده، نه مسیر کد
- **Permission-aware (الزام فاز):** کاتالوگ با `canViewReport` فیلتر می‌شود؛ PATIENT صفر گزارش؛ DOCTOR فقط `performance.ai`؛ EXPERT_1 بدون مالی؛ کاربر بدون مجوز اجرا را 403/404 می‌گیرد
- **Aggregation push-down (ED-155):** GROUP BY/SUM/COUNT در SQLite؛ هیچ load-then-reduce
- **ED-161 (یافتهٔ بحرانی):** Prisma SQLite تاریخ‌ها را **INTEGER ms** ذخیره می‌کند — پارامتر ISO-String در SQL خام **بی‌صدا هیچ ردیفی match نمی‌کند** (ترتیب نوع SQLite: INTEGER < TEXT). همهٔ raw queryها با `fromMs/toMs` + `strftime(fmt, col/1000, 'unixepoch')` بازنویسی شدند
- کش per (report × role-scope × params × cap) با TTL دسته‌ای + ابطال رویدادی (ED-158: PaymentVerified/OrderPaid/PriceChanged/… → پاک‌سازی پیشوند `report:`)

### 3.2 کاتالوگ ۱۹ گزارش × ۶ دسته

| دسته | گزارش | Permission |
|---|---|---|
| **OPERATIONAL** | case-status · queue-sla (WorkflowState) · followup-compliance · workflow-health¹ | view_reports (¹ADMIN: manage_workflow_recovery) |
| **FINANCIAL** | revenue-summary · payments (FR-PAY-06) · expenses · referrals (کمیسیون ۵٪) | view_financials |
| **BUSINESS** | top-products · sales-trend · provinces · disease-mix | view_reports |
| **USER** | growth · activity · roles (بدون تلفن/ایمیل — ED-157) | manage_users |
| **PERFORMANCE** | ai (p95/اطمینان/هزینه از AIInferenceLog) · integrations (IntegrationCallLog) · system (صف/SLA/Audit) | view_ai_analyses · view_audit_logs · view_reports |
| **CUSTOM** | custom.dataset — §38 با ۵ دیتاست Whitelist (payments/orders/cases/users/audit-logs) + فیلترهای مجاز + گروه‌بندی؛ **بدون SQL خام** | view_reports + مجوز دیتاست |

رشتهٔ نتایج: `columns` (دوزبانه) · `rows` (≤ cap) · `totals` · `summary` (کارت‌ها) · `chart` (bucketKey + series + rows مستقل) · `meta` (from/to/groupBy/truncated/totalRows/ms/cached/note).

### 3.3 جستجوی سراسری (ED-157)

`GET /api/v1/search?q=` — گروه‌بندی ۶-کاناله (case/product/user/order/ticket/disease) هرکدام ≤۵ نتیجه:
- PATIENT: فقط دادهٔ خودش (ED-77) + کاتالوگ عمومی
- staff: بر اساس مجوز (users → manage_users؛ cases → view_all_cases؛ orders → manage_orders؛ tickets → manage_tickets)
- کل fan-out داخل بودجهٔ ۱۵s؛ حداقل ۲ نویسه (کوئری یک‌نویسه‌ای هم بی‌فایده است هم سنگین)

---

## 4. خروجی‌ها (ED-156) — «در صورت نیاز: CSV / Excel / PDF»

| قالب | پیاده‌سازی | ویژگی |
|---|---|---|
| **CSV** | خودنویس RFC 4180 | BOM UTF-8 (اکسل فارسی) · CRLF · escape کامل · سطر totals |
| **XLSX** | **OOXML writer خودنویس بدون وابستگی** — ZIP STORED + CRC-32 | Sheet RTL (fa) / LTR (en) · هدر bold با رنگ برند · رشته‌ها inline · اعداد numeric · پنجرهٔ frozen · openpyxl-verified |
| **PDF** | pdfkit + FreeSerif (fontkit shaping فارسی — ligature lam-alef تأییدشده) | هدر برند #173F76 · جدول zebra · اعداد mono LTR · فوتر صفحه‌بندی · `serverExternalPackages` (ED: بدون آن Turbopack مسیر .afm را می‌شکند) |

**مسیرها:**
- `GET /reports/[id]/export?format=` — **همزمان** ≤ `syncExportRows()`؛ 413 + پیشنهاد async فراتر از آن
- `POST /reports/[id]/export` — **ناهمزمان**: JobQueue → اجرای bounded → StoredFile (category DOCUMENT, TEMPORARY, TTL 24h — sweeper فاز 10 خودکار پاک می‌کند) → اعلان `REPORT_EXPORT_READY` → دانلود owner-only
- `GET /reports/exports` — فهرست artifacts من (24h)؛ `GET /reports/exports/[fileId]` — دانلود با گارد مالک/ADMIN + Audit `REPORT_DOWNLOAD`
- همه با Audit (`REPORT_EXPORT`, `REPORT_EXPORT_ASYNC`) + بودجهٔ نرخ + PII: تلفن هرگز در خروجی‌ها نیست

چرا XLSX خودنویس؟ SheetJS (npm `xlsx`) روی رجیستری عمومی رها شده؛ exceljs درخت وابستگی بزرگ برای یک use-case bounded می‌آورد. زیرمجموعهٔ لازم ~۱۵۰ خط است و با تست بازگشتی (zip + openpyxl) پوشش داده شده (SR7).

---

## 5. قرارداد API

| مسیر | متد | توضیح |
|---|---|---|
| `/api/v1/reports` | GET | کاتالوگ permission-aware |
| `/api/v1/reports/[id]?from=&to=&groupBy=&dataset=&filters={json}` | GET | اجرا (JSON bounded) |
| `/api/v1/reports/[id]/export?format=csv|xlsx|pdf&lang=` | GET | خروجی همزمان |
| `/api/v1/reports/[id]/export` | POST | خروجی ناهمزمان {format, lang, params} |
| `/api/v1/reports/exports` | GET | artifacts من |
| `/api/v1/reports/exports/[fileId]` | GET | دانلود (owner/ADMIN) |
| `/api/v1/search?q=` | GET | جستجوی سراسری گروه‌بندی‌شده |
| `/api/v1/admin/reports?from=&to=` | GET | **Legacy adapter (ED-159)** — شکل v1 حفظ، موتور bounded |

---

## 6. Frontend

- **ReportsCenter** (`views/admin/ReportsCenter.tsx`) — جایگزین صفحهٔ قدیمی: تب‌های ۶ دسته (با شمارنده) · پنل پارامتر (پریست ۷/۳۰/۹۰/۳۶۵ + بازهٔ سفارشی + groupBy + dataset) · کارت‌های summary · نمودار Area (chart vars توکنی) · جدول + سطر totals + badge truncated · دکمه‌های CSV/Excel/PDF + async · فهرست «خروجی‌های من» با دانلود مجدد. 413 → toast و سوییچ خودکار به async.
- **GlobalSearchDialog** (`shared/GlobalSearchDialog.tsx`) — دکمهٔ جستجو در هدر AppShell؛ debounce 300ms؛ نتایج گروه‌بندی‌شده با آیکون دسته؛ ناوبری به فضای کاری مربوطه؛ رعایت مجوز سمت سرور.
- i18n: ۴۰+ کلید دوزبانه؛ `apiDownload` (blob + refresh 401) در api-client.

---

## 7. تست‌ها

- **Unit (43):** search 26 (normalization/needle/token-cap/applyQ/relation-hop/DSL whitelist+enum+in-cap+numeric/sort/clampWindow ۴ حالت/offset/timeout/bounds) · reporting 17 (registry 19-id/۶ دسته/مجوزها ⊆ کاتالوگ/نقش‌ها؛ CSV BOM-quoting-totals؛ XLSX zip/OOXML parts/RTL/inline؛ PDF magic/FontFile2/چندصفحه‌ای/رنگ برند؛ exportService helpers)
- **Integration (19):** کاتالوگ 401/نقش‌ها · اجرا + meta · WINDOW_TOO_WIDE 422 · PAGINATION_TOO_DEEP 422 · 404/400 · سه فرمت خروجی روی HTTP · 403/404 patient · async کامل (queued→artifact→owner download→403 متفرقه→اعلان) · IDOR جستجو · SQL-side q در cases/products · legacy adapter
- **رگرسیون کامل: 375/375 bun test** (پس از بازگردانی ED-162) · ۴۵/۴۵ pentest · ۵ گیت: backend/ui/media/ai/integrations/**reporting** همگی سبز · lint 0 error

---

## 8. گیت CI — `npm run audit:reporting` (SR1..SR10)

SR1 بدون-where در ماژول‌های جدید · SR2 اجرا فقط از registry/runner (مسیرها بدون aggregation) · SR3 کمال ReportDef · SR4 ممنوعیت textMatches در سرویس‌های لیست · SR5 خروجی فقط از exportService · SR6 سیم‌کشی timeout/cap/clamp · SR7 نویسنده‌های export بدون وابستگی + CRC + BOM · SR8 فونت TTF فارسی + RTL + serverExternalPackages · SR9 مجوزها ⊆ کاتالوگ ۳۱تایی · SR10 گارد/بودجه مسیرها.

---

## 9. تصمیمات مهندسی (ED-151..163)

| ED | تصمیم |
|---|---|
| ED-151 | جستجوی Normalized **SQL-side** با ماتریس Needle (توکن × واریانت) — نه post-filter |
| ED-152 | DSL فیلتر Whitelist-محور `f_<field>[_<op>]` با enum/range/cardinality |
| ED-153 | قرارداد سخت Unbounded-Prevention: window ≤400d · rows ≤200/2000/20000 · timeout 15s · budgets نرخ |
| ED-154 | رجیستری گزارش داده-محور + کاتالوگ Permission-aware (مجوز دیتاستی هم) |
| ED-155 | Aggregation push-down در SQL — ممنوعیت load-then-reduce |
| ED-156 | Export سه‌قالبه + سقف sync + مسیر async (job→StoredFile TEMPORARY 24h→اعلان) |
| ED-157 | Row-scoping مجوزمحور: جستجو مالکیت‌محور، artifacts فقط owner/ADMIN، بدون PII تلفنی |
| ED-158 | کش گزارش TTL دسته‌ای + ابطال رویدادی |
| ED-159 | Legacy /admin/reports = adapter با شکل v1 روی موتور bounded (S-5 fix) |
| ED-160 | سقف offset 10k (421 در عمق بیشتر) — Keyset pagination مسیر v2 |
| ED-161 | قرارداد raw-SQL: پارامتر تاریخ = epoch-ms INTEGER + strftime unixepoch |
| ED-162 | Runbook مسیرهای گم‌شده (commit نشدن فایل مسیر — رخداد سوم): بازگردانی از HEAD/بازسازی از سرویس |
| ED-163 | docPalette در tokens.ts + آینه در globals.css (E6 sync) برای خنثی‌های PDF |

---

## 10. بدهی‌ها (D-14-*)

| # | شرح |
|---|---|
| D-14-1 | collation فارسی SQLite دودویی است — مرتب‌سازی نام‌فارسی دقیق نمی‌شود (Postgres collation در طراحی فاز 04 موجود) |
| D-14-2 | Keyset/cursor pagination برای عمق > 10k (ED-160) |
| D-14-3 | فیلترهای Custom dataset در حالت گروه‌بندی اعمال نمی‌شوند (فقط حالت none) — نیاز به WHERE-builder مشترک |
| D-14-4 | Bidi کامل در PDF ردیف‌های مخلوط fa/en (اعداد داخل جملهٔ RTL ترتیب بصری ساده دارند؛ شکل‌دهی حروف درست است) |
| D-14-5 | جستجوی رابطه‌ای فقط یک hop؛ ژرف‌تر نیازمند ایندکس/ستون normalized است (trgm GIN در طرح Postgres فاز 04) |
| D-14-6 | AdminReportsPage قدیمی از API legacy تغذیه می‌شد — ReportsCenter جایگزین شد؛ حذف کامپوننت مرده در cleanup بعدی |

## 11. پیوند به اسناد

ADR-0018 · BUSINESS-RULES §5 (ED-151..163) + §9 (BR-SRCH/BR-RPT) · PRD §12 (ردیف فاز 14) · RTM (یادداشت فاز) · scripts/validate-phase14-docs.py · scripts/search-reporting-audit.mjs
