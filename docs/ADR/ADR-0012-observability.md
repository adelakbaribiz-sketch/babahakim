# ADR-0012: Observability ساخت‌یافته (Logging / Metrics / Tracing-ready)

| فیلد | مقدار |
|---|---|
| شماره | ADR-0012 |
| وضعیت | Accepted |
| تاریخ | 1405/06/14 (2026-09-04) |
| فاز تصمیم | PHASE 03 — System Architecture |
| معادل ED | ED-46 |
| اسناد مرتبط | `ARCHITECTURE.md §11` · ADR-0005 (correlationId) · ADR-0011 |

## Context

سیستم بالینی-مالی با صف، Worker و درگاه پرداخت، بدون Observability قابل اشکال‌زدایی نیست (مثلاً: «چرا Callback زرین‌پال رکورد Payment را PAY نکرد؟» یا «کدام Case در صف چه مدت مانده؟»). وضعیت فعلی: لاگ متنی console + dev.log + AuditLog کامل (لایه کسب‌وکار). باید تصمیم معماری Observability از الان قطعی شود تا نقاط instrument در کد فازهای بعد درست نوشته شوند.

## Options

| گزینه | مزایا | معایب |
|---|---|---|
| **A) JSON structured logging + Prometheus metrics + correlationId (OTel-ready)** | ارزان؛ gradual؛ سازگار Compose | Tracing توزیع‌شده کامل دیرتر |
| **B) Full ELK + Jaeger از روز اول** | کامل | Overkill برای C1؛ هزینه بالای Ops |
| **C) فقط AuditLog** | موجود | کافی برای کسب‌وکار، ناکافی برای زیرساخت |

## Decision

**سه محور با پیاده‌سازی تدریجی (نقاط instrument از الان تعریف می‌شوند):**

1. **Logging:** JSON ساخت‌یافته با pino — سطح `error/warn/info/debug`؛ هر رکورد دارای `requestId` (HTTP) یا `jobId/eventId` (Worker) و `correlationId` (caseId/orderId از ADR-0008). **متن لاگ هرگز شامل داده سلامتی نیست** (P5) — فقط شناسه‌ها.
2. **Metrics:** Endpoint Prometheus در web/worker/ai — شاخص‌های کلیدی: نرخ/زمان Response به تفکیک Route، عمق و زمان صف‌ها، نرخ خطای Consumerها + سن DLQ، SLA انتظار در صف کارشناسان (کمکی برای ED-08)، نرخ شکست Callback پرداخت.
3. **Tracing:** قرارداد `correlationId` از الان در Eventها و لاگ‌ها جاری است؛ ورود OpenTelemetry در فاز 06 بدون Redesign (نقاط span: Route → Facade → Engine → Adapter).

**آستانه‌های هشدار (اولیه):** DLQ غیر-خالی بیش از ۱۰ دقیقه؛ نرخ خطای Callback > ۲٪ در ۱ ساعت؛ Backlog صف ai > ۵۰ Job؛ فاصله Heartbeat worker > ۶۰ ثانیه.

## Consequences

**مثبت:**
- اشکال‌زدایی صف/پرداخت/AI از Evidence ممکن می‌شود؛ پایه Monitoring فاز 06.
- Audit (کسب‌وکار) و Logs (فنی) تفکیک می‌شوند — هر دو لازم، هیچ‌کدام جایگزین دیگری نیست.

**منفی/هزینه:**
- ورود pino + قالب لاگ باید در همه Routeها/Consumerها رعایت شود (نوتبوک توسعه).

## Compliance

- تست: هیچ رکورد لاگی نباید شامل نام/شماره/تشخیص بیمار باشد (اسکن الگویی در CI).
- `/api/health` + `/metrics` در Compose Health-checks؛ Grafana Dashboard اولیه در فاز 06.
- هر Job صف با `jobId` + `correlationId` لاگ می‌شود — بررسی در تست Integration.
