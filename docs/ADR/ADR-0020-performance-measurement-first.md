# ADR-0020: کارایی Measurement-First — ایندکس‌های EXPLAIN-محور، WAL، کش هویت ابطال‌پذیر

| فیلد | مقدار |
|---|---|
| شماره | ADR-0020 |
| وضعیت | Accepted |
| تاریخ | 1405/06/15 (2026-09-06) |
| فاز تصمیم | PHASE 16 — Performance Engineering |
| معادل ED | ED-181..186 |
| اسناد مرتبط | `PERFORMANCE.md` · `ADR-0004` (Postgres) · `ADR-0005` (Redis) · `ADR-0012/0019` (متریک) · `BUSINESS-RULES §11` |

## Context

فرمان فاز صریح بود: «Optimization بدون Measurement انجام نده.» ممیزی اولیه نشان داد سیستم پنج هارنس اندازه‌گیری اختصاصی ندارد (API/db/کش/فایل/AI)، ۲۴ از ۲۷ کوئری داغ SQLite full-scan است (SQLite برای FK ایندکس خودکار نمی‌سازد)، journal mode آن DELETE با synchronous=FULL است (خواننده‌ها هنگام نوشتن قفل می‌شوند)، و هر درخواست authenticate شده یک کوئری User برای ساخت AuthContext می‌پردازد — حتی وقتی پاسخ کامل کش شده است.

## Options

1. **بهینه‌سازی بر اساس شهود** — رد شده: دقیقاً خلاف فرمان.
2. **تنها ابزار عمومی (EXPLAIN دستی / hunch)** — رد شده: بازتولیدپذیر نیست، در CI قابل‌اعتبارسنجی نیست.
3. **هارنس‌های tag-دار + مصنوعات JSON + گیت CI** — پذیرفته شد: هر بهینه‌سازی یک جفت عدد before/after دارد؛ گیت PERF9 «بدون مصنوع اندازه‌گیری، بهینه‌سازی ممنوع» را enforcement می‌کند.

در سه تصمیم داخلی هم گزینه‌ها سنجیده شد:
- کش هویت: (الف) TTL طولانی بدون ابطال — رد (خطر امنیتی)؛ (ب) TTL=۱۰s + ابطال صریح در هر پنج مسیر تغییر — پذیرفته شد.
- داشبورد staff: (الف) کش per-user مثل قبل — رد (N کاربر = N کپی یکسان)؛ (ب) batch گروهی + کلید staff-shared/role-queue — پذیرفته شد.
- rerun-ai: async کردن (۲۰۲+enqueue) — **مؤخر** به D-16-1: عدد فعلی (mock: ۱۱۴–۳۱۳ms) تغییر قرارداد API را توجیه نمی‌کند؛ با فعال شدن provider زنده و timeout ۳۰s دوباره سنجیده می‌شود.

## Decision

1. **ED-181**: مجموعهٔ ۲۸ ایندکس مرکب فقط از EXPLAIN QUERY PLAN داده‌شده استخراج می‌شود؛ ترتیب ستون آینهٔ WHERE+ORDER BY سرویس؛ `schema.prisma` منبع واحد (migration دستی + db push). دو full-scan باقی‌مانده LIKEهای جستجو = تصمیم طراحی فاز ۱۴ (ED-152)، رفع با tsvector پس از Postgres.
2. **ED-182**: SQLite با WAL + synchronous=NORMAL + busy_timeout=۵۰۰0 بالا می‌آید؛ re-assert ایدمپوتنت و fail-safe در بوت کلاینت Prisma؛ شکست PRAGMA هرگز بوت را نمی‌بندد.
3. **ED-183**: AuthContext از کش هویت ۱۰ ثانیه‌ای (سقف ۲۵۶، globalThis/HMR-safe) ساخته می‌شود؛ ابطال صریح در logout / login / ویرایش کاربر ادمین / تکمیل حذف حساب / ویرایش پروفایل. غیرفعال‌سازی باید در همان درخواست بعدی ۴۰۱ بدهد (تست integration).
4. **ED-184**: داشبورد staff: ۹ count وضعیتی → ۲ groupBy؛ آمار staff-wide یک کش per-process؛ صف per-role؛ به‌ازای کاربر فقط ۱ count unreadSelf. معادل‌سازی اعداد با تست.
5. **ED-185/186**: CDN به‌صورت seam از env (`NEXT_PUBLIC_CDN_BASE` → assetPrefix، no-op محلی + الزام به‌روزرسانی CSP هنگام فعال‌سازی)؛ `compress: true` صریح (عدد: ۶۸٫۳٪).

## Conquences

- **مثبت:** p95 auth/me −۶۵٪ · db/req همه‌جا −۱ تا −۲ · داشبورد cold −۳۲٪ با ۹+۱ کوئری به‌جای ۲۱ · نوشتن DB ×۷٫۵ · full-scan ۲۴→۲ · مقیاس‌پذیری الگوریتمی (×۵۰۷ در ۵۰k سطر) · رشد AuditLog دیگر خطی روی صفحهٔ ممیزی سنگین نمی‌شود.
- **منفی/ریسک:** کهنگی ≤۱۰s هویت فقط برای ویرایش مستقیم DB (تضمین قبلی هم نبود)؛ PRAGMAهای per-connection روی کل pool اعمال نمی‌شوند (D-16-4)؛ هزینهٔ نگهداشت ۲۸ ایندکس در نوشتن (در OLTP این سیستم ناچیز — بنچمارک نوشتن پس از ایندکس‌ها هم ×۷٫۵ بهتر از DELETE-journal ماند).
- **ریسک OOM محیط dev** (کشف این فاز) مستند شد — محدودیت sandbox، نه نقص محصول.

## Compliance

- `npm run audit:perf` → گیت **PERF1..PERF10** در CI: WAL فعال · ۲۸ ایندکس در DB · parity schema↔DB · PRAGMAهای بوت · قرارداد کش هویت (TTL/bound/۵ hook) · groupBy و حذف count-ladder · compress+CDN seam · lazy ≥۱۰ chunk · حضور ۵ هارنس و ۶ مصنوع اندازه‌گیری · عدم‌رگرسیون سقف‌های فاز ۱۴.
- `tests/integration/performance.test.ts`: ۴۰۱ فوری پس از غیرفعال‌سازی (ابطال نه TTL) · معادل‌سازی آمار · WAL · ایندکس‌ها.
- قانون بازتولید: هر بهینه‌سازی آینده باید با `node scripts/perf-bench.mjs --tag <x>` جفت عدد before/after بیاورد — PERFORMANCE.md §10.
