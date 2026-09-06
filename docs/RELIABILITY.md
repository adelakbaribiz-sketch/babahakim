# RELIABILITY — مهندسی قابلیت اطمینان (PHASE 17)

> فرمان فاز: «Failure Scenarioهای کل سیستم را بررسی کن… را تست کن. در صورت نیاز: Retry، Timeout، Circuit Breaker، Idempotency، Dead Letter Queue، Graceful Degradation، Recovery پیاده کن.»

این سند نتیجهٔ ممیزی، الگوهای پیاده‌شده، آزمون‌های آشوب (Chaos) و رونبی عملیاتی فاز ۱۷ است. منبع تصمیمها: ADR-0021 و کاتالوگ ED-187..196.

---

## §1 — ممیزی شکست‌سناریوها (R-1..R-11)

قبل از هر تغییری، هر یازده سناریوی فرمان در برابر کد واقعی ممیزی شد:

| # | سناریو | وضعیت قبل از فاز ۱۷ | اقدام |
|---|---|---|---|
| R-1 | Database Down | خطاهای P1001/SQLITE_* به INTERNAL 500ِ مبهم فرو می‌ریختند؛ کلاینت «باگ سرور» را از «قطعی» تشخیص نمی‌داد | تاکسونومی SERVICE_UNAVAILABLE (§3) |
| R-2 | Redis/Cache Down | CacheStore پیوند const غیرقابل‌تعویض؛ خطای لایهٔ کش کل درخواست را می‌شکست | لایهٔ یکبارمصرف + degrade-to-loader (§4) |
| R-3 | Worker Down | مرگ تایمر worker نامرئی برای فرآیند (فقط gauge)؛ هیچ خودترمیمی نبود | tick ایزوله + خودترمیمی ensureWorker (§6) |
| R-4 | API Timeout | شغلها بدون timeout بودند — هندلر معلق claim را برای همیشه نگه می‌داشت | timeout هر شغل + نقشهٔ per-type (§6) |
| R-5 | External API Failure | ✅ از PHASE 13 (callIntegration: timeout/retry/breaker/idempotency/fallback) — مرجع، بازتکرار نشد | — |
| R-6 | Payment Failure | ✅ GATEWAY_FAIL صادق + 502 فارسی (فاز ۱۳)؛ **شروع مجدد پرداخت تکراری بدون حفاظ لایهٔ درخواست** | Idempotency مسیر پول (§5) |
| R-7 | Duplicate Request | هیچ حفاظ در سطح API؛ فقط idempotency دیتابی Provider | لایهٔ Idempotency درخواست (§5) |
| R-8 | Duplicate Callback | ✅ alreadyPaid + replay کلید verify (فاز ۱۳/۰۸) — با FS-5 بازتست زنده شد | — |
| R-9 | Network Failure | ✅ taxonomy NETWORK/TIMEOUT در classifyNetworkError (فاز ۱۳) | — |
| R-10 | Storage Failure | EIO/ENOSPC → 500؛ پروب آمادگی فقط fs.access (مونت read-only «ready» جعل می‌کرد!) | نگاشت 503 + پروب نوشت‌پذیری صادق (§7) |
| R-11 | Partial Failure | checkout اتمیک ✅ (فاز ۰۸)؛ اما **صف شغل فقط در حافظه بود** — کرش پروسه همهٔ شغلها را می‌بلعید (تحلیل AI، اعلانها، خروجیها) | صف پایدار + بازیابی کرش (§6) |

**بزرگ‌ترین شکاف**: صف شغل درون‌حافظه‌ای — «Worker Down» در سطح فرآیند یعنی «از دست رفتن دائمی کارهای در صف».

---

## §2 — هستهٔ تزریق خطا (Chaos Core)

`src/server/infrastructure/faults.ts` (ED-187) — شکست‌سناریوها را **قابل تست جلوی سرور زنده** می‌کند:

- خطاهای نامدار: `db:down` · `storage:down` · `worker:down` · `cache:down`
- **TTL زمان‌بندی‌شده**: هر فعال‌سازی خودبه‌خود خاموش می‌شود (پیش‌فرض ۳۰s) — یک دریل هرگز فراموش‌شده مسلح نمی‌ماند و تستها می‌توانند به بازگشت خودکار تکیه کنند
- **دو گارد سخت (هرگز در production قابل مسلح‌شدن نیست — REL1)**:
  1. `chaosEnabled()`: BUN_TEST / NODE_ENV=test / **BH_CHAOS=1** صریح
  2. کنسول `/api/v1/admin/chaos`: ADMIN + CSRF + رخداد Audit (`CHAOS_FAULT`)؛ بدون گارد env مسیر **404 نامرئی** است
- درزهای تزریق: DB از طریق seam هراس globalThis در `lib/db.ts` (الگوی ED-137b — lib بدون import @/server)، Storage در LocalDriver، Worker با stopWorker/ensureWorker، Cache با setCacheStore

## §3 — تاکسونومی خطای زیرساخت (ED-188)

- کد جدید: `SERVICE_UNAVAILABLE` (503) + `details.dependency` (db/storage/queue/external) + `retryAfterSec`
- `classifyInfraFailure` اشکال واقعی قطعی را می‌شناسد: Prisma **P1001/P1002/P2024**، SQLite `CANTOPEN/IOERR/READONLY/CORRUPT/BUSY/NOTADB`، fs `ENOSPC/EIO/EROFS/EMFILE`
- `apiRoute` هدر **Retry-After** برای SERVICE_UNAVAILABLE و GATEWAY_TIMEOUT می‌فرستد
- نتیجه: کلاینتِ خوش‌رفتار بازگشت‌شمارا می‌داند؛ متریک api_errors{code} قطعی را از باگ جدا می‌کند

## §4 — Cache یکبارمصرف (ED-189)

- هر عملیات store پشت facade خطامحور: خطا → **log + سقوط به loader** — درخواست کسب‌وکار هرگز نمی‌شکند
- `setCacheStore`/`resetCacheStore`: تعویض در زمان اجرا (تست آشوب + آداپتور Redis آینده بدون تغییر فراخوان)
- تست زنده (FS-2): cache:down فعال → GET products = **200 از loader**

## §5 — Idempotency درخواست (ED-191)

`src/server/infrastructure/idempotency.ts` + مدل `IdempotencyRecord`:

- **کلید دو مبدأ**: هدر `Idempotency-Key` (8..128 نویسه) **یا** کلید مشتق `sha256(userId|route|canonicalBody)` — یعنی دابل‌کلیکِ بدون هدر هم دیداپ می‌شود
- چرخه: `RUNNING → 409` (تکرار همزمان) · `DONE → بازپخش پاسخ ≤32KB + هدر Idempotency-Replayed: true` · `FAILED → حذف ردیف، اجرای واقعی مجدد` · RUNNING قدیمی‌تر از ۵ دقیقه = crash → FAILED
- مسیرهای محافظت‌شده: **POST /api/v1/orders (checkout)** · **POST /api/v1/payments** · POST /api/v1/cases
- پاسخ بزرگ‌تر از 32KB: DONE بدون body → تکرار بعدی 409 «قبلاً ثبت شده» (هیچ‌وقت دوباره اجرا نمی‌شود)
- پاکسازی TTL 24h (جاب hourly). یگانه‌گی `(userId, route, key)` رقابت همزمان را می‌بندد

## §6 — صف شغل پایدار + DLQ + بازیابی (ED-190)

`src/server/infrastructure/jobs.ts` v2 + مدل `DurableJob`:

- **هر enqueue یک ردیف**: PENDING → RUNNING (claim اتمیک `updateMany`) → DONE | بازگشت به PENDING (retry + backoff خطی) | DEAD (DLQ)
- **timeout هر شغل** (Promise.race): پیش‌فرض 120s؛ per-type: media-process/report-export/ai-evaluation 300s — هندلر معلق دیگر claim نمی‌گیرد
- **بازیابی کرش**: RUNNING با claimedAt قدیمی‌تر از ۵ دقیقه → PENDING (بوت + هر ۵ دقیقه)؛ PENDINGِ یتیم (owner مرده) → تحویل به هر worker
- **ownerPid**: هر worker فقط شغل خودش یا بی‌صاحب را claim می‌کند — سرور dev و تست هرگز شغل هم را نمی‌ربایند
- **Degradation**: اگر write صف شکست بخورد (DB قطع) شغل در حافظه اجرا می‌شود — صف در قطعی نمی‌میرد
- **tick ایزوله + خودترمیم worker**: خطای هر tick مهار می‌شود؛ مرگ loop با enqueue بعدی (≤30s از recurringها) خودش revive می‌شود — تست زنده FS-3
- **DLQ عملیاتی**: `GET /api/v1/admin/jobs` (لیست/آمار/صفحه‌بندی) + `POST …/[id]/replay` (بازنشانی به PENDING، Audit=JOB_REPLAY) + پنل UI در «رصد و پایش»
- Retention: DONE>7d · DEAD>30d (پاکسازی سخت، ED-172)

## §7 — Storage صادق (ED-192)

- پروب آمادگی حالا **از درایور واقعی** می‌نویسد/می‌خواند/حذف می‌کند (فایل probe در files/temp) — ENOSPC/EROFS/EIO/chaos آمادگی را degraded می‌کند (قبلاً fs.access مونت read-only را «ready» می‌گفت — REL9)
- خطاهای دیسک در toAppError → 503 storage با پیام فارسی

## §8 — رفع باگ واقعی کشف‌شده توسط آشوب

**AlertEvent re-open (پیش از فاز ۱۷)**: `key` سراسری یکتاست اما tick فقط ردیفهای OPEN را می‌خواند؛ هشداری که resolve شده و دوباره فعال می‌شد به create می‌رسید → **P2002 → کل tick fail** → هشدار بعد از اولین resolve هرگز دوباره fire نمی‌شد. آشوب فاز ۱۷ این را در هر ۶۰ ثانیه ظاهر کرد. اصلاح: **reopen ردیف قبلی** (status→OPEN، resolvedAt→null، fireCount++) + تحمل P2002 رقابتی. این همان الگوی «خودِ موتور پایش، شاهد ارزش فاز» است که در فاز ۱۵ تکرار شد.

---

## §9 — آزمون‌های آشوب (تست زنده فرمان «را تست کن»)

### Unit (`src/server/__tests__/reliability-core.test.ts` — ۲۵ تست)
تاکسونومی ۵۰۳ · گاردهای chaos (+ امتحان production-refusal) · degrade کش · کلید مشتق idempotency + TTL · durability ردیف · timeout هر شغل (کف 100ms) · صف حافظه‌ای در قطعی DB · بازیابی stale RUNNING · dead-hook · آینه از DB truth · اتمیسیته withTransaction.

### Integration زنده (`tests/integration/reliability.test.ts` — ۱۰ تست، سرور واقعی + BH_CHAOS=1)
| سناریو | اثبات |
|---|---|
| **FS-1 Database Down** | هر درخواست DB-دار = **503 + code + dependency=db + پیام فارسی + Retry-After: 5**؛ readiness → not_ready؛ بازگشت خودکار پس از TTL؛ db_errors_total>0 در متریک |
| **FS-2 Cache Down** | products = **200 از loader** (کش نمی‌شکند درخواست را) |
| **FS-3 Worker Down** | readiness=degraded (workerAlive=false) → **خودترمیمی ≤40s** (recurring→enqueue→ensureWorker) |
| **FS-4 Duplicate Request** | checkout دوبار → **SAME orderId + Idempotency-Replayed: true**؛ سبد خالی؛ سومی هم بازپخش |
| **FS-5 Payment Duplicates** | callback دوبار → **alreadyPaid**؛ start تکراری → بازپخش همان payment (نه نشست دوم)؛ دقیقاً ۱ ردیف Payment |
| **FS-6 Job → DLQ** | شغل بدون هندلر → DEAD در لیست → **replay** → دوباره DEAD (چرخهٔ کامل DLQ) |
| **FS-7 Crash Recovery** | RUNNING قدیمی ۱۰ دقیقه → recover → PENDING → worker → **DONE** |
| **FS-8 Storage Down** | آپلود multipart = **503 storage**؛ readiness=degraded (پروب نوشتن واقعی)؛ بازیابی با TTL |
| **FS-9 Authz کنترل‌پلین** | chaos/jobs: 401/403/404/409/400 — ماتریس کامل |

External-API/Circuit-Breaker/Timeout و Network (سناریوهای ۵/۹ فرمان + الگوی Circuit Breaker): پوشش زندهٔ موجود فاز ۱۳ (۲۵ unit + ۵ integration) — بازتکرار نشد، ارجاع.

### Smoke (`scripts/smoke-phase17.sh` — ۱۸/۱۸)
دریل مستقل با curl: مسلح‌سازی fault → 503 → Retry-After → not_ready → بازیابی TTL · cache degrade · DLQ lifecycle + replay · recover · idempotent checkout دوبل · authz · گیت REL.

---

## §10 — نگاشت الگوهای فرمان به پیاده‌سازی

| الگوی فرمان | کجا | مرجع |
|---|---|---|
| **Retry** | retry طبقه‌بندی‌شدهٔ callIntegration (فاز ۱۳) · backoff خطی صف شغل · retry واحد SQLITE_BUSY در withTransaction | ED-140/§6 |
| **Timeout** | per-attempt در callIntegration · ۱۵s گزارشها · **جدید: هر شغل 120s/300s** · tx 15s | ED-190/§6 |
| **Circuit Breaker** | per (kind,provider) فاز ۱۳ (CLOSED/OPEN/HALF_OPEN + fallback) | ED-140 |
| **Idempotency** | Payment (order-key/authority) · Provider-call replay · **جدید: لایهٔ درخواست با کلید مشتق** | ED-191/§5 |
| **Dead Letter Queue** | **جدید: DLQ دیتابی + بازیابی + کنسول ادمین + UI** | ED-190/§6 |
| **Graceful Degradation** | **جدید: 503 صادق + Retry-After · کش degrade-to-loader · صف degrade-to-memory · mock fallback (فاز ۱۳)** | ED-188/189 |
| **Recovery** | **جدید: بازیابی stale-claim + یتیم‌سازی owner + replay DLQ** · GATEWAY_FAIL→پرداخت جدید · recovery سه‌لایهٔ گردش کار (فاز ۱۲) | ED-190 |

---

## §11 — گیت CI: REL1..REL10

`npm run audit:reliability` (`scripts/reliability-audit.mjs`):
REL1 گارد دوگانهٔ chaos + seam تمیز lib/db · REL2 تاکسونومی قطعی · REL3 Retry-After · REL4 کش یکبارمصرف · REL5 قراردادهای صف پایدار (ردیف/claim اتمیک/timeout/ایزولاسیون/reset گارد) · REL6 بازیابی (بوت+۵min) · REL7 DLQ عملیاتی (ADMIN+Audit) · REL8 idempotency کامل · REL9 پروب نوشت‌پذیری · RL10 حضور سوئیتهای FS.

## §12 — کاتالوگ ED فاز

| ED | تصمیم |
|---|---|
| ED-187 | هستهٔ chaos دوگارد + TTL زمان‌بندی + درز تزریق (db seam / storage / worker / cache) |
| ED-188 | تاکسونومی SERVICE_UNAVAILABLE + Retry-After + dependency در details |
| ED-189 | کش یکبارمصرف: facade خطامحور + setCacheStore (سقوط به loader) |
| ED-190 | صف پایدار DurableJob: claim اتمیک ownerPid + timeout هر شغل + recovery + DLQ دیتابی + replay |
| ED-191 | Idempotency درخواست: کلید مشتق canonical + چرخه RUNNING/DONE/FAILED + سقف 32KB |
| ED-192 | پروب نوشت‌پذیری storage از درایور واقعی (رفع جعل ready مونت read-only) |
| ED-193 | replay فقط برای DEAD (409 برای بقیه) + بازنشانی attempts — رونبی DLQ |
| ED-194 | retention شغلها (DONE 7d/DEAD 30d) + idempotency 24h — پاکسازی سخت ED-172 |
| ED-195 | خودترمیمی worker: tick ایزوله + revive با enqueue (بدون restart بیرونی) |
| ED-196 | رفع باگ AlertEvent: reopen-after-resolve + تحمل P2002 رقابتی |

## §13 — بدهیهای صادقانه (D-17-*)

- **D-17-1** مالتی‌اینستنس: صف/کش/متریک تک‌پروسه‌ای (ownerPid فقط بهینه است نه fence توزیع‌شده) — پیمانش ED/ADR-0005 (Redis/BullMQ) راه رسمی
- **D-17-2** chaos کنسول فقط برای دریل — منطق فعال‌سازی در production به درگاه feature-flag نیاز دارد اگر روزی «درگیری آشوب استیج» خواسته شود
- **D-17-3** replay DLQ همهٔ انواع شغل را می‌پذیرد (بدون dry-run) — برای payloadهای حساس شاید replay مشروط به نوع لازم شود
- **D-17-4** مسیرهای idempotency-protected دستی توسعه می‌یابند (سه مسیر اول) — ثبت خودکار از scan مسیرهای POST پول‌دار بعدی
- **D-17-5** فاز ۰۹ remediation (۷۳ صفحه SC-ID) همچنان باز — پیوند با قابلیت اطمینان در بخش backup/restore

## §14 — اجرای مجدد آزمونها

```bash
# سرور با chaos فعال (دریل):
BH_CHAOS=1 JWT_SECRET=<32+chars> FIELD_ENC_KEY=<base64-32B> PORT=3000 NODE_ENV=production bun .next/standalone/server.js
bun test tests/integration/reliability.test.ts   # ۱۰ سناریوی زنده FS-1..FS-9
bun test src/server/__tests__/reliability-core.test.ts  # ۲۵ unit
bash scripts/smoke-phase17.sh                    # ۱۸ چک مستقل
npm run audit:reliability                        # گیت REL1..REL10
```

**بدون BH_CHAOS** کنسول chaos مسیر 404 است و هیچ fault قابل مسلح‌شدنی وجود ندارد (تست production-refusal در unit).
