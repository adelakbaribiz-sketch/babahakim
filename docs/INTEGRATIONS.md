# BabaHakim · External Integration Architecture (PHASE 13)

> **نسخه:** 1.0.0 · **فاز:** PHASE 13 — External Integration Architecture · **ADR:** [ADR-0017](./ADR/ADR-0017-external-integration-layer.md)
> **منبع حقیقت:** `src/server/integrations/**` · **دیتامدل:** `IntegrationCallLog` (Prisma) · **گیت CI:** `npm run audit:integrations`
> **ED ها:** ED-135..ED-150 · **BR ها:** BR-INT-01..10 (BUSINESS-RULES §8)

---

## §1 ممیزی پیش از فاز ۱۳ (چه چیزی خراب بود)

| دامنه | وضعیت | یافته ممیزی |
|---|---|---|
| **Payment (Zarinpal)** | `paymentService.ts` — authority با sha256 محلی، refNumber با `Math.random`، gatewayUrl به شبیه‌ساز محلی، `ZARINPAL_MERCHANT_ID` فقط در پاسخ کپی می‌شد | ❌ بدون `PaymentProvider` (نقض spec §27: «Gateway قابل تعویض»)؛ صفر resilience؛ refNumber غیرقابل تست |
| **SMS (Kavenegar)** | `notify()` ردیف `SMSLog` با `provider:'KAVENEGAR', status:'SENT', deliveryStatus:'DELIVERED'` می‌نوشت **بدون هیچ فراخوانی شبکه** | ❌ **جعل رکورد تحویل** — باگ یکپارچگی حسابرسی؛ پیام خوش‌آمد رسیده هیچ‌وقت ارسال نمی‌شد ( subscriber بدون `phone`) |
| **Email** | — | ❌ غایب (spec §31: کانال اختیاری) |
| **Maps** | — | ❌ غایب (اعتبارسنجی آدرس/کدپستی §29) |
| **AI** | رجیستری فاز ۱۱ + TongueModelV1 محلی؛ HTTP فقط «آیندهٔ مستند» (ADR-0007) | ⚠️ پورت موجود؛ بدون Adapter دارای Timeout/Retry |
| **Storage** | پورت `StorageDriver` + LocalDriver (فاز 10) | ⚠️ پورت سالم؛ خارج پایش یکپارچه؛ S3 رزرو |
| **Shipping** | موجودیت + ماشین ORDER بدون آداپتور Courier | ❌ غایب |
| **CRM** | — | ❌ غایب |
| **Analytics** | داشبورد داخلی فقط | ❌ غایب |
| **Cross-cutting** | هیچ Timeout/Retry/Idempotency/Breaker/Masking مشترکی؛ credential در سرویس‌ها مستقیم خوانده می‌شد | ❌ لایه Integration وجود نداشت |

---

## §2 معماری — لایه Adapter/Provider

```
src/server/integrations/
├── core/
│   ├── types.ts            # ۹ Kind + taxonomy خطا + DEFAULT_POLICIES (ED-135)
│   ├── config.ts           # تنها خوانندهٔ env (ED-136) + mode fail-safe (ED-138) + redact (ED-137)
│   ├── resilience.ts       # callIntegration — هستهٔ ۸ دغدغه (ED-140)
│   ├── circuit-breaker.ts  # CLOSED/OPEN/HALF_OPEN per (kind,provider)
│   ├── telemetry.ts        # Ring + p50/p95 + purgeIntegrationLogs (تک‌نویسنده)
│   └── registry.ts         # تنها مسیر نمونه‌سازی + integrationStatus (ED-150)
├── providers/
│   ├── payment.ts          # PaymentProvider: ZarinpalProvider (PG v4) + Mock
│   ├── sms.ts              # SmsProvider: KavenegarProvider + Mock
│   ├── email.ts            # EmailProvider: HttpMailer + Mock (کانال opt-in)
│   ├── maps.ts             # MapsProvider: Nominatim + Mock
│   ├── ai.ts               # HttpAIProvider → پل به رجیستری مدل فاز ۱۱ (ED-146)
│   ├── storage.ts          # StorageIntegration: دور پورت فاز ۱۰ + تله‌متری
│   ├── shipping.ts         # ShippingProvider: HttpCourier (رزرو) + Mock زمان‌پیشرو
│   └── crm-analytics.ts    # Crm/AnalyticsProvider: HTTP + Mock
└── index.ts                # سطح عمومی (قراردادها + رجیستری — نه instance خام)
```

**قاعدهٔ جهت وابستگی:** سرویس‌های Application فقط از `@/server/integrations` (barrel/رجیستری) استفاده می‌کنند — هرگز `providers/*` مستقیم (I2). `fetch()` سمت سرور فقط داخل این لایه مجاز است (I1). نمونه‌سازی Concrete فقط در providers/registry/تست‌ها (I4). envهای Integration فقط در `core/config.ts` (I5).

**ایمنی گراف Client (ED-137b):** `lib/notify` توسط ماشین‌های گردش کار import می‌شود که در گراف مشترک Browser هستند → notify هرگز `@/server/*` نمی‌گیرد؛ کانال‌ها با `bindNotificationChannels()` از bootstrap **تزریق** می‌شوند.

---

## §3 ۸ دغدگی Cross-Cutting — `callIntegration()`

هر فراخوانی زنده از این پوشش عبور می‌کند:

| # | دغدغه | پیاده‌سازی | قاعده |
|---|---|---|---|
| 1 | **Timeout** | `AbortController` + `Promise.race` — سقف per-attempt (پیش‌فرض: Payment 15s، AI 30s، Analytics 5s) | سیگنال به fetch می‌رسد؛ abort واقعی |
| 2 | **Retry** | فقط کدهای Retryable (`TIMEOUT/NETWORK/RATE_LIMIT/SERVER`)؛ backoff نمایی با jitter ±30%؛ احترام به `Retry-After` | AUTH/VALIDATION هرگز retry نمی‌شوند (BR-INT-04)؛ Payment حداکثر ۱ retry (مسیر پول) |
| 3 | **Idempotency** | `unique(provider, operation, idempotencyKey)` در `IntegrationCallLog` → SUCCESS قبلی = Replay از پاسخ Redacted بدون فراخوانی | کلیدها: `req:{orderId}`، `verify:{authority}`، `crm:{userId}` (BR-INT-03) |
| 4 | **Error Handling** | Taxonomy یکنواخت (۹ کد) + `IntegrationError` با kind/provider/attempt + پیام فارسی انسانی (ED-141) | سرویس خطا را با code پایدار می‌بیند، نه HTML درگاه |
| 5 | **Logging** | structured (`svc:'integrations'`) + payload Redacted قبل از persist | value هرگز؛ presence فقط (ED-137) |
| 6 | **Monitoring** | Ring درون‌حافظه (۴۰۰ فراخوانی اخیر) + ردیف `IntegrationCallLog` (دوام restart) + job `integrations-monitor` هر ۵ دقیقه (breaker OPEN یا success<80% → اعلان ادمین، ED-139) | کنسول: `/admin/integrations` |
| 7 | **Fallback** | `opts.fallback` — نتیجهٔ قرارداد-یکسان محلی؛ نتیجه `degraded: true` | Analytics همیشه quiet (هرگز business flow را نمی‌شکند) |
| 8 | **Circuit Breaker** | N شکست متوالی (per-kind 4..10) → OPEN (fail-fast بدون تماس) → cooldown → HALF_OPEN یک‌پروبه → CLOSED | reset با smoke-test ادمین یا موفقیت |

## §4 مدل داده — `IntegrationCallLog`

```
kind provider operation idempotencyKey? status attempts latencyMs httpStatus
errorCode errorMessage requestRedacted responseRedacted relatedType relatedId createdAt
@@unique([provider, operation, idempotencyKey])   ← Idempotency (BR-INT-03)
@@index([kind, createdAt]) · ([kind, provider, status]) · ([createdAt])
```

- `status`: `SUCCESS | FAILED | REPLAYED | FALLBACK | SKIPPED_CIRCUIT`
- `request/responseRedacted`: JSON با masking عمیق (کلیدهای secret-مانند، Authorization، طول رشته‌ها) — PII masked: موبایل → ۴ رقم آخر (SMSLog طبق spec §32 کامل است)، آدرس → طول + ۳ رقم آخر کدپستی
- **Retention:** purge ۹۰ روزه (job روزانه؛ `purgeIntegrationLogs` تک‌نویسنده — I10)
- Mock Adapterها هم `logSyntheticCall` می‌نویسند تا کنسول dev صادق پر شود (parity پایش)

## §5 Credential Security (ED-136/137/138)

1. **جمع‌آوری**: `core/config.ts` تنها خوانندهٔ env (گیت I5). `.env.example` قرارداد کامل (هرگز `.env` کامیت نمی‌شود).
2. **Fail-safe**: `INTEGRATION_MODE = live|mock|auto` (پیش‌فرض auto): زنده فقط با credential کامل؛ `live` ناقص → mock + هشدار loud — **fail-safe نه fail-open**.
3. **Masking**: `maskSecret` (پیشوند ۴ کاراکتری + طول)، `redact()` عمیق (کلیدهای `token/secret/key/merchant_id/authorization/…` + هدرها + سقف 512 کاراکتر per فیلد + عمق ۶).
4. **Presence-only در UI**: کنسول ادمین فقط بولی `present` per env؛ مقدار Merchant در پاسخ API بیمار masked (`zarinpalMerchantMasked`).
5. **PII**: تکرار PII در CallLog ممنوع — مقصد اصلی PII همان SMSLog/Notification است.

## §6 دامنه‌ها — قرارداد + Adapter

| Kind | قرارداد | Live | Mock (تست) | نکات |
|---|---|---|---|---|
| PAYMENT | `createPayment / verifyPayment / healthCheck` | Zarinpal PG v4 (request/verify، Rial تبدیل، code 100/101 = OK) | authority/refNumber = SHA-256 قطعی؛ gatewayUrl به شبیه‌ساز | Idempotency per order + per authority؛ callback: تأییدیه وظیفهٔ Provider (ED-142) |
| SMS | `send / deliveryStatus / healthCheck` | Kavenegar REST (نقشه کد خطا → taxonomy؛ Retry-After) | ثبت پیام + fault injection | SMSLog صادق: SENT/QUEUED یا FAILED+error — **رفع جعل DELIVERED** (ED-143) |
| EMAIL | `send / healthCheck` | Mailer HTTP سازگار Resend | outbox | کانال opt-in: `EMAIL_ENABLED` (ED-144) |
| MAPS | `geocode / healthCheck` | OSM Nominatim (UA اختصاصی — سیاست استفاده) | مختصات قطعی در محدودهٔ تهران | بدون کلید؛ آدرس خالی → valid:false (ED-145) |
| AI | `AIModelProvider.analyze` (پورت فاز 11) | سرویس استنتاج HTTP (ADR-0007) | TongueModelV1 محلی (بدون تغییر) | ثبت `HttpAI` در رجیستری مدل با bootstrap؛ پاسخ همیشه PENDING_REVIEW (ED-146) |
| STORAGE | دور `StorageDriver` فاز 10 + تله‌متری | local (S3 رزرو: `STORAGE_*`, ADR-0006) | — | کلید zone-prefixed + گارد مسیر (ED-110) سالم می‌ماند (ED-147) |
| SHIPPING | `registerShipment / trackShipment` | HttpCourier (قرارداد امضانشده — D-13-3) | tracking پیشرونده با زمان | Mock برای فلوهای ORDER کافی است (ED-148) |
| CRM | `upsertContact / recordEvent` | HTTP عمومی | map درون‌حافظه | Idempotency per userId (ED-149) |
| ANALYTICS | `track` (fire-and-forget) | HTTP batched | شمارنده | هرگز throw نمی‌کند؛ Policy lenient |

## §7 رجیستری و وضوح حالت

`integrationStatus()` وضعیت هر ۹ kind را می‌دهد: mode (live/mock)، mode درخواستی، provider، credential presence، وضعیت Circuit، آمار (total/successRate/p50/p95/lastError) — مصرف‌کننده: API ادمین + job پایش. تست‌ها: `__overrideForTests(kind, instance)` و `__resetRegistryForTests(mode)` و `__setIntegrationModeForTests`.

## §8 API و UI ادمین

| مسیر | متد | دسترسی | شرح |
|---|---|---|---|
| `/api/v1/admin/integrations` | GET | ADMIN | Overview: ۹ kind × (mode/credential/circuit/telemetry/24h از CallLog) + recentFailures + ۱۵ فراخوانی اخیر |
| `/api/v1/admin/integrations/test` | POST | ADMIN | Smoke-test: reset breaker → healthCheck از مسیر resilience → Audit `INTEGRATION_SMOKE_TEST`؛ zod enum؛ Rate-limit ۳/دقیقه |

UI: صفحهٔ **Integrations** در ناحیهٔ ادمین (nav رجیستری `routes.ts` + گیت `canViewRoute`) — کارت per kind (LIVE/MOCK، circuit، p50/p95، 24h badge SUCCESS/PARTIAL/FAILED، credential presence dots) + جدول CallLog + دکمهٔ تست + خطاهای اخیر. اسکرین‌شات: `verify-integrations-console.png`.

## §9 تست

- **۲۵ unit** (`src/server/integrations/__tests__/integration-core.test.ts`): taxonomy، fail-safe mode، masking/redaction، Timeout با abort واقعی، Retry طبقه‌بندی‌شده، AUTH بدون retry، Idempotency دیتابی (replay بدون اجرای دوباره)، Fallback degraded، Circuit open/half-open/recovery، تله‌متری ring، determinism مک‌ها + fault injection، رجیستری ۹ kind + عدم نشت credential در JSON.
- **۵ API** (`tests/integration/integrations.test.ts`): پرداخت سرتاسری از Provider (authority → callback → PAID → CallLog)، SMS ثبت‌نام صادق (mock-* + هرگز DELIVERED)، authz کنسول (401/403/200 + عدم نشت مقدار)، smoke-test (zod 400 / 200 / 429 / Audit)، non-admin 403.
- **رگرسیون کل:** ۳۱۳/۳۱۳ `bun test` · pentest 45/45 · auditها (backend/media/ai/frontend/integrations) سبز · lint ۰ خطا.

## §10 گیت CI — `npm run audit:integrations`

| قاعده | شرح |
|---|---|
| I1 | `fetch()` سمت سرور فقط در لایهٔ Integration |
| I2 | Application فقط از barrel/رجیستری — نه providers/* مستقیم |
| I3 | Adapter زنده باید از `callIntegration` بگذرد |
| I4 | `new Provider()` فقط داخل لایه/رجیستری/تست |
| I5 | envهای Integration فقط در `core/config.ts` |
| I6 | هر ۹ kind: قرارداد + Mock + resolver رجیستری |
| I7 | عملیات مسیر پول/پیام Idempotency-key و retry policy دارند |
| I8 | ماژول‌های `src/lib` (گراف client) هرگز `@/server/*` import نمی‌کنند (استثنا: shim مستند `lib/ai/run.ts`) |
| I9 | مسیرهای admin/integrations role-guard هستند |
| I10 | نوشتن/حذف `IntegrationCallLog` فقط از هستهٔ Integration |

## §11 Runbook عملیاتی

- **فعال‌سازی Zarinpal زنده**: `ZARINPAL_MERCHANT_ID` + `ZARINPAL_ENV=live` + `ZARINPAL_CALLBACK_BASE` (عمومی) → mode خودکار live؛ بدون آن mock قطعی.
- **فعال‌سازی SMS واقعی**: `SMS_PROVIDER_KEY` (+ `SMS_SENDER`).
- **فعال‌سازی AI خارجی**: `AI_SERVICE_URL` + `AI_SERVICE_KEY` → `HttpAI` در رجیستری؛ سپس `AIModel.provider='HttpAI'` در DB (بدون کد).
- **عیب‌یابی**: کنسول `/admin/integrations` → breaker/lastError → `IntegrationCallLog` (query per kind) → smoke-test → لاگ `svc:'integrations'`.
- **در circuit open شد**: خودکار cooldown → probe؛ فوری: دکمهٔ تست (breaker reset) بعد از رفع علت.

## §12 بدهی‌ها و ریسک‌ها (صادقانه)

| شناسه | شرح |
|---|---|
| D-13-1 | درایور S3/MinIO واقعی (پورت موجود؛ env رزرو؛ پیاده‌سازی SigV4 یا SDK) |
| D-13-2 | Circuit/Breaker و Ring درون‌حافظه‌اند — Multi-Instance نیاز به Redis دارد |
| D-13-3 | Adapter Courier زنده بعد از امضای قرارداد (HttpCourier → NotImplemented fail-loud) |
| D-13-4 | همانند برای CRM زنده |
| D-13-5 | Webhook ورودی زرین‌پال (IPN) به‌جای redirect-only برای مقاوم‌سازی callback |
| D-13-6 | deliveryStatus پیامک فقط متد است — polling job تحویل به‌صورت دسته‌ای یا webhook کاوه‌نگار |
| ED-collision | شماره‌گذاری ED-121..129 در فاز ۱۲ با بازهٔ فاز ۱۱ تصادم داشت؛ فاز ۱۳ از ED-135 ادامه داد (در همین‌جا ثبت شد) |

## §13 ثبت ED فاز ۱۳

| ED | تصمیم |
|---|---|
| ED-135 | واژگان مشترک: ۹ Kind + taxonomy ۹کدی + policy per-kind در `core/types.ts` |
| ED-136 | `core/config.ts` تنها خوانندهٔ envهای Integration |
| ED-137 | Redaction/masking عمیق قبل از هر persist/log؛ presence-only در UI |
| ED-137b | گراف client ایمن: notify با تزریق کانال، نه import رو به بالا |
| ED-138 | Mode fail-safe: LIVE فقط با credential کامل |
| ED-139 | تله‌متری یکپارچه: Ring + IntegrationCallLog + job اعلان ادمین |
| ED-140 | `callIntegration` هستهٔ ۸ دغدغه |
| ED-141 | پیام خطای فارسی انسانی per-kind |
| ED-142 | Payment از Provider قراردادی؛ تأییدیهٔ Callback وظیفهٔ Provider؛ refNumber قطعی |
| ED-143 | SMS صادق: SENT/FAILED واقعی — رفع جعل DELIVERED؛ + phone به subscriber ثبت‌نام |
| ED-144 | Email کانال opt-in (`EMAIL_ENABLED`) |
| ED-145 | Maps (Nominatim) برای اعتبارسنجی آدرس/کدپستی |
| ED-146 | HttpAIProvider پل فاز 11 (رجیستری مدل) ↔ فاز 13 (resilience) |
| ED-147 | Storage زیر پایش یکپارچه (دور پورت فاز 10) |
| ED-148 | Shipping adapter + mock زمان‌پیشرو برای فلوهای ORDER |
| ED-149 | CRM/Analytics با Idempotency و fire-and-forget |
| ED-150 | رجیستری = تنها مسیر نمونه‌سازی + `integrationStatus` |
