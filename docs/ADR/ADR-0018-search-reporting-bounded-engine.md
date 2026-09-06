# ADR-0018 — Search & Reporting Engine: Bounded, Permission-Aware

- **وضعیت:** Accepted
- **تاریخ:** PHASE 14
- **معادل ED:** ED-151..163 (خلاصه در `docs/SEARCH-REPORTING.md §9`)
- **جایگزین می‌کند:** — (مکمل ADR-0010 برای دامنهٔ Search/Reporting)

## Context

فرمان محصول فاز ۱۴ دو الزام متقابل دارد: (۱) گزارش‌های پویای چنددسته‌ای با Export سه‌قالبه و Permission-aware بودن؛ (۲) **جلوگیری صریح از Queryهای سنگین و Unbounded**. ممیزی پیش از فاز نشان داد پیاده‌سازی موجود دقیقاً نقطهٔ مقابل الزام دوم بود: `getReports()` هفت جدول کامل را در JS reduce می‌کرد، `?from/?to` نادیده گرفته می‌شد، و جستجو بعد از صفحه‌بندی در حافظه فیلتر می‌شد (S-1..S-10).

## Options

| گزینه | مزیت | عیب |
|---|---|---|
| Elasticsearch/OpenSearch | جستجوی غنی | Master Prompt §67 صراحتاً می‌گوید تا نیاز واقعی، معماری پیچیده نشود؛ نگهداری زیرساخت |
| PostgreSQL FTS (tsvector) | قوی روی PG | اپ امروز SQLite است؛ جابجایی stack برای یک فاز زودهنگام است |
| **LIKE چند-واریانته داخل SQL + Aggregation push-down** | صفر وابستگی؛ قابل migrate (trgm GIN در طرح فاز 04)؛ bounded by construction | دقت recall کمتر از FTS؛ مقیاس تا ~ده‌ها هزار ردیف |

## Decision

**موتور جستجو/گزارش LAYER-محور روی SQL موجود** با سه ستون:

1. **Bounded by construction (ED-153):** هیچ مسیر داده‌ای بدون سقف نیست — window ≤ 400 روز، rows ≤ 200/2000/20000 (view/sync/async)، timeout 15s، offset ≤ 10k، budgets نرخ per-user. خطاها صادقانه typed اند (`WINDOW_TOO_WIDE` 422، `REPORT_TIMEOUT` 504، `PAGINATION_TOO_DEEP` 422، `PAYLOAD_TOO_LARGE` 413→async).
2. **گزارش = داده، نه کد (ED-154):** ۱۹ ReportDef در رجیستری واحد؛ اجرا فقط از runner (guard→zod→clamp→cache→timeout→cap)؛ کاتالوگ با مجوز فیلتر می‌شود؛ Custom dataset = دیتاست‌های Whitelist-شده بدون SQL خام.
3. **Export به‌مثابه pipeline (ED-156):** همزمان تا سقف؛ بزرگ‌تر از آن JobQueue→StoredFile TEMPORARY (24h)→اعلان→دانلود owner-only. XLSX خودنویس (بدون SheetJS رهاشده)، PDF با pdfkit+FreeSerif (shaping فارسی) + `serverExternalPackages`.

## Consequences

- ✅ فرمان «Unbounded» با قرارداد سخت و تست‌پذیر اجرا می‌شود (SR1/SR6 + integration 422/413/504)
- ✅ فرمان «Permission-aware» در سه لایه: کاتالوگ، اجرا، و مالکیت artifact
- ✅ S-1/S-4/S-5 رفع شد؛ صفحه‌بندی جستجو دقیق شد؛ legacy adapter سازگار ماند
- ⚠️ recall جستجو < FTS (documented D-14-5)؛ مقیاس > 100k ردیف → ارتقا به Postgres trgm (طرح موجود)
- ⚠️ Prisma-SQLite epoch-ms (ED-161) قرارداد خام را مقید می‌کند — sql.ts تنها نقطهٔ تولید raw تاریخ‌دار است

## Compliance (قاعده ۲ منشور — باید در CI تست‌پذیر باشد)

- گیت `npm run audit:reporting` (SR1..SR10) در CI
- تست‌های unit/integration: 422/413/504/403/404 مسیرهای bounded و مجوزها را assert می‌کنند
- `reportPermissionsUsed()` در رجیستری با کاتالوگ ۳۱تایی constants.ts cross-check می‌شود (SR9)
