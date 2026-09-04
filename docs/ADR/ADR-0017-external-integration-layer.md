# ADR-0017: لایه یکپارچه Integrations خارجی (External Integration Adapter Layer)

| فیلد | مقدار |
|---|---|
| شماره | ADR-0017 |
| وضعیت | Accepted |
| تاریخ | 1405/06/14 (2026-09-05) |
| فاز تصمیم | PHASE 13 — External Integration Architecture |
| معادل ED | ED-135..150 |
| اسناد مرتبط | `INTEGRATIONS.md` · `BUSINESS-RULES.md §8 (BR-INT)` · ADR-0001 (Modular Monolith) · ADR-0007 (سرویس استنتاج خارجی) · ADR-0016 (حاکمیت گردش کار) |

## Context

فرمان PHASE 13: تمام سرویس‌های خارجی (Payment/SMS/Email/Maps/AI/Storage/Shipping/CRM/Analytics) در یک Adapter/Provider Layer با ۸ دغدغهٔ Cross-Cutting (Timeout/Retry/Idempotency/Error Handling/Logging/Monitoring/Fallback) + امنیت Credential + Mock برای Testing.

ممیزی وضعیت پیش از فاز ۱۳:

| دامنه | وضعیت | یافته |
|---|---|---|
| Payment | «mock» زرین‌پال hardcode در paymentService؛ authority=sha256 محلی؛ refNumber=random | بدون Port از spec §27 (PaymentProvider قابل تعویض)؛ بدون resilience؛ موفقیت جعلی |
| SMS | notify.ts ردیف SMSLog با `KAVENEGAR/SENT/DELIVERED` می‌نوشت با **صفر** فراخوانی شبکه | رکورد تحویل جعلی — باگ یکپارچگی حسابرسی |
| Email / Maps / Shipping / CRM / Analytics | وجود نداشت | ۵ دامنه غایب |
| AI | TongueModelV1 محلی؛ HttpAI فقط به‌عنوان «آینده» مستند (ADR-0007) | بدون Adapter با resilience |
| Storage | پورت StorageDriver + LocalDriver (PHASE 10) | پورت موجود؛ بدون پایش یکپارچه |

## Options

| گزینه | مزایا | معایب |
|---|---|---|
| A) هر سرویس resilience خودش را بپیچد (try/catch + retry محلی) | کمترین کد اولیه | ۹ پیاده‌سازی واگرا؛ Idempotency/پایش/Credential پراکنده؛ بازتولید باگ جعل SMS |
| B) کتابخانه عمومی (polly.js/tenacity) + هر Adapter جدا | اثبات‌شده | Dependency جدید؛ نه Idempotency دیتابی، نه Audit Trail سازگار با منشور، نه masking فارسی |
| C) **هستهٔ یکپارچه در Monolith (core/ + providers/) با رجیستری و Mock استراتژیک** | — | (انتخاب‌شده) |

## Decision

لایهٔ `src/server/integrations/` با دو زیرلایه:

1. **core/ (هسته)** — `types.ts` (کاتالوگ ۹ Kind + Taxonomy خطا + Policy پیش‌فرض per-kind) · `config.ts` (**تنها** خوانندهٔ envهای Integration — ED-136؛ مدهای LIVE/MOCK/AUTO با fail-safe؛ redaction/masking — ED-137) · `resilience.ts` (`callIntegration`: Timeout با AbortSignal → Retry طبقه‌بندی‌شده (Network/Timeout/429/5xx) با backoff+jitter و Retry-After → Idempotency دیتابی با unique(provider,operation,key) → خطای یکنواخت → لاگ Redacted → تله‌متری → Fallback → Circuit — ED-140) · `circuit-breaker.ts` (CLOSED/OPEN/HALF_OPEN per provider) · `telemetry.ts` (Ring درون‌حافظه + p50/p95 + retention تک‌نویسنده) · `registry.ts` (تنها مسیر نمونه‌سازی — ED-150).
2. **providers/ (آداپتورها)** — هر دامنه: قرارداد + Adapter زنده (Zarinpal PG v4، Kavenegar، Mailer HTTP، Nominatim، HttpAI، Courier/CRM/Analytics HTTP) + **Mock قطعی با fault-injection** (failNextCalls/slowNextCalls) برای تست.

قواعد کلیدی:

- **ED-138 (fail-safe)**: LIVE فقط با Credential کامل (AUTO پیش‌فرض)؛ LIVE بدون Credential → MOCK با هشدار — هرگز فراخوانی زندهٔ نیم‌پیکربندی.
- **ED-137 (حریم Credential)**: مقادیر هرگز لاگ/پ persist نمی‌شوند (redact عمیق + maskSecret)؛ کنسول ادمین فقط بولی presence می‌بیند؛ شماره Merchant در پاسخ بیمار masked است؛ PII (شماره موبایل/آدرس) در CallLog masked و فقط در SMSLog (spec §32) کامل.
- **ED-137b (ایمنی گراف Client)**: `lib/notify` در گراف مشترک Browser است → **هرگز** `@/server/*` import نمی‌کند؛ کانال‌های SMS/Email با **Dependency Injection** از bootstrap بسته می‌شوند (`bindNotificationChannels`) — نه import رو به بالا.
- **ED-146 (پل فاز 11↔13)**: `HttpAIProvider` پورت `AIModelProvider` را پیاده می‌کند و با `registerProviderFactory('HttpAI')` در رجیستری مدل فاز ۱۱ ثبت می‌شود — تعویض مدل = تغییر ردیف DB (ED-121)؛ پاسخ همیشه `PENDING_REVIEW` (ED-125).
- **ED-142..149**: paymentService فقط از Provider قراردادی می‌گذرد (تأییدیه Callback وظیفهٔ Provider است؛ refNumber قطعی شد)؛ SMS واقعاً ارسال می‌شود و SMSLog صادق است (SENT/FAILED + error — رفع باگ جعل تحویل)؛ فراخوانی ANALYTICS fire-and-forget است.

## Consequences

✅ ۹ دامنه در یک الگوی واحد؛ ۳۰ تست جدید (۲۵ unit + ۵ API)؛ گیت CI `audit:integrations` (۱۰ قاعده I1..I10)؛ کنسول ادمین `/admin/integrations` با smoke-test و تاریخچهٔ CallLog؛ Data Model جدید `IntegrationCallLog` (تله‌متری + Idempotency + retention ۹۰ روزه).
⚠️ بدهی: D-13-1 (درایور S3 واقعی — پورت موجود، `STORAGE_*` رزرو)، D-13-2 (Breaker درون‌حافظه — Redis برای Multi-Instance)، D-13-3/D-13-4 (قرارداد زندهٔ Courier/CRM امضانشده)، D-13-5 (Webhook ورودی زرین‌پال به‌جای redirect)، شماره‌گذاری ED-121..129 در فاز ۱۲ با فاز ۱۱ تصادم داشت → فاز ۱۳ از ED-135 آغاز کرد (لاگ شد).
