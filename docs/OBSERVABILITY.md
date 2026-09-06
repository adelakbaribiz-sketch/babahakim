# PHASE 15 — Logging, Monitoring & Observability

> وضعیت: **انجام‌شده و راستی‌آزمایی‌شده** — پروبهای عمومی `/health` `/readiness` `/liveness`،
> موتور متریک کاردینالیته-مقید (CPU/Memory/Disk/Queue/API/DB/Business)، Trace + Correlation ID
> سرتاسری (W3C traceparent)، لاگ ساخت‌یافتهٔ قابل‌جستجو با Redaction دو-لایه، موتور هشدار
> یکپارچه با cooldown و auto-resolve — قرارداد «اطلاعات حساس در Log ذخیره نکن» سخت‌گارد شده.

دستور فاز:
**Logging** (Structured · Searchable · Traceable) ·
**Metrics** (CPU · Memory · API · DB · Queue · Errors · Latency · Business) ·
**Tracing** (Request ID · Correlation ID · Distributed Trace در صورت نیاز) ·
**Health** (Liveness · Readiness · Health) ·
**Alert برای خطاهای مهم** ·
**اطلاعات حساس ممنوع در Log**.

---

## 1. ممیزی پیش از فاز (O-1..O-10)

| # | شکاف | اثر | راه‌حل |
|---|---|---|---|
| O-1 | پروبهای سلامت غایب — spec §57 مسیرهای `/health` `/readiness` `/liveness` را الزام می‌کند | k8s/LB قادر به تصمیم نیست | ED-175 |
| O-2 | موتور متریک نداریم — `ms` فقط در خط لاگ؛ بدون counter/histogram/percentile | پایش کور | ED-167 |
| O-3 | DB بی‌ابزار — `BH_DB_LOG=1` فقط کوئری خام لاگ می‌کند؛ زمان/تعداد/خطا جمع نمی‌شود | تشخیص کندی DB ناممکن | ED-174 |
| O-4 | Queue بی‌متریک — enqueue/done/failed فقط لاگ؛ depth و DLQ فقط از workflowOverview | صف کور | ED-175 |
| O-5 | Correlation غایب — reqId فقط در همان درخواست؛ رویدادها/شغل‌ها/لاگها قابل پیگیری متقابل نیستند | عیب‌یابی cross-boundary دستی | ED-164/169 |
| O-6 | لاگ فقط stdout — بدون persistence/جستجو/کاوشگر (AuditLog جدا است) | «Searchable» ناممکن | ED-166/180 |
| O-7 | Alert موقت — integrations-monitor فاز ۱۳ تنها مورد؛ بدون قاعدهٔ یکپارچه/سطح‌بندی/cooldown/history | خطاهای مهم بی‌خبر می‌مانند | ED-177/179 |
| O-8 | Business متریک زنده نداریم — گزارش‌ها on-demand از DB | تایل «امروز» ندارد | ED-179 |
| O-9 | Redaction فقط کلیدمحور — مقدار PII (موبایل/JWT/کدملی/base64) با کلید بی‌گناه رد می‌شود | نشت PII در لاگ | ED-166 |
| O-10 | CPU/Memory/Disk/Event-loop پایش نمی‌شوند (§57) | فشار منابع نامرئی | ED-176 |

---

## 2. Trace & Correlation — `src/server/core/trace.ts` (ED-164)

- **AsyncLocalStorage** — یک `TraceContext` `{reqId, corrId, traceId, spanId, route, method, actor*}` برای
  کل زنجیره: route → service → job → event → log line → ServiceLog row؛ بدون تردیدن پارامتر.
- **Correlation ID**: هدر `X-Correlation-ID` ورودی (اعتبارسنجی ۴–۶۴ نویسه) یا mint `corr_*` — در پاسخ
  echo می‌شود، به شغل‌ها (enqueue) و لاگها تزریق می‌شود؛ «یک id برای دنبال‌کردن یک عمل کاربر».
- **W3C traceparent**: parse کامل (`00-<32hex>-<16hex>-01`، رد مقادیر صفر/نسخهٔ نامعتبر) + تولید
  child span برای هر درخواست و هر شغل؛ خروجی در هدر پاسخ — «Distributed Trace در صورت نیاز»:
  استقرار تک-سرویس فعلاً به propagation سبک بسنده می‌کند (سازگار با OTel؛ export کامل = D-15-2).
- **ادامهٔ trace در شغل‌ها** (ED-169): `enqueue` از ALS متادیتا می‌گیرد؛ `runJob` داخل `enterJobTrace`
  (span تازه، همان trace/corr) اجرا می‌شود — لاگهای شغل با درخواستِ مبدأ هم‌corrId می‌شوند.
- handler کل چرخهٔ درخواست (handler + catch + finally) را داخل `enterTrace` می‌پیچد تا لاگ
  «request rejected» و sink هم corrId داشته باشند.

## 3. Logger v2 — `src/server/core/logger.ts` (ED-166)

- **Structured**: خط JSON واحد (`t/lvl/svc/msg/corrId/traceId/…`) — grep/jq-friendly؛ فیلدهای trace
  به‌طور خودکار از ALS تزریق می‌شوند (بدون childLogger هم).
- **Redaction دو-لایه**:
  - لایهٔ کلید: regex `pass|token|secret|csrf|otp|…` → `[REDACTED]` (موجود از فاز ۰۸)
  - **لایهٔ مقدار** (جدید): موبایل `(+98|0)?9\d{9}` → `09••••4567` · JWT `eyJ…` → `[JWT]` ·
    کدملی ۱۰رقمی → ماسک · base64 بلند ≥۶۰ → `[BLOB:n]` · `?token=…` در URL → `[REDACTED]`
    — روی **مقدارها و msg** اعمال می‌شود (نشتی که با کلید بی‌گناه رد می‌شد، بسته شد).
- **Searchable**: (a) حلقهٔ درون‌حافظهٔ مقید ۵۰۰ خطی (tail API بدون DB)؛ (b) **ServiceLog** برای
  warn/error از طریق sink آتش-و-فراموش (batch ≤۵۰ / flush ۲s؛ emit هرگز بلاک/throw نمی‌کند).
  sink لایهٔ دفاع سوم دارد: ردیف «کثیف» (field با ظاهر secret) پیش از persist کل fields را می‌اندازد.
- **IP هش می‌شود** (`sha256[:12]`) — IP دادهٔ شخصی است اما برای forensics لازم است؛ حلقهٔ RAM کامل
  می‌ماند، ردیف مانا فقط hash (ED-173).
- `setTraceProvider`/`setLogSink` تزریق وابستگی — logger هیچ import سنگین ندارد (cycle-free).

## 4. Metrics — `src/server/core/metrics.ts` (ED-167/168)

Counter / Gauge / Histogram (p50/p95/p99/avg/max) با **مقررات ضد-unbounded خودِ observability**:

| گارد | مقدار | نقضِ چه چیزی را ناممکن می‌کند |
|---|---|---|
| MAX_LABELSETS | ۲۵۶ / متریک (اضافی → `_overflow`) | رشد خطی حافظه با انفجار route/label |
| MAX_SAMPLES | ۳۰۰ / labelset (جدیدترین‌ها) | histogram بی‌سقف |
| SERIES_RING | ۷۲۰ نقطه (۶h @ 30s) | timeseries بی‌سقف |
| routePattern | `/cases/cmtl…147` → `/cases/:id` | fragmentation مسیرهای پویا |
| MetricPoint blob | < 200KB | ردیف عظیم در DB |

- **API** (handler): `api_requests_total{route,method,status}` · `api_latency_ms{route}` ·
  `api_errors_total{code}` (**فقط 5xx** — خطای سرور = قابل-هشدار) · `api_rejected_total{code}` (4xx —
  دیده‌می‌شود ولی alarm نمی‌شود؛ ترافیک تست/پنتست 4xx-محور نرخ خطا را کاذب بالا نمی‌برد)
- **DB** (ED-174 — `$extends` روی کلاینت واحد): `db_queries_total{op,entity}` · `db_query_ms` ·
  `db_errors_total` — بدون تغییر رفتار؛ type در seam cast می‌شود
- **Queue** (jobs.ts): `queue_jobs_total{type,status=done|failed|dead}` · `job_duration_ms` ·
  گارژ `queue_depth`/`queue_dead`
- **Business** (رویدادها): `business_total{event}` برای user.registered · case.created ·
  ai.analysis.completed · order.created/paid · payment.verified · shipment.delivered ·
  ticket.created · media.infected · ai.drift + تایلهای «امروز» از کوئریهای مقید شاخص‌دار
  (users/cases/AI/orders/paid/revenue امروز — ED-168)
- **سیستم** (system.ts ED-176): CPU فرآیند (delta `process.cpuUsage`) · load/core ·
  heap/rss/external + سیستم (free/total) · Disk (statfs روی storage) · **Event-loop lag**
  (دریفت heartbeat 200ms) — هر probe با guard → null (تفاوت runtime هرگز crash نمی‌کند)

## 5. Health — ED-175 (مسیرهای دقیق spec §57)

| مسیر | عمق | بدنهٔ عمومی |
|---|---|---|
| `GET /liveness` | فقط «پاسخ می‌دهد؟» — **DB نمی‌خورد** (شکست DB نباید pod را بکشد) | `{status, uptimeSec}` |
| `GET /readiness` | DB ping (بودجهٔ ۳s) + queue worker + storage + bootstrap | `{status, checks{db,queue,storage,bootstrap}}` — فقط boolean |
| `GET /health` | ترکیبی + برای انسان/uptime-monitor | `{status: ok|degraded|down, uptimeSec, checks}` |

- معناشناسی: DB/bootstrap fail → `not_ready` (503) · queue worker/storage → `degraded`
- **حدافشاری**: پروبها standalone هستند (بدون apiRoute → متریک API را متورم نمی‌کنند — تست‌شده)؛
  جزئیات (نسخه/توپولوژی/latency/فهرست integration) فقط پشت کنسول ADMIN (ED-173)
- `dbPing()` با Promise.race ۳s — هرگز hang نمی‌کند

## 6. Alerts — ED-177/178/179

- **قواعد خالص** (`alertRules.ts` — بدون DB/IO/ساعت؛ ورودی داده، تست‌پذیر واحد):

| قاعده | آستانه | سطح |
|---|---|---|
| `db_unavailable` | ping fail | CRITICAL |
| `api_error_rate` | >۵٪ (≥۵۰ درخواست؛ فقط 5xx) — >۱۰٪ → CRITICAL | WARN/CRIT |
| `api_p95_latency` | >۳۰۰۰ms | WARN |
| `db_p95_latency` | >۱۵۰۰ms | WARN |
| `queue_dead_letters` | هر ردیف DLQ | CRITICAL |
| `queue_backlog` | >۱۰۰ pending | WARN |
| `queue_worker_stalled` | timer مرده | CRITICAL |
| `memory_pressure` | heap >۹۰٪ (>۹۷٪ CRIT) | WARN/CRIT |
| `event_loop_lag` | >۵۰۰ms | WARN |
| `disk_usage` | >۹۰٪ (>۹۵٪ CRIT) | WARN/CRIT |
| `integrations_unhealthy` | هر provider ناسالم (≥۲ → CRIT) | WARN/CRIT |

- **جدول آستانه واحد** (ED-178) — `ALERT_THRESHOLDS` — نقطهٔ واحد تیون ops.
- **چرخهٔ عمر** (alerts.ts): OPEN (fire اول → اعلان) → firing (re-fire با **cooldown ۱۵min**) →
  **RESOLVED خودکار** وقتی قاعده سالم شد → بازگشت ممکن. تاریخچه در `AlertEvent` (unique key).
- **تحویل**: in-app ADMIN همیشه · SMS فقط CRITICAL (از کانالهای notify فاز ۱۳ — هرگز فراخوانی مستقیم provider).
- **Payload فقط عدد/کلید** — PII هرگز وارد AlertEvent نمی‌شود (ED-173).
- **یکپارچه‌سازی** (ED-179): منطق ad-hoc `integrations-monitor` فاز ۱۳ حذف و در همان
  alert-evaluator (60s) تاشده — یک موتور، یک تاریخچه، یک cooldown.

## 7. Databuild — Prisma (ED-171/172)

سه جدول فقط-الحاقی، **hard-purge** (دادهٔ عملیاتی، نه رکورد پزشکی/تجاری — soft-delete موضوعیت ندارد):

| جدول | ریزش | ایندکس |
|---|---|---|
| `ServiceLog` (lvl/svc/msg/route/reqId/corrId/traceId/ipHash/fields) | ۳ روز | t · (lvl,t) · (svc,t) · reqId · (corrId,t) |
| `MetricPoint` (snapshot JSON مقید) | ۷ روز | at |
| `AlertEvent` (key/severity/status/fa/en/payload/fireCount) | ۹۰ روز | unique(key) · (status,lastSeenAt) |

migration: `20260906100000_observability_phase15` (additive — هیچ جدول موجود دست نخورد).

## 8. Bootstrap v8 — `sampler.ts` (ED-179)

| شغل | کادنس | کار |
|---|---|---|
| `metrics-sampler` | ۳۰s | probeها → gaugeها → series ring؛ هر تیک دوم → MetricPoint |
| `alert-evaluator` | ۶۰s | سیگنالها + integrationStatus → runAlertTick (چرخهٔ عمر + اعلان) |
| `business-today` | ۶۰s | تایلهای امروز (کوئریهای مقید شاخص‌دار) |
| `observability-retention` | روزانه | purge سه جدول |

+ `setTraceProvider` · `setLogSink(serviceLogSink)` · `registerBusinessCounters()` ·
`markBootstrapped()` (فلگ readiness) — v8 چون شکل wiring عوض شد (HMR-safe).

## 9. قرارداد API

| مسیر | دسترسی | شرح |
|---|---|---|
| `GET /health` `/liveness` `/readiness` | عمومی | حداقلی (بالا) |
| `GET /api/v1/admin/observability` | ADMIN | snapshot کامل: health+system+queue+db+metrics+series+integrations+alerts+logs |
| `GET /api/v1/admin/logs` | ADMIN | جستجوی ServiceLog (q/lvl/svc/route/reqId/corrId + صفحه‌بندی مقید؛ `live=1` = حلقه) |
| `GET /api/v1/admin/alerts` | ADMIN | فهرست هشدارها |
| `POST /api/v1/admin/alerts` | ADMIN | resolve دستی `{id}` → 404/422 + **Audit ALERT_RESOLVE** |

همهٔ هدرهای پاسخ: `X-Request-Id` (قرارداد v1 حفظ شد) + `X-Correlation-Id` + `traceparent` (ED-165).

## 10. Frontend — کنسول «رصد و پایش»

`AdminViews4.tsx` (lazy chunk) در nav ادمین: بنر سلامت + uptime + probeها · ۶ کارت سیستم
(CPU/Heap/Disk/Loop/DB/Queue) · ۶ کارت API/Business (درخواست/خطا/امروزها/درآمد) ·
نمودارهای زندهٔ recharts (p95 API + heap، از series ring) · فید هشدار با chip سطح و
دکمهٔ Resolve (audited) · خلاصهٔ integrations · کاوشگر لاگ (جستجو + سطح + دم حلقه) —
i18n کامل fa/en + ارقام فارسی + Jalali.

## 11. تست‌ها

- **۴۴ unit** (`observability.test.ts`): scrub موبایل/JWT/کدملی/BLOB/URL-secret · کلید+مقدار ·
  sink فقط warn/error + ورودیِ قبلاً-پاک‌شده · تزریق trace در خط لاگ · parse/رد traceparent ·
  ALS انتشار + ایزولاسیون · enterJobTrace · counter/histogram/percentile/gauge/سری مقید ·
  labelset-fragmentation · routePattern · ۱۳ قاعدهٔ alert (هر آستانه/escalation) · گاردهای sink + ipHash
- **۱۶ integration** (`tests/integration/observability.test.ts`): سه پروب عمومی (شکل/بدنه) ·
  echo Correlation + traceparent (ادامهٔ trace-id والد + span تازه) · mint برای ورودی خراب ·
  قرارداد X-Request-Id حفظ · authz (401/403/200) · متریک زندهٔ بعد از ترافیک واقعی ·
  جستجوی لاگ + **عدم وجود موبایل خام در نتایج** · فیلتر corrId (poll flush) ·
  صفحهٔ عمیق ۴۲۲ · alerts 403/404/400 · دم حلقه · **پروبها متریک API را متورم نمی‌کنند**

## 12. گیت CI — `npm run audit:observability` (OBS1..OBS10)

مسیرهای پروب دقیق spec · پروبها standalone و حداقلی (بدون apiRoute/توپولوژی) · پوشش apiRoute
درون routeها · Redaction کلید+مقدار + گاردهای sink · بدون console.* در server (نقض واقعی
ai/security.ts:73 یافته و **اصلاح شد**) · سقفهای کاردینالیتی · قواعد واحد + cooldown +
auto-resolve + wiring · ADMIN-gating سه مسیر · purge سه جدول · بدون literal PII.

## 13. تصمیمات مهندسی (ED-164..180)

| ED | تصمیم |
|---|---|
| ED-164 | ALS برای trace/corr؛ تزریق خودکار در لاگ؛ W3C traceparent سازگار-OTel (propagation؛ export = بدهی) |
| ED-165 | هدرهای خروجی Correlation + traceparent در همهٔ پاسخها؛ X-Request-Id حفظ |
| ED-166 | Redaction دو-لایه (کلید + مقدار)؛ sink batch آتش-و-فراموش + گارد سوم؛ IP هش در DB |
| ED-167 | موتور متریک در-پردازشی (counter/gauge/histogram) — Prometheus scrape = بدهی D-15-1 |
| ED-168 | کاردینالیته مقید: labelset cap + routePattern + سقف histogram/سری + blob cap |
| ED-169 | trace continuation در صف شغل‌ها (meta در enqueue + enterJobTrace در worker) |
| ED-170 | Business متریک = رویداد-محور (شمارنده) + «امروز» از کوئری مقید (نه scan) |
| ED-171 | سه جدول ops فقط-الحاقی |
| ED-172 | Retention hard-purge (3d/7d/90d) — دادهٔ ops، نه رکورد پزشکی |
| ED-173 | افشای حداقلی پروبهای عمومی؛ IP هش؛ payload هشدار عدد/کلید؛ جزئیات پشت ADMIN |
| ED-174 | ابزار دقیق DB با Prisma $extensions روی کلاینت واحد (type-cast در seam) |
| ED-175 | معناشناسی liveness (بی-DB) / readiness (DB+worker+storage+bootstrap) / health |
| ED-176 | probeهای سیستم با degrade-to-null (تفاوت runtime Bun/Node هرگز crash نمی‌کند) |
| ED-177 | موتور هشدار با چرخهٔ OPEN→RESOLVED خودکار + cooldown |
| ED-178 | جدول آستانهٔ واحد ALERT_THRESHOLDS |
| ED-179 | integrations-monitor فاز ۱۳ در alert-evaluator تاشد (یک موتور) |
| ED-180 | سرویس/مسیرهای ADMIN + کنسول یکپارچه + جستجوی لاگ مقید |

## 14. بدهی‌ها (D-15-*)

- **D-15-1** (S2): endpoint `/metrics` با exposition Prometheus برای scrape k8s
- **D-15-2** (S2): export OTel واقعی (collector) برای distributed trace چند-سرویس
- **D-15-3** (S3): انتقال متریک/سری به storage خارجی (Prometheus/VictoriaMetrics) برای مانداور چند-INSTANCE
- **D-15-4** (S3): alert routing به کانال خارجی (Telegram/Email ops) بجز SMS
- **D-15-5** (S4): ServiceLog → Loki/Elastic برای retention بلندمدت و جستجوی مرکزی
- **D-15-6** (S4): histogramهای t-digest به‌جای آرایهٔ خام (دقت/حافظه در حجم بالا)

## 15. پیوند به اسناد

- ADR: `docs/ADR/ADR-0019-observability-stack.md`
- قواعد: `docs/BUSINESS-RULES.md §10 (BR-OBS-01..10)`
- PRD/RTM: ردیف فاز ۱۵
- رجیستری قبلی: SEARCH-REPORTING.md §9 (ED-151..163) — فاز ۱۵ از ED-164 ادامه داد (بدون تصادم)
