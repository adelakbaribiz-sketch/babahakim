# معماری و استانداردهای Backend — BabaHakim
**فاز ۰۸ — Backend Engineering (لایه‌ای + استانداردسازی + تست)**
نسخه: 1.0 · تاریخ: 2026-09-04 · مرجع: PRD §12، ARCHITECTURE.md §5، WORKFLOW.md

---

## ۰. خلاصه اجرایی

فاز ۰۸ کل Backend را **ممیزی** (۱۶ یافته، یکی بحرانی) و سپس **تکمیل/Refactor** کرد: ۴۱ فایل مسیر API از «Controllerهای ضخیم» به «Controllerهای نازک» روی معماری چهارلایه `API / Application / Domain / Infrastructure` منتقل شدند؛ ۱۲ دغدغه Cross-cutting (اعتبارسنجی، منطق کسب‌وکار، مجوزدهی، تراکنش، خطا، لاگ، کش، Job، Event، نسخه‌بندی API، صفحه‌بندی/فیلتر/مرتب‌سازی) استاندارد شد؛ گیت CI (`scripts/backend-audit.mjs`) تضمین می‌کند منطق کسب‌وکار هرگز به Controller برنگردد. **۱۸۵ تست** (۳۵ واحدی جدید + ۱۹ یکپارچه جدید + رگرسیون کامل فازهای ۰۲/۰۵) سبز است.

---

## ۱. ممیزی پیش از Refactor (۱۶ یافته)

| # | یافته | شواهد | شدت | وضعیت |
|---|-------|--------|------|--------|
| A1 | منطق کسب‌وکار در Controller | `cases/[id]/action` ۲۶۳ خط آماده‌سازی موجودیت؛ checkout در route | بالا | ✅ رفع — سرویس‌ها |
| A2 | **نبود تراکنش اتمیک در Checkout** | order → invoice → کسر موجودی → خالی‌کردن سبد، خارج از `$transaction` | **بحرانی** | ✅ رفع — ED-103 |
| A3 | نبود لایه اعتبارسنجی | `String(body.x ‖ '')` دستی؛ zod نصب ولی بلااستفاده | بالا | ✅ رفع — ED-96 |
| A4 | نبود صفحه‌بندی استاندارد | `take: 100` + فیلتر حافظه‌ای؛ بدون total | بالا | ✅ رفع — ED-100 |
| A5 | فیلتر/مرتب‌سازی ad-hoc | هر مسیر قالب خودش | متوسط | ✅ رفع — ED-100 |
| A6 | نبود Cache | خواندن کامل جدول محصولات در هر درخواست | متوسط | ✅ رفع — ED-98 |
| A7 | نبود Background Job | تحلیل AI همزمانِ داخل request | متوسط | ✅ رفع — ED-102 |
| A8 | نبود لایه Event | فراخوانی مستقیم `notify()` در مسیرها | متوسط | ✅ رفع — ED-99 |
| A9 | مدیریت خطای ad-hoc | پیام‌های فارسی پراکنده؛ 500 بدون لاگ | بالا | ✅ رفع — ED-94 |
| A10 | نبود لاگ ساختاریافته | فقط `console.error` در catch | متوسط | ✅ رفع — ED-95 |
| A11 | نسخه‌بندی فقط URL | بدون هدر/سیاست deprecation | کم | ✅ رفع — ED-101 |
| A12 | ناسازگاری مجوزدهی | `products` هیچ‌گاه auth چک نمی‌کرد؛ ownership دستی | متوسط | ✅ رفع — ED-97 |
| A13 | `lib/` بدون مرز لایه | api.ts مخلوط transport/audit/متن/کد | متوسط | ✅ رفع — ED-93 |
| A14 | نویز لاگ DB | `log: ['query']` در همه محیط‌ها | کم | ✅ رفع — opt-in `BH_DB_LOG` |
| A15 | **RBAC: `create_invoice` برای OPERATOR غایب بود** | ماتریس کد ≠ ED-04/ماتریس مستندات BR §2 | بالا | ✅ رفع — realign |
| A16 | دو-نمونه‌شدن Cache زیر HMR | invalidation به Map نسل قدیم ماژول می‌خورد | متوسط | ✅ رفع — globalThis-backed |

> A2 و A15 دو باگ واقعی پروداکشن بودند که ممیزی فاز ۰۸ آشکار کرد (Checkout می‌توانست نیمه‌کاره بماند؛ اپراتور اجازه صدور پیش‌فاکتور نداشت در حالی که گردش‌کار ۱۷ مرحله‌ای آن را الزام او بود).

---

## ۲. معماری لایه‌ای (ED-93)

```
src/app/api/v1/**/route.ts      ← API: Controller نازک (guard → parse → service → data)
src/server/
  core/         errors · logger · ids · context     ← هسته مشترک بدون وابستگی
  api/          handler(apiRoute/parseBody) · guards · query · envelope · schemas
  domain/       policies (منطق خالص: موجودی/جمع فاکتور/امتیازدهی مزاج/پیش‌شرط‌ها)
  application/  dto (zod) · services ×10 (CaseAction/Case/Order/Catalog/Cart/
                Questionnaire/Profile/Ticket-Shipment-Followup/Notification/
                Payment/Auth/Image-Privacy/Dashboard/Admin)
  infrastructure/ cache · events · jobs · uow · audit · bootstrap
src/lib/        ← Shared Kernel منجمد (workflow engine, auth, storage, ai, security)
```

**قواعد وابستگی (تک‌جهته):** `API → Application → Domain`؛ `Infrastructure` پورت‌های Domain را پیاده می‌کند؛ هیچ لایه‌ای به `NextRequest` متکی نیست — آبجکت خنثی `RequestContext {reqId, ip, device}` از مرز API به پایین جریان دارد (سرویس‌ها با `toAuditReq(ctx)` با موتور گردش‌کار فاز ۰۲ صحبت می‌کنند). `src/lib/` فقط از سمت Application/Infrastructure خوانده می‌شود (Shared Kernel فریز؛ رشد مجاز فقط در `src/server/`).

**جریان یک درخواست:**
```
route.ts → apiRoute() [reqId + version header + logging + error envelope]
        → guards [requireAuth/Role/Permission/ownership]
        → parseBody(zod schema) [400 VALIDATION + field issues]
        → service() [domain policies → withTransaction → events/jobs → audit]
        → NextResponse.json(data + pagination meta)
```

---

## ۳. دوازده استاندارد Cross-cutting

| # | استاندارد | پیاده‌سازی | ED |
|---|-----------|------------|-----|
| 1 | **Validation** | zod در `application/dto.ts`؛ `parseBody` در مرز API؛ پیام‌های فارسی حفظ شد؛ بدنه خالی = `{}` | ED-96 |
| 2 | **Business Logic** | ۱۰۰٪ در سرویس‌ها + policies خالص؛ گیت E1-E8 مانع بازگشت است | ED-93/105 |
| 3 | **Authorization** | `requireRole/requirePermission/requireOwnership` (ADMIN bypass طبق BR-RBAC-02)؛ نقش‌محوری صورتی در سرویس تصویر (ED-66) | ED-97 |
| 4 | **Transactions** | `withTransaction` (retry روی SQLITE_BUSY)؛ Checkout/ایجاد پرونده/پروفایل/پرداخت اتمیک؛ CREATE_PROFORMA با «guard-first + compensation» | ED-103 |
| 5 | **Error Handling** | سلسله‌مراتب `AppError` (۸ کد) → Envelope واحد `{error, code, details?, requestId}`؛ Zod→400، P2002→409، ناشناخته→500 با لاگ و بدون لو رفتن | ED-94 |
| 6 | **Logging** | Logger JSON با `reqId/actor/route`، Redaction فیلدهای حساس، کنترل سطح با `BH_LOG_LEVEL`؛ هر درخواست: متد/مسیر/وضعیت/مدت | ED-95 |
| 7 | **Caching** | CacheStore با TTL + getOrSet ضد stampede؛ کاتالوگ 60s + داشبورد 15s + پرسشنامه 120s؛ ابطال با Event؛ HMR-safe | ED-98 |
| 8 | **Background Jobs** | صف درون‌پردازشی با retry/backoff خطی/Dead-letter(→AuditLog)؛ `ai-analysis` (خروج از مسیر درخواست)، `notify-operators`، `followup-scan` تکرارشونده ۵ دقیقه‌ای؛ semantics سازگار BullMQ | ED-102 |
| 9 | **Events** | DomainEventBus درون‌پردازشی (۱۸ رویداد هسته)؛ اشتراک در `bootstrap.ts`: notify/ابطال کش/اسکن پیگیری؛ خطای subscriber ایزوله | ED-99 |
| 10 | **API Versioning** | URL major (`/api/v1`) + هدر `X-API-Version` روی همه پاسخ‌ها؛ سیاست deprecation در §۶ | ED-101 |
| 11 | **Pagination** | `?page&limit&sort&order&q` با whitelist مرتب‌سازی و clamp؛ Envelope `{items, page, limit, total, pages}` سازگار با کلاینت فعلی | ED-100 |
| 12 | **Filtering/Sorting** | فیلترهای دامنه‌ای (status/type/category/otc/brand/role/action) + جست‌وجوی نرمال‌شده فارسی در سرویس؛ مرتب‌سازی فقط از whitelist | ED-100 |

---

## ۴. قرارداد پاسخ (Envelope)

**موفق:** شکل دامنه‌ای قبلی حفظ شد (`{cases: [...]}` و ...) + فراداده صفحه‌بندی افزوده شد + هدرهای `X-Request-Id` / `X-API-Version`.

**خطا (یک شکل واحد، سازگار با کلاینت v1):**
```json
{
  "error": "داده‌های ارسالی معتبر نیست",
  "code": "VALIDATION",
  "requestId": "req_52be5a13-f4f9",
  "details": { "issues": [{ "path": "phone", "message": "شماره موبایل معتبر نیست (۰۹xxxxxxxxx)", "code": "invalid_format" }] }
}
```
کدها: `VALIDATION(400) · AUTH_REQUIRED(401) · FORBIDDEN(403) · NOT_FOUND(404) · CONFLICT(409) · BUSINESS_RULE(422) · RATE_LIMITED(429 + Retry-After) · INTERNAL(500)`. نگاشت کدهای موتور گردش‌کار → همین کدها در `mapEngineCode`.

---

## ۵. تست‌ها (۱۸۵ سبز)

| مجموعه | تعداد | دامنه |
|--------|-------|--------|
| backend-core (واحدی، جدید) | ۳۵ | error taxonomy، query contract، cache TTL/stampede/ابطال، events ایزوله، jobs retry/DLQ، policies (موجودی/جمع/مزاج ۸حالته/پیش‌شرط‌ها) |
| api-golden-path (یکپارچه، جدید) | ۱۹ | ثبت‌نام→پرسشنامه→آپلود(گیت کیفیت)→پرونده→**AI async**→۱۸ اکشن گردش‌کار→درگاه→تحویل→بستن؛ Checkout اتمیک (جمع/موجودی/سبد)؛ قرارداد هدر/envelope/صفحه‌بندی؛ 403 ادمین؛ لاگ ساختاریافته در dev.log |
| workflow (رگرسیون فاز ۰۲) | ۵۱ | بدون تغییر — سازگاری کامل |
| security (رگرسیون فاز ۰۵) | ۳۵ | بدون تغییر — سازگاری کامل |
| security-pentest (HTTP واقعی) | ۴۵ | همه سبز پس از حفظ قرارداد 422 برای OTP |

تست یکپارچه با کلاینت‌های Cookie-Jar + CSRF دابل-سابمیت + IP یکتا (الگوی pentest فاز ۰۵) نوشته شده و روی سرور واقعی :3000 اجرا می‌شود (`bun test tests/integration`).

## ۶. گیت معماری (ED-105)

`bun run audit:backend` → `scripts/backend-audit.mjs`:
- **E1** مسیرها فقط از `@/server/api|application|dto|core/errors` و `next/server|zod` ایمپورت کنند (بدون db/notify/infrastructure/domain)
- **E2** بدون `notify(` در مسیر · **E3** بدون `executeTransition` · **E4** بدون `genCode`/`JSON.stringify` کسب‌وکار
- **E5** متدهای تغییردهنده باید zod-parse کنند (معاف: refresh/logout/callback بدون بدنه)
- **E6** همه هندلرها با `apiRoute()` · **E7** گارد مجوز (معاف: auth-flow/gateway/file با مجوز درون-سرویس) · **E8** endpointهای لیست با `parseListQuery` (هشدار برای مجموعه‌های بدون صفحه‌بندی — whitelist مستند)
- خروجی: گزارش JSON + exit 1 در صورت تخلف → قابل قفل در CI
وضعیت فعلی: **۴۵ فایل مسیر، ۰ خطا، ۰ هشدار**. (فایل Template قدیمی `src/app/api/route.ts` حذف شد.)

## ۷. نسخه‌بندی و چرخه حیات API (ED-101)

- Major در URL: `/api/v1/...` — تغییر ناسازگار ⇒ `/api/v2` موازی + `Deprecation`/`Sunset` روی v1.
- هر پاسخ `X-API-Version: v1` دارد؛ هر خطا `requestId` برای پشتیبانی/لاگ.
- انبوه‌سازی (باگ‌فیکس/افزودنی) داخل همان major؛ خروجی‌های موجود هرگز بدون نسخه جدید حذف/تغییر شکل نمی‌گیرند (قرارداد §۴ برای کلاینت SPA).

---

## ۸. سرویس‌های Application (نقشه)

| سرویس | use-caseهای کلیدی |
|-------|-------------------|
| caseService | لیست صف نقش‌محور (صفحه‌بندی+جستجو) · ایجاد اتمیک (پیش‌شرط تصویر/پرسشنامه، snapshot مزاج، enqueue AI) · جزئیات کامل با URLهای امضاشده |
| caseActionService | ۱۸ اکشن واحدِ `/cases/[id]/action` (نسخه‌بندی نسخه، ماشین AI_REVIEW، guard-first پیش‌فاکتور + compensation، آبشاری ارسال/تحویل) |
| orderService | لیست/جزئیات/Checkout اتمیک (re-check موجودی داخل tx) · تغییر وضعیت با ORDER machine · لیست پرداخت‌ها |
| catalogService | لیست محصولات (کش+صفحه‌بندی+فیلتر OTC) · جزئیات+تاریخ قیمت · CRUD سبد با گارد موجودی |
| questionnaireService | فعال (کش) · ثبت با policies امتیازدهی · تاریخچه |
| profileService | خواندن/به‌روزرسانی اتمیک user+profile |
| supportService | تیکت (TICKET machine) · ارسال (SHIPMENT machine + آبشار CASE) · پیگیری (buckets) · اعلان‌ها |
| paymentService | شروع (اتمیک) · تأیید/رسید (PAYMENT machine) · callback درگاه (idempotent) |
| authService | login/register/me/logout/refresh (family-kill) · OTP request/verify — پورت وفادار سخت‌افزاری فاز ۰۵ |
| imageService | آپلود (magic-byte → variants → گیت کیفیت) · سرو فایل (ED-66) · حقوق حریم خصوصی (رضایت/صادرات/حذف) |
| dashboardService | read model نقش‌محور با کش 15s |
| adminService | کاربران/RBAC · بیماری‌ها · محصولات+قیمت‌ها (CSV preview/commit اتمیک، bulk) · گزارش‌ها · ویرایشگر پرسشنامه نسخه‌دار · AI models/dataset · لاگ‌ها · درخواست‌های حذف |

---

## ۹. تصمیم‌های مهندسی این فاز

| کد | تصمیم |
|----|--------|
| ED-93 | معماری چهارلایه زیر `src/server/`؛ `src/lib/` = Shared Kernel منجمد؛ Controller فقط هماهنگی |
| ED-94 | سلسله‌مراتب AppError واحد + Envelope خطای واحد (`error` اول برای سازگاری کلاینت v1) |
| ED-95 | Logger ساختاریافته JSON + reqId + redaction + کنترل سطح محیطی |
| ED-96 | zod به‌عنوان مرز واحد اعتبارسنجی (پیام فارسی حفظ، بدنه خالی = {}) |
| ED-97 | گاردهای مجوز در مرز API؛ مالکیت بیمار طبق ED-77 |
| ED-98 | Cache درون‌حافظه‌ای TTL + Event-driven invalidation + HMR-safe (globalThis) — آماده Redis |
| ED-99 | Event bus درون‌پردازشی؛ سرویس‌ها هرگز notify مستقیم صدا نمی‌زنند |
| ED-100 | قرارداد واحد صفحه‌بندی/فیلتر/مرتب‌سازی + Envelope meta |
| ED-101 | نسخه‌بندی: URL major + هدر روی همه پاسخ‌ها + سیاست deprecation مستند |
| ED-102 | Job queue درون‌پردازشی (retry/backoff/DLQ→AuditLog)؛ تحلیل AI async؛ اسکن پیگیری ۵ دقیقه‌ای |
| ED-103 | `withTransaction` به‌عنوان مرز اتمیک Application؛ checkout/+profile/payment/صورت‌حساب اتمیک |
| ED-104 | گارد موجودی قبل از نوشتن (سیاست domain) + re-check داخل tx (ضد race) |
| ED-105 | گیت CI معماری backend (backend-audit.mjs) — E1..E8 + W1/W2 |

---

## ۱۰. بدهی‌های شناخته‌شده (صادقانه)

- D-08-1: endpointهای مجموعه‌ای محدود (followups/shipments/فهرست‌های ادمین) هنوز cap ثابت دارند (take≤300) — صفحه‌بندی کامل در v1² (whitelist E8 مستند است).
- D-08-2: Cache و Job Queue تک-نمونه‌ای درون-پردازشی‌اند (مناسب Modular Monolith تک-دیپلوی فعلی)؛ مهاجرت Redis/BullMQ با تعویض CacheStore/JobQueue port (ADR-0007 §8).
- D-08-3: enqueue AI به‌صورت in-process است؛ در استقرار worker-جدا (ARCHITECTURE §3) باید به صف Redis منتقل شود.
- D-08-4: گزارش مالی (admin/reports) هنوز مستقیماً OLTP را می‌خواند (read model بعد از Event bus کامل).
- D-08-5: پیام‌های `پیام‌های` سلول‌های legacy lib/api (ok/fail) در Shared Kernel باقی‌اند (فریز؛ مسیرها دیگر استفاده نمی‌کنند).
- D-08-6: CSP فعلی unsafe-inline دارد (D-1 فاز ۰۵ ارث) — nonce migration در فاز امنیت بعدی.

---

## ۱۱. رجیستری فایل‌ها

```
src/server/core/{errors,logger,ids,context}.ts
src/server/api/{handler,guards,query,envelope,schemas}.ts
src/server/domain/policies.ts
src/server/application/{dto.ts, services/×12}
src/server/infrastructure/{cache,events,jobs,uow,audit,bootstrap}.ts
src/server/__tests__/backend-core.test.ts           (35 unit)
tests/integration/api-golden-path.test.ts           (19 integration)
scripts/backend-audit.mjs + backend-audit.json      (CI gate)
package.json: audit:backend
```

مستندات مرتبط: ARCHITECTURE.md (L1-L4) · WORKFLOW.md (موتور گردش‌کار) · SECURITY.md (دفاع عمقی) · DATABASE.md (هدف PostgreSQL) · THREAT-MODEL.md.
