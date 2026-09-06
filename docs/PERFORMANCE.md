# PERFORMANCE — مهندسی کارایی BabaHakim (PHASE 16)

> **فرمان فاز:** «Performance Audit انجام بده… Bottleneckها را پیدا کن… Optimization بدون Measurement انجام نده.»
> این سند پاسخ کامل آن فرمان است: ابتدا **ابزار اندازه‌گیری** ساخته شد، سپس **baseline** ثبت شد، سپس — و فقط بر اساس اعداد — بهینه‌سازی اعمال شد و در پایان **after** مجدداً اندازه‌گیری شد.

| فیلد | مقدار |
|---|---|
| فاز | PHASE 16 — Performance Engineering |
| وضعیت | ✅ پیاده‌سازی و اعتبارسنجی‌شده (گیت PERF1..PERF10 PASSED) |
| معادل ED | ED-181..186 |
| ADR | [ADR-0020](./ADR/ADR-0020-performance-measurement-first.md) |
| قوانین کسب‌وکار | BR-PERF-01..10 در `BUSINESS-RULES.md §11` |
| گیت CI | `npm run audit:perf` → `scripts/perf-audit.mjs` |
| هارنس‌های اندازه‌گیری | `scripts/perf-bench.mjs` · `perf-db-plan.py` · `perf-frontend.mjs` · `perf-pipeline.mjs` · `perf-ai-flow.mjs` |
| مصنوعات اندازه‌گیری | `scripts/perf-http-{baseline,after}.json` · `perf-db-{baseline,after}.json` · `perf-frontend-baseline.json` · `perf-ai-flow-{baseline,after}.json` |

---

## §1 — روش‌شناسی: اندازه‌گیری مقدم بر بهینه‌سازی

قانون حاکم بر کل فاز: **هیچ بهینه‌سازی بدون عدد قبلی و عدد بعدی اعمال نشد.** برای هر حوزه‌ای که فرمان خواسته بود، ابتدا هارنس اختصاصی ساخته شد:

| حوزه فرمان | هارنس | چه اندازه‌گیری می‌کند |
|---|---|---|
| Frontend Load | `perf-frontend.mjs` | سرور production (standalone روی :3100) — حجم HTML، همه assetهای ارجاع‌شده، **wire-size واقعی با http خام** (fetch به‌طور خودکار gzip را باز می‌کند و عدد را جعل می‌دهد — این خطای اندازه‌گیری در طول baseline کشف و اصلاح شد)، نسبت فشرده‌سازی، هدر cache |
| API Latency | `perf-bench.mjs` | ۱۲ endpoint × N=30 (با ۳ warmup) — p50/p95/p99 کلاینتی + **db/req سمت سرور** از رجیستری متریک فاز ۱۵ (با کم‌کردن هزینهٔ خود endpoint observability) + الگوی Cold (پس از انقضای TTL کش) |
| Database / Queries | `perf-db-plan.py` | EXPLAIN QUERY PLAN برای ۲۷ کوئری داغ (SCAN vs INDEX) + شمارش سطر + وضعیت PRAGMAها + تست مقیاس ۵۰k سطر (همان شکل کوئری با/بدون ایندکس) |
| Cache | `perf-bench.mjs` | Cold (پس از TTL) در برابر Warm برای داشبورد/کاتالوگ/گزارش + db/req |
| Queue / File / AI | `perf-pipeline.mjs` + `perf-ai-flow.mjs` | زمان ۲۰۲ پذیرش، job_duration_ms از متریک صف (media-process/ai-analysis)، سناریوی کامل «آپلود زبان → اعتبارسنجی → ایجاد پرونده → تحلیل AI» |

همه هارنس‌ها tag-دارند (`--tag baseline|after`) و خروجی JSON مانا می‌سازند تا مقایسه بازتولیدپذیر باشد.

## §2 — Baseline (قبل از هر تغییری)

### §2.1 Database — جدی‌ترین یافته‌ها
- **۲۴ از ۲۷ کوئری داغ Full-Scan بودند** (EXPLAIN QUERY PLAN). ستون‌های FK (patientId/userId/caseId/ticketId/orderId) در SQLite ایندکس ندارند — SQLite ایندکس خودکار برای FK نمی‌سازد.
- **journal_mode=delete + synchronous=FULL**: بنچمارک فایل‌محور (fsync واقعی؛ نسخهٔ in-memory عدد جعلی می‌داد): ۰٫۰۷۸ms در برابر ۰٫۰۱۰ms به‌ازای هر INSERT → **WAL ×۷٫۵ تا ×۸٫۶ سریع‌تر در نوشتن** + خواننده‌ها هنگام نوشتن قفل نمی‌شوند.
- AuditLog (۳٬۶۴۶ سطر — پرنویس‌ترین جدول سیستم) بدون هیچ ایندکس: `ORDER BY createdAt` = ۱٫۷۸ms full-scan که با رشد جدول خطی بزرگ می‌شود.
- تست مقیاس مصنوعی (۵۰k سطر، همان WHERE patientId + ORDER BY): **×۵۰۷ با ایندکس**. این عدد هزینهٔ الگوریتمی حذف full-scan است، مستقل از اندازهٔ دادهٔ فعلی.

### §2.2 API (سرور dev گرم، N=30)
- `auth/me`: p95=42.59ms با ۲ کوئری/درخواست — هر درخواست authenticate شده یک `user.findUnique` می‌پرداخت.
- **هر endpoint حتی با کش کامل هم ۱-۲ کوئری getAuth می‌پرداخت** (dاشبورد warm: 1 db/req که همان getAuth بود).
- داشبورد staff سرِ cold: **۲۱ کوئری** (۱۷ count + 2 aggregate + 2 list) = ۳۵٫۸ms؛ آمار staff برای همهٔ کاربران یکسان بود ولی per-user کش می‌شد.
- search: 7 db/req؛ audit-logs: 3 db/req؛ login: ~۹۰ms (غالب scrypt).

### §2.3 Frontend (سرور production واقعی)
- First-load: **۱۴۳۴٫۳ KB identity → ۴۵۵٫۴ KB روی wire (gzip ۶۸٫۳٪)** — فشرده‌سازی فعال بود.
- ۱۹ فایل در first-load؛ ۲۸ chunk JS؛ static جمع ۲٫۶MB؛ chunkهای سنگین ادمین (~۳۹۰KB×2) **خارج از first-load** (lazy از فاز ۰۸).
- `cache-control: public, max-age=31536000, immutable` روی static ✓؛ HTML 10.2KB.
- خطای اندازه‌گیری کشف‌شده: fetch خودکار decompress می‌کند؛ عدد ۰٪ اولیه جعلی بود → با `perf-lib-wire.mjs` (http خام) اصلاح شد.

### §2.4 File / AI / Queue
- آپلود تصویر: ۲۰۲ در ۲۹–۸۹ms (خارج‌شدن از مسیر درخواست از فاز ۱۰ سالم است).
- job `media-process`: p50=۱۲۲–۱۴۷ms؛ job `ai-analysis`: p50=۵۸–۸۳ms (mock provider).
- سناریوی کامل بیمار: upload→validate→case→AI ≈ ۲۴۰ms کار واقعی، درخواست فقط ۲۹ms.
- **یافته:** `rerun-ai` تحلیل را **همگام در مسیر درخواست** اجرا می‌کند (با provider زندهٔ سیاست ۳۰s timeout فاز ۱۳ → ریسک اشغال thread درخواست). اندازه‌گیری فعلی (mock): ۱۱۴–۳۱۳ms → به‌عنوان بدهی مستند شد (D-16-1)، چون عدد فعلی توجیه‌کنندهٔ تغییر قرارداد API نیست.

## §3 — Bottleneckها (فقط آنچه عدد داشت)

| # | گلوگاه | شواهد اندازه‌گیری‌شده | اصلاح |
|---|---|---|---|
| B1 | SQLite DELETE-journal + sync FULL | ×۷٫۵–۸٫۶ کندتر در بنچمارک نوشتن | ED-182 |
| B2 | ۲۴/۲۷ کوئری داغ full-scan | EXPLAIN + ×۵۰۷ تست مقیاس | ED-181 |
| B3 | getAuth: یک کوئری User به‌ازای هر درخواست | db/req=۱-۲ روی همهٔ endpointها؛ p95 auth/me=۴۲٫۶ms | ED-183 |
| B4 | داشبورد staff: ۲۱ کوئری cold + کش per-user برای آمار role-global | cold ۳۵٫۸ms؛ ۱۷ count | ED-184 |
| B5 | First-load ۱٫۴MB | gzip فعال (۶۸٪)؛ lazy سالم | بدون اقدام کد — CDN seam (ED-185) + مستندسازی |
| B6 | rerun-ai همگام | ۱۱۴–۳۱۳ms (mock) | بدهی D-16-1 |

## §4 — بهینه‌سازی‌های اعمال‌شده

### ED-181 — ایندکس‌های مسیرهای داغ (۲۸ ایندکس)
مجموعه ایندکس‌ها از **EXPLAIN داده‌شده** استخراج شد نه از حدس؛ ترتیب ستون‌های مرکب آینهٔ WHERE+ORDER BY سرویس‌هاست:

`MedicalCase(patientId,createdAt)` `(status,createdAt)` `(createdAt)` · `Order(userId,createdAt)` `(status,createdAt)` `(createdAt)` · `Payment(status,createdAt)` `(orderId)` · `Ticket(userId,updatedAt)` `(status,updatedAt)` · `TicketMessage(ticketId,createdAt)` · `CaseEvent(caseId,createdAt)` `(createdAt)` · `AIAnalysis(caseId)` · `MedicalImage(caseId,createdAt)` · `Invoice(orderId)` · `OrderItem(orderId)` · `Notification(userId,read,createdAt)` · `FollowUp(status)` `(patientId,dueDate)` · `AuditLog(createdAt)` `(userId,createdAt)` `(action,createdAt)` · `SMSLog(sentAt)` · `QuestionnaireResponse(userId,createdAt)` · `Diagnosis(caseId)` · `Prescription(caseId,createdAt)` · `FinancialTransaction(type,createdAt)`

`schema.prisma` منبع واحد است (ایندکس‌ها در schema + migration دستی `20260906140000_perf_indexes_phase16` + `db push`). **باقی‌ماندهٔ صادقانه:** ۲ full-scan باقی‌مانده کوئریهای `LIKE '%…%'` جستجو هستند که B-tree به‌ارزشتی برای آنها ندارد — این یک **تصمیم طراحی فاز ۱۴** است (ED-152) و رفع کامل آن به tsvector در Postgres وابسته است (D-16-2).

### ED-182 — WAL + synchronous=NORMAL + busy_timeout
`src/lib/db.ts` در boot یک re-assert ایدمپوتنت و fail-safe اجرا می‌کند (WAL در فایل DB مانا است). نتیجهٔ اندازه‌گیری‌شده در §5.

### ED-183 — کش هویت getAuth
TTL=۱۰s، سقف ۲۵۶ ورودی با evict قدیمی‌ترین، ذخیره روی globalThis (HMR-safe). **قرارداد امنیتی:** ابطال صریح در ۵ مسیر تغییر — logout، login، ویرایش کاربر توسط ادمین (role/isActive)، تکمیل حذف حساب (anonymize)، ویرایش پروفایل (نام). پنجرهٔ کهنگی باقی‌مانده (≤۱۰s) فقط ویرایش مستقیم DB را پوشش می‌دهد که از قبل هم تضمینی نداشت. تست integration: غیرفعال‌سازی توسط ادمین → درخواست بعدی **همان لحظه** ۴۰۱ (نه پس از TTL).

### ED-184 — Batching + کش نقش‌محور داشبورد
- ۹ count وضعیتی → **۲ `groupBy(status)`** (+۱ برای بیمار): cold staff از ۲۱ کوئری به **۹ کوئری مشترک + ۱ کوئری به‌ازای کاربر (unreadSelf)** رسید.
- آمار staff-wide یک بار per-process کش می‌شود (`dash:staff:shared`)، صف به تفکیک نقش (`dash:staff:queue:{role}`) — N کاربر ادمین دیگر N کپی یکسان نمی‌سازند.
- تست معادل‌سازی: اعداد groupBy == count مستقیم (staff + patient) در integration test.

### ED-185 / ED-186 — CDN seam + فشرده‌سازی صریح
`compress: true` صریح در next.config (عدد اندازه‌گیری‌شده ۶۸٫۳٪) + `assetPrefix` سابقه `NEXT_PUBLIC_CDN_BASE` (no-op محلی؛ فعال‌سازی در deployment با به‌روزرسانی CSP مطابق SECURITY.md). Brotli با edge proxy → D-16-3.

## §5 — نتیجهٔ after (اندازه‌گیری مجدد، همان هارنس)

### §5.1 Database
| متریک | Baseline | After |
|---|---|---|
| کوئری داغ full-scan | ۲۴ / ۲۷ | **۲ / ۲۷** (هر دو LIKE — طراحی) |
| ایندکس‌های نام‌دار | ۵۶ | **۸۴** |
| journal mode | delete (sync=FULL) | **wal** (+NORMAL + busy_timeout 5s) |
| بنچمارک نوشتن | ×۱ (مبنا) | **×۷٫۵–۸٫۶** (مستقیم WAL) |
| تست مقیاس ۵۰k (WHERE patientId) | ۲٫۶ms | **۰٫۰۰۶ms** |

### §5.2 API (dev server گرم، N=30)
| Endpoint | p95 B→A | db/req B→A |
|---|---|---|
| auth/me | ۴۲٫۶ → **۱۴٫۸ms** (−۶۵٪) | ۲ → **۱** |
| dashboard/patient | ۲۷٫۳ → **۱۴٫۲ms** | ۱ → **۰** |
| dashboard/patient **COLD** | ۲۲٫۲ → **۱۹٫۳ms** | — |
| dashboard/admin **COLD** | ۳۵٫۸ → **۲۴٫۴ms** (−۳۲٪) | ۲۱ → ۹+۱ کوئری |
| cases (admin/patient) | — | ۳ → **۲** |
| orders / notifications / audit-logs | — | ۳/۲/۳ → **۲/۱/۲** |
| report (warm) | — | ۱ → **۰** |
| search | — | ۷ → **۶** |

p50‌ها در dev-mode تغییر کمی دارند (کف ~۱۰ms فریم‌ورک dev غالب است)؛ **سیگنال اصلی فاز p95، db/req و Coldها هستند.** دو p95 پرت در اجرای after (cases 83ms / search 93ms) hiccup کامپایل dev هستند و در p50 منعکس نشده‌اند. عدد نهایی کارایی سمت سرور باید در production standalone سنجیده شود (§7/D-16-5).

### §5.3 Frontend
تغییر کد Frontend نداشتیم (gzip فعال بود، lazy سالم بود) → اعداد baseline معتبر می‌ماند: ۱۴۳۴KB identity / ۴۵۵KB wire / immutable cache / ۱۳ chunk lazy ادمین. CDN seam برای آینده فعال شد.

## §6 — فرمان‌های «در صورت نیاز» — وضعیت تک‌تک

| فرمان | وضعیت | مستند |
|---|---|---|
| Caching | ✅ داشبورد/کاتالوگ/گزارش از قبل + **کش هویت (ED-183) + کش staff-shared (ED-184)** | §4 |
| Indexing | ✅ ۲۸ ایندکس اندازه‌گیری‌شده | ED-181 |
| Async | ✅ سالم از فاز ۱۰/۱۱ (متریک زنده: media 122–222ms، AI 58–83ms)؛ rerun-ai → بدهی | D-16-1 |
| Batching | ✅ groupBy داشبورد ۲۱→۹+۱ | ED-184 |
| Connection Pooling | SQLite تک‌فایل: معادل آن **WAL** (خواننده/نویسنده موازی) + busy_timeout؛ Postgres pool در مسیر مهاجرت (ADR-0004) | ED-182 |
| Pagination | ✅ از فاز ۱۴ (SEARCH_BOUNDS/REPORT_BOUNDS) — گیت PERF10 عدم‌رگرسیون را می‌سنجد | §4 |
| Lazy Loading | ✅ ۱۳ dynamic chunk — گیت PERF8 | §5.3 |
| CDN | 🔧 seam آماده (`NEXT_PUBLIC_CDN_BASE`) — در sandbox محلی قابل‌فعال‌سازی نیست؛ مستندسازی فعال‌سازی | ED-185 |
| Compression | ✅ gzip ۶۸٫۳٪ فعال و اندازه‌گیری‌شده؛ Brotli بدهی | ED-186 |
| Queue | ✅ متریک per-job (فاز ۱۵) + اعداد این فاز؛ معماری BullMQ-swappable سالم | §2.4 |
| Horizontal Scaling | 🔧 مستندسازی وضعیت: صف/کش/متریک/محدودیت‌نرخ در-حافظه‌اند ولی همه پشت Port (ADR-0005 CacheStore/JobQueue) → استخراج به Redis بدون بازنویسی؛ SQLite تک-نویسنده = سقف فعلی؛ مسیر Postgres (ADR-0004) + Redis (ADR-0005) + پیمانش افقی worker (ADR-0003) | ADR-0003/0004/0005 |

## §7 — بدهی‌های فاز (D-16-*)

| بدهی | شرح | بزرگ‌نمایی |
|---|---|---|
| D-16-1 | rerun-ai همگام در مسیر درخواست — با provider زنده (سیاست timeout ۳۰s) ریسک قفل thread؛ قرارداد فعلی ۲۰۰+result است و UI آن را صدا نمی‌زند؛ مهاجرت به ۲۰۲+enqueue وقتی provider زنده فعال شد | متوسط |
| D-16-2 | دو full-scan باقی‌مانده LIKE جستجو — رفع با tsvector پس از مهاجرت Postgres (ADR-0004) | کم (دادهٔ فعلی کوچک) |
| D-16-3 | Brotli روی wire — نیازمند edge proxy (nginx/CDN)؛ gzip فعلی ۶۸٪ می‌گیرد | کم |
| D-16-4 | synchronous=NORMAL فقط روی اتصال boot اعمال می‌شود (Prisma pool per-connection PRAGMA ندارد)؛ WAL خودش مانا است | کم |
| D-16-5 | بنچمارک production-mode (standalone) برای p50/p95 نهایی — هارنس آماده است (`BH_BASE` + `perf-frontend.mjs` از قبل روی prod اجرا می‌شود) | متوسط (M17) |
| D-16-6 | حافظهٔ dev-server در ظرف ۴GB زیر بار تست به OOM می‌رسد (کشف این فاز: dmesg) — محدودیت محیط dev؛ سرور standalone سبک‌تر است | مستندسازی |

## §8 — تست و اعتبارسنجی

- **۶ تست integration جدید** (`tests/integration/performance.test.ts`): کش هویت (delta کوئری User ≤۲ به‌ازای ۵ درخواست) · **ابطال امنیتی** (غیرفعال‌سازی ادمین → ۴۰۱ در همان درخواست بعدی) · معادل‌سازی آمار staff (groupBy == count مستقیم، ۶ سنجه) · معادل‌سازی آمار بیمار · WAL فعال · وجود ۲۸ ایندکس.
- **گیت CI `PERF1..PERF10`** (`npm run audit:perf`): WAL · ایندکس‌ها در DB · parity schema↔DB · PRAGMAهای boot · قرارداد کامل کش هویت (TTL+bound+۵ hook) · groupBy + حذف count-ladder + کلیدهای کش مشترک · compress+CDN · lazy ≥۱۰ · حضور ۵ هارنس + ۶ مصنوع · عدم‌رگرسیون PHASE 14 (bounds + take caps).
- Suite کامل: **۴۴۱/۴۴۱** (۴۳۵ قبلی + ۶ جدید).
- چرخه Fix واقعی در طول فاز: خطای اندازه‌گیری fetch-gzip (عدد ۰٪ جعلی) کشف و با http خام اصلاح شد · بنچمارک journal با in-memory عدد نامعتبر می‌داد → فایل‌محور شد · دو باگ در اسکریپت درج ایندکس (جابجایی offset) پیدا و با منطق خط‌محور اصلاح شد · تست اولیه /me به‌عنوان probe اشتباه بود (me() خودش کوئری داده دارد) → probe به notifications تغییر کرد.

## §9 — کاتالوگ ED فاز ۱۶

| ED | تصمیم |
|---|---|
| ED-181 | ۲۸ ایندکس مرکب مسیرهای داغ — فقط از EXPLAIN داده‌شده؛ schema منبع واحد؛ ۲ LIKE باقی‌مانده = طراحی |
| ED-182 | WAL + NORMAL + busy_timeout — boot idempotent + fail-safe؛ ×۷٫۵ نوشتن |
| ED-183 | کش هویت ۱۰s/۲۵۶ — ابطال صریح ۵ مسیر؛ تست امنیتی ۴۰۱ فوری |
| ED-184 | Batching گروهی + کش staff-shared/role-queue — ۲۱→۹+۱ کوئری؛ معادل‌سازی تست‌شده |
| ED-185 | CDN seam — assetPrefix از env؛ CSP companion در مستندات |
| ED-186 | compress:true صریح — ۶۸٫۳٪ اندازه‌گیری‌شده |

## §10 — اجرای مجدد اندازه‌گیری‌ها

```bash
bun run dev &                       # سرور dev روی :3000
node scripts/perf-bench.mjs --tag <tag>          # API + کش + db/req
python3 scripts/perf-db-plan.py <tag>            # EXPLAIN + WAL + scale
node scripts/perf-pipeline.mjs --tag <tag>       # File/AI/Queue
node scripts/perf-ai-flow.mjs --tag <tag>        # سناریوی کامل بیمار
node scripts/perf-frontend.mjs --tag <tag>       # production :3100 (خودش build می‌خواهد)
node scripts/perf-audit.mjs                      # گیت PERF1..PERF10
```

قانون جاودانهٔ این فاز در یک خط: **«اگر عدد ندارد، بهینه‌سازی نیست.»**
