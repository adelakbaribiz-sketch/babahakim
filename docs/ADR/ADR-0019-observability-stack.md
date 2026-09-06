# ADR-0019 — Observability Stack: Trace-first, Bounded Metrics, Unified Alerts

- **Status**: Accepted (2026-09-06)
- **Phase**: 15 — Logging, Monitoring & Observability
- **Deciders**: Lead Architect (per charter)
- **Related**: ADR-0018 (bounded search/reporting), ADR-0017 (integration layer)

## Context

فاز ۱۵ چهار الزام صریح دارد: لاگ ساخت‌یافته/قابل‌جستجو/قابل‌ردیابی، متریک (CPU/Memory/API/DB/
Queue/Errors/Latency/Business)، Trace (Request/Correlation/Distributed) و Health
(liveness/readiness/health) به‌علاوهٔ Alert برای خطاهای مهم و ممنوعیت PII در لاگ. ممیزی
O-1..O10 نشان داد زیرساخت فاز ۰۸ (logger JSON + reqId) و فاز ۱۳ (تله‌متری integration)
فقط اجزای پراکنده‌اند: پروب سلامت وجود ندارد، متریک جمع نمی‌شود، correlation از مرز درخواست
عبور نمی‌کند و alert موقتِ تک-موردی است.

## Decision

1. **Trace-first via AsyncLocalStorage** (ED-164): یک `TraceContext` (reqId/corrId/traceId/spanId)
   در ALS؛ همهٔ لایه‌ها (سرویس/شغل/رویداد/لاگ/ServiceLog) بدون تردیدن پارامتر هم‌زمینه می‌شوند.
   Correlation از هدر می‌آید یا mint می‌شود؛ W3C traceparent parse/propagate می‌شود (سازگار OTel).
2. **Logger v2 با Redaction دو-لایه** (ED-166): کلید + **مقدار** (موبایل/JWT/کدملی/BLOB/URL-secret)؛
   sink مانا batch-شده برای warn/error با گارد سوم؛ IP هش در DB.
3. **متریک در-پردازشی مقید** (ED-167/168): counter/gauge/histogram با سقف labelset (256) و
   routePattern (`:id`) — «ضد-unbounded» به خودِ observability هم رسید. `api_errors_total`
   فقط 5xx است (4xx = `api_rejected_total`؛ ترافیک probe/test alarm کاذب نمی‌سازد).
4. **Health با معناشناسی k8s** (ED-175): liveness هیچ‌گاه DB نمی‌خورد؛ readiness DB+worker+storage+
   bootstrap؛ پروبها عمومی-حداقلی و standalone (متریک API را متورم نمی‌کنند).
5. **موتور هشدار واحد** (ED-177..179): قواعد خالص + جدول آستانهٔ واحد + چرخهٔ OPEN→
   RESOLVED خودکار + cooldown ۱۵min + تحویل in-app/SMS؛ integrations-monitor فاز ۱۳ تاشده.
6. **سه جدول ops فقط-الحاقی** (ED-171/172) با hard-purge 3d/7d/90d — دادهٔ عملیاتی نه پزشکی.

## Alternatives considered

- **Pino/Winston + OpenTelemetry SDK**: وابستگی سنگین برای استقرار تک-سرویس SQLite؛
  JSON-line + ALS + traceparent همان قراردادها را بدون dependency می‌دهد؛ مهاجرت به OTel
  بعداً فقط export layer است (D-15-2).
- **Prometheus client + /metrics**: exposition بی‌درنگ لازم نبود (single-instance)؛ snapshot JSON
  + سری ring پاسخ کنسول است؛ endpoint متن Prometheus بدهی D-15-1.
- **ELK/Loki**: «Searchable» v1 با ServiceLog + LIKE جستجو + tail حلقه برآورده می‌شود؛
  retention بلند و جستجوی مرکزی = D-15-5.

## Consequences

- ✅ فرمان فاز کامل: ۵/۵ بُعد Logging، ۸/۸ متریک، ۳/۳ Trace، ۳/۳ Health، ۱۱ قاعدهٔ Alert، PII-guard سخت
- ✅ موتور هشدار زنده در همان چرخهٔ Test→Fix **دو باگ واقعی** کشف کرد: فیلد ناموجود
  `paidAt` در aggregate پرداخت + نرخ خطای کاذب از شمارش 4xx — هر دو اصلاح شدند
- ✅ قرارداد v1 (X-Request-Id) حفظ؛ E2E قبلی بدون تغییر سبز ماند
- ⚠️ متریک/بریکر در-حافظه‌اند — مانداور چند-INSTANCE نیازمند D-15-3
- ⚠️ Prisma SQLite کوئری در-پرواز را cancel نمی‌کند — بودجهٔ timeout پاسخ را می‌بندد نه موتور را
