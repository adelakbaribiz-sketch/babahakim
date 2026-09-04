# FILE & MEDIA ENGINEERING — موتور فایل و رسانه (PHASE 10)

> سند مرجع پیاده‌سازی فاز ۱۰ — استانداردسازی کامل چرخه حیات فایل/رسانه پلتفرم BabaHakim.
> تصمیم‌های مهندسی این فاز: **ED-106 .. ED-119** (رجیستری در `BUSINESS-RULES.md`).
> پیش‌نیاز مطالعه: `ARCHITECTURE.md` (بخش‌بندی‌ها)، `BACKEND.md` (معماری لایه‌ای + JobQueue ED-102)، `SECURITY.md` (ED-66 دسترسی فایل پزشکی).

---

## ۰. خلاصه اجرایی

پیش از فاز ۱۰، کل مدیریت فایل در **یک تابع همزمان** (`storeImage`) داخل رشتهٔ درخواست خلاصه می‌شد: اعتبارسنجی + تولید ۴ نسخه با sharp + ارزیابی کیفیت — یعنی هر آپلودِ سنگین، درخواست اصلی را بلاک می‌کرد (نقض مستقیم الزام این فاز). طبقه‌بندی عمومی/خصوصی/موقتی وجود نداشت، Versioning واقعی نبود، استراتژی بدافزار غایب بود و تصاویر محصولات به دلیل باگ امضا با ID محصول، همیشه ۴۰۴ می‌شدند.

فاز ۱۰ موتور مستقل **Media Engine** را در `src/server/infrastructure/media/` معرفی می‌کند: آپلود **۲۰۲ Accepted** و پردازش асинх در Worker (JobQueue فاز ۰۸)، اسکن چندلایه بدافزار + قرنطینه، ذخیره‌سازی ناحیه‌بندی‌شده با کلیدهای محتوا-نشانی، نسخه‌بندی تغییرناپذیر، Signed URL مقید به (fileId, version, variant, exp)، چرخه حیات با انقضا/آرشیو/سطل زباله/پاک‌سازی فیزیکی، و Backup/Restore عملیاتی. تمام ۱۲+۱۱ الزام فرمان محصول پوشش داده و با ۳۰ تست واحد + ۱۹ تست یکپارچه + E2E مرورگری گواهی شده است.

---

## ۱. ممیزی پیش‌ از اجرا (۱۲ یافته F1..F12)

| # | یافته | اثر | رفع |
|---|---|---|---|
| F1 | فایل مسیر `POST /api/v1/images/upload` در آخرین auto-commit جلسهٔ قطع‌شدهٔ فاز ۰۹ گم شده بود | آپلود کل پلتفرم ۴۰۴ | بازیابی + بازنویسی به‌صورت ۲۰۲ async |
| F2 | پردازش (sharp ×۴ نسخه + گیت کیفیت) **همزمان در رشته درخواست** | بلاک شدن درخواست اصلی با فایل سنگین — نقض الزام فاز | انتقال کامل به Job `media-process` (ED-114) |
| F3 | بدون طبقه‌بندی PUBLIC/PRIVATE/TEMPORARY | همه فایل‌ها ضمنی خصوصی؛ تصویر محصول بدون مسیر عرضه | `accessClass` + ماتریس دسترسی (ED-106/118) |
| F4 | بدون چرخه حیات (انقضا/آرشیو/حذف نرم/پاک‌سازی) | داده تصویری پزشکی تا ابد روی دیسک | lifecycle worker + trash retention (ED-117) |
| F5 | فیلد `version` در MedicalImage هرگز استفاده نمی‌شد | Versioning واقعی وجود ندارد | StoredFileVersion تغییرناپذیر + endpoint نسخه (ED-113 در سند ثبت) |
| F6 | `catalogService` امضای Product ID می‌ساخت اما مسیر سرو فقط MedicalImage را می‌شناخت | تصویر همه محصولات **همیشه ۴۰۴** | `Product.imageFileId` + URL عمومی مستقیم (ED-118) |
| F7 | ناسازگاری enum: zod `TONGUE/SHOW/FACE/OTHER` ≠ storage `TONGUE/FACE/RECEIPT/DELIVERY/PRODUCT` | آپلود RECEIPT/DELIVERY/PRODUCT غیرممکن | enum واحد براساس MEDIA_POLICY |
| F8 | بدون استراتژی بدافزار | هر payload به دیسک می‌رسید | اسکن L1..L4 + قرنطینه (ED-111) |
| F9 | بدون Backup/Restore | از دست رفتن داده تصویری = نقض HIPAA-مانند | `backup:media` / `restore:media` (ED-117) |
| F10 | حدود حجم/نوع هاردکد در ۲+ نقطه | تک‌منبع نیست؛ حکمرانی سخت | MEDIA_POLICY تنها منبع (ED-107) |
| F11 | امضای قدیمی فقط (imageId, exp) را پوشش می‌داد | با URL معتبر `compressed` می‌شد `variant=original` برداشت | امضا مقید به version+variant (ED-112) |
| F12 | ذخیره‌سازی تخت `storage/uploads/` | بدون قرنطینه/تفکیک؛ پشتیبان‌گیری شکل‌دار نبود | ناحیه‌های driver + کلید محتوا-نشانی (ED-109/110) |

---

## ۲. معماری موتور

```
Route (thin, zod)          →  mediaFileService (guards/audit/DTO)  →  acceptUpload (ED-114: fast accept)
   202 + statusUrl                                                    │
                                                                     ▼
                       inbox/{sha16}-v{n}-{fileId}   +   StoredFile(PENDING) + Version + Variant(original)
                                                                     │ enqueue
                                                                     ▼
                       JobQueue('media-process', retry×3, backoff, DLQ)
                                                                     │ worker thread
                                                                     ▼
                       scanBuffer (L1..L4) ── INFECTED/SUSPECT → quarantine/ + رویداد + اعلان مالک
                                     │ CLEAN
                                     ▼
                       processImage (sharp ×N، بازکدگذاری = L3) → files/{public|private|temp}/{sha16}/v{n}/{variant}.jpg
                                     ▼
                       Metadata JSON (quality/scan/stats) + به‌روزرسانی Variantها + گیت کیفیت
                                     ▼
                       StoredFile(READY|REJECTED) + پل MedicalImage (legacy paths) + رویداد MediaFileReady
```

**ماژول‌ها** (`src/server/infrastructure/media/`):

| فایل | مسئولیت | ED |
|---|---|---|
| `config.ts` | MEDIA_POLICY: حدود حجم (بیمار/کارکنان)، allowlist MIME، TTLها، retention، گیت کیفیت | 107 |
| `storage-driver.ts` | پورت driver + پیاده‌سازی Local؛ ۶ ناحیه؛ `assertSafeKey` ساختاری | 109/110 |
| `scanner.ts` | اسکن چندلایه بدافزار + گزارش | 111 |
| `signed-url.ts` | HMAC مقید به (fileId, version, variant, exp)، timing-safe | 112 |
| `processing.ts` | خط تولید نسخه‌ها با sharp (بازکدگذاری همه مشتقات) | 113 |
| `pipeline.ts` | acceptUpload / processFile — دو ارکستراسیون اصلی | 114 |
| `lifecycle.ts` | TTL صندوق ورودی، انقضای TEMPORARY، پاک‌سازی سطل زباله | 117 |

**مصرف‌کنندگان از طریق پل:** `MedicalImage.storedFileId` (پرونده بالینی)، `Product.imageFileId` (کاتالوگ)، و endpoint عمومی `/api/v1/files/*`.

---

## ۳. طبقه‌بندی و ماتریس دسترسی (ED-106 / ED-118)

| کلاس | معنا | دسترسی ناشناس | دسترسی نشست | Signed URL |
|---|---|---|---|---|
| **PUBLIC** | اقلام عمومی (تصویر محصول) | فقط variantهای `publicVariants` (compressed/thumb) — نه original | کارکنان: همه variantها | لازم نیست (لینک مستقیم) |
| **PRIVATE** | داده پزشکی/مالی (پیش‌فرض همه دسته‌ها به‌جز PRODUCT_IMAGE) | ✗ | مالک / ADMIN / مجوز `view_images` یا `view_medical_files` | مجاز — مقید به variant |
| **TEMPORARY** | PRIVATE + `expiresAt` | ✗ | مانند PRIVATE، تا قبل از انقضا | مانند PRIVATE، پس از انقضا باطل |

قواعد حکاکتی:
- `MEDICAL_IMAGE` **هرگز** PUBLIC نمی‌شود — حتی با درخواست صریح (`resolveAccessClass` fail-closed) — تداوم ED-66.
- `INFECTED` به هیچ‌کس سرو نمی‌شود (۴۰۳ با پیام قرنطینه).
- `DELETED`/`PURGED` = سنگ‌قبر (۴۰۴ — بدون افشای وجود)؛ `ARCHIVED` فقط کارکنان.
- `PATCH /files/{id}` تغییر کلاس دسترسی: مجاز، **به‌جز** عمومی‌سازی داده پزشکی (422).

---

## ۴. چرخه حیات فایل / Storage Lifecycle (ED-117)

```
ACTIVE ──(حذف نرم DELETE یا انقضای TEMPORARY)──► DELETED (سطل زباله، نگهداشت ۷ روز)
   │                                                  │
   │ (PATCH archive)                                  │ lifecycle tick (هر ۵ دقیقه، batch≤50)
   ▼                                                  ▼
ARCHIVED (فقط کارکنان)                         PURGED (حذف فیزیکی کلیدها + سنگ‌قبر)
```

- **صندوق ورودی:** فایل PENDING/PROCESSING بیش از ۲۴ ساعت → FAILED + حذف بایت‌های stage (ایمنی کرش Worker).
- **batch≤50** در هر tick → کار bounded؛ هر tick یک ردیف `MEDIA_LIFECYCLE_TICK` در AuditLog می‌نویسد (قابل راستی‌آزمایی عملیاتی).
- **ترIGGER اضطراری:** `POST /api/v1/admin/media/lifecycle?force=1` (ADMIN، ممیزی‌شده) — پنجرهٔ نگهداشت را صفر می‌کند.
- retentionها همه از `MEDIA_POLICY.lifecycle` خوانده می‌شوند (تک‌منبع؛ گیت media-audit E7).

---

## ۵. استراتژی بدافزار / Malware Scanning Strategy (ED-111) — صادقانه و لایه‌ای

| لایه | مکانیزم | اثر |
|---|---|---|
| L0 | لبه مسیر: allowlist MIME + **magic bytes + تطابق declared/detected** (ضد Content-Type spoofing) | 415 قبل از هر write |
| L1 | امضاها: **EICAR** + محتوای فعال نهفته (`<?php`, `<script`, `eval(`, `base64_decode`, `powershell`) | INFECTED / SUSPECT |
| L2 | ساختاری: داده پس از EOI/IEND، ابعاد RIFF ناهمخوان، سربرگ MZ/ELF، PDF JS/Action | SUSPECT (polyglot/carrier) |
| L3 | **بازکدگذاری** هر نسخهٔ مشتق با sharp (حذف EXIF + خنثی‌سازی payload نهفته) | نسخه‌های عرضه پاک‌شده |
| L4 | **ClamAV** clamd INSTREAM — فعال‌سازی با `MEDIA_CLAMAV_HOST/PORT` (پروداکشن) | موتور AV واقعی؛ غایب در dev → «heuristic» |

نتیجهٔ INFECTED یا SUSPECT: انتقال بایت خام به `quarantine/`، `scanStatus` روی نسخه، `status=INFECTED` روی فایل، رد یافته‌ها در `version.metadata`، رویداد `media.file.infected` → **اعلان مالک (FILE_QUARANTINED)** + اپراتورها + AuditLog. قرنطینه فقط با بازبینی دستی (لاگ یافته‌ها) بازگشتی است — فایل آلوده برای همیشه غیرقابل سرو است.

> محدودیت صادقانه: L1/L2 heuristik هستند (هدف: polyglot و carrier رایج؛ جایگزین AV نیستند). L4 در استقرار پروداکشن الزامی است.

---

## ۶. Signed URLs — لینک‌های امضادار (ED-112)

پیام امضا: `HMAC-SHA256(fileId.version.variant.exp)` (۳۲ hex، timing-safe مقایسه).

- **variant و version مقیدند** — URL معتبر برای `compressed` با تغییر پارامتر به `original` یا نسخهٔ دیگر، باطل می‌شود (رفع F11؛ گواهی در تست یکپارچه).
- TTL پیش‌فرض ۳۰۰ ثانیه (هم‌ارز قرارداد v1 پزشکی)، سقف ۳۶۰۰.
- `POST /api/v1/files/{id}/signed-url` با نشست معتبر مسک می‌شود؛ فایل PUBLIC لینک مستقیم (بدون امضا) می‌گیرد.
- انقضای TEMPORARY، امضای معتبر را هم باطل می‌کند.

---

## ۷. حدود و مجازها (ED-107 — تک‌منبع `MEDIA_POLICY`)

| دسته | انواع (type) | MIMEهای مجاز | حد بیمار | حد کارکنان | کلاس پیش‌فرض | نسخه‌ها |
|---|---|---|---|---|---|---|
| MEDICAL_IMAGE | TONGUE, FACE | jpeg/png/webp | 10MB | 25MB | PRIVATE | original+compressed+ai+thumb |
| PRODUCT_IMAGE | PRODUCT | jpeg/png/webp | 5MB | 10MB | PUBLIC | original+compressed+thumb |
| RECEIPT | RECEIPT | jpeg/png/webp/pdf | 10MB | 10MB | PRIVATE | original+compressed+thumb |
| DELIVERY_PROOF | DELIVERY | jpeg/png/webp | 10MB | 10MB | PRIVATE | original+compressed+thumb |
| AVATAR | AVATAR | jpeg/png/webp | 2MB | 2MB | PRIVATE | original+thumb |
| DOCUMENT | DOCUMENT | pdf | 20MB | 20MB | PRIVATE | original |

خطاهای استاندارد: `413 PAYLOAD_TOO_LARGE` (با details حدود واقعی)، `415 UNSUPPORTED_MEDIA_TYPE` (declared/detected در details)، `400 VALIDATION` (ناسازگاری type↔category). Rate-limit آپلود: همان bucket فاز ۰۵ (۲۰/دقیقه/کاربر) + Audit.

نسخه‌های مشتق (همگی بازکدگذاری‌شده): original q95 / compressed ≤1600px q82 mozjpeg / ai 512×512 normalized (فقط پزشکی) / thumb ≤320px q70. EXIF در همه حذف می‌شود (حریم خصوصی).

---

## ۸. Versioning — نسخه‌بندی (ED-113)

هر آپلود = **StoredFileVersion** تغییرناپذیر (sha256 + کلید محتوا-نشانی). `POST /files/{id}/versions` نسخهٔ n+1 اضافه می‌کند (با همان گیت‌های اعتبارسنجی + اسکن کامل)؛ `currentVersion` پیش می‌رود؛ نسخه‌های قبلی **دست‌نخورده باقی می‌مانند** و با `?v={n}` قابل برداشت‌اند (تست یکپارچه: v1 vs v2 بایت‌ها متفاوت). تاریخچه در `GET /files/{id}/versions` (scanStatus/یافته‌ها/کیفیت هر نسخه). جایگزینی تصویر محصول از پنل ادمین = نسخهٔ جدید روی همان فایل (تاریخ تصویر محصول هرگز نابود نمی‌شود — هم‌راستا با اصل «تاریخ قیمت هرگز نابود نمی‌شود» فاز ۰۴).

---

## ۹. ذخیره‌سازی (ED-109/110)

```
storage/
├── inbox/            خام در انتظار اسکن/پردازش (TTL ۲۴h)
├── files/public/     {sha16}/v{n}/{variant}.jpg
├── files/private/
├── files/temp/
├── quarantine/       {sha16}-v{n}-{fileId}
├── trash/            {sha16}/v{n}/{fileId}-{variant}.jpg (نگهداشت ۷ روز)
└── uploads/          ناحیهٔ legacy (فقط-خواندنی؛ ۱۵ رکورد موجود مهاجرت‌یافته)
```

- کلیدها همیشه ناحیه‌دار + محتوا-نشانی + نسخه‌دار؛ **هیچ ورودی کاربر** هرگز مستقیم در مسیر فایلسیستم نمی‌نشیند (`sanitizeFileName` فقط متادیتای نمایشی است).
- `assertSafeKey` مسیرهای `..`، مطلق، backslash و بدون-ناحیه را **قبل از هر fs call** رد می‌کند (تست واحد).
- driver پورت است: `MEDIA_STORAGE_DRIVER=local`؛ S3/MinIO (ADR-0006) تعویض پیاده‌سازی است نه بازطراحی. گیت media-audit E1 مانع import مستقیم fs/sharp در مسیرها است.
- مهاجرت: `npm run migrate:media` (idempotent؛ ۱۵ رکورد موجود اجرا شد؛ مقصد files/private با scanEngine=legacy-migrated).

---

## ۱۰. عدم بلاک شدن درخواست اصلی (ED-114) — الزام کلیدی فاز

- مسیر آپلود فقط: zod → گیت‌های سبک (enum/حجم declared) → magic sniff → write به inbox → درج PENDING → enqueue. **هیچ encode تصویری در رشتهٔ درخواست نیست.**
- پاسخ: **202** `{file, statusUrl, message}` — کلاینت `statusUrl` را poll می‌کند (UI بیمار: حالت «در حال پردازش» تا VALIDATED/REJECTED؛ timeout محافظ ۳۰s).
- Worker: JobQueue فاز ۰۸ (BullMQ-سازگار) — retry×3 با backoff خطی، DLQ → `status=FAILED` + AuditLog + پاک‌سازی TTL inbox.
- شاهد عملی: تست یکپارچهٔ ۲۰۲→poll→READY در ~۱s؛ ۱۰۰ آپلود E2E تستی بدون بلاک.

---

## ۱۱. رابط API (v1)

| مسیر | متد | معنا | مجوز |
|---|---|---|---|
| `/api/v1/files` | POST | آپلود (multipart: file,category,type,caseId?,accessClass?,ttlSec?) → 202 | requireAuth |
| `/api/v1/files` | GET | لیست (مالک-محور؛ کارکنان همه) + قرارداد صفحه‌بندی ED-100 | requireAuth |
| `/api/v1/files/{id}` | GET | وضعیت/متادیتا (poll) + نسخهٔ جاری | مالک/کارکنان |
| `/api/v1/files/{id}` | PATCH | تغییر accessClass / archive | مالک/کارکنان |
| `/api/v1/files/{id}` | DELETE | حذف نرم → سطل زباله | مالک/کارکنان |
| `/api/v1/files/{id}/versions` | GET/POST | تاریخچه / نسخهٔ جدید (202) | مالک/کارکنان |
| `/api/v1/files/{id}/content` | GET | سرو نسخه: `?variant=&v=&exp=&sig=&download=1` + Range 206 | طبقه‌بندی (§۳) |
| `/api/v1/files/{id}/signed-url` | POST | مسک URL مقید | مالک/کارکنان |
| `/api/v1/admin/media/stats` | GET | آمار (تعداد/حجم به‌تفکیک status/class/category + صف + سیاست) | ADMIN |
| `/api/v1/admin/media/lifecycle` | POST | اجرای tick (؟force=1) | ADMIN |
| `/api/v1/images/upload` | POST | **پل پزشکی** (همان قرارداد قبل، ۲۰۲ async) | requireAuth |
| `/api/v1/images/{id}` | GET | وضعیت تصویر پزشکی + کیفیت (poll) | مالک/کارکنان |
| `/api/v1/images/{id}/file` | GET | سرو legacy/پل (امضای v1) | ED-66 |

هدرهای سرو: `Content-Type` از variant، `Content-Length`، `X-Content-Type-Options: nosniff`، `Content-Disposition` (inline/attachment — download مقید نیست: فقط disposition را عوض می‌کند نه مجوز را)، `Cache-Control` (PUBLIC: `public, max-age=3600, immutable` / غیرعمومی: `private, no-store`)، `ETag` (sha+variant). Audit: دانلود امضادار + بازدید غیرمالک (بازدید خود مالک و عمومی ممیزی نمی‌شود — لاگ متراکم‌وپرسیگنال).

رویدادها (ED-116): `media.file.ready` (→ ابطال کش کاتالوگ برای PRODUCT_IMAGE)، `media.file.infected` (→ اعلان مالک + اپراتورها)، `media.file.purged`؛ برای MEDICAL_IMAGE معتبر، همان `image.uploaded` قدیمی بعد از READY منتشر می‌شود (پایداری مشترک فاز ۰۵/۰۸).

---

## ۱۲. پشتیبان‌گیری و بازیابی (ED-117)

```bash
npm run backup:media     # → backups/media-<ts>.tar.gz
                         #   storage/ (همه ناحیه‌ها) + db/custom.db (پس از wal_checkpoint) + manifest.json
                         #   sha256 آرشیو چاپ می‌شود؛ retention پیش‌فرض ۱۴ روز (MEDIA_BACKUP_RETENTION_DAYS)
npm run restore:media -- --archive backups/media-<ts>.tar.gz --yes
```

- Restore ابتدا به staging استخراج می‌کند، سپس `storage/` و DB را جایگزین می‌کند — هرگز مستقیم روی داده زنده.
- اجرای واقعی این فاز: آرشیو 8.21MB / 62 فایل / sha256 ثبت‌شده در گزارش فاز.
- زمان‌بندی پروداکشن: cron روزانه + کپی خارج‌سایت (S3/نسخه سرد) — Runbook استقرار (فاز Deployment).
- **قبل از restore: توقف اپ/Worker** (کلاینت Prisma قدیمی در حافظه) — پس از آن: restart + راستی‌آزمایی stats + یک rendition.

---

## ۱۳. تست‌ها و گیت‌ها

| دسته | فایل | پوشش |
|---|---|---|
| واحد (۳۰) | `src/server/infrastructure/media/__tests__/media.test.ts` | scanner L1/L2 (EICAR/polyglot/trailing/MZ/WebP/PDF) · امضا (مقید بودن variant/version/fileId، انقضا، tamper، clamp TTL) · سیاست (حدود نقش‌ها، fail-closed کلاس، type↔category، نگاشت وضعیت) · کلیدها (traversal/مطلق/backslash/ناحیه، layout، ext) · خالص‌های pipeline |
| یکپارچه (۱۹) | `tests/integration/media-engine.test.ts` | ۲۰۲→poll→READY · 413/415/400 · ماتریس دسترسی (ناشناس/غریبه/مالک) · امضا (بدون نشست، swap variant، انقضا) · versioning (v2 + تغییرناپذیری v1) · قرنطینه EICAR + ۴۰۳ · PUBLIC محصول (ناشناس compressed ✓ / original ✗ / کاتالوگ) · TEMPORARY + حذف نرم + force purge + stats · لیست مالک-محور |
| Golden path | `tests/integration/api-golden-path.test.ts` | آپلود پزشکی async (۲۰۲ + poll + VALIDATED) — به‌روز شده قرارداد فاز ۱۰ |
| Pentest (۴۵) | `tests/security-pentest.sh` | انتظار MIME spoof: 400→**415** (به‌روز با ED-108) |
| E2E (۱۷/۱۷) | `tests/e2e/run-e2e.mjs` | مسیر طلایی مرورگری شامل آپلود async در UI (Q:100/100 → ایجاد پرونده) |
| گیت CI | `npm run audit:media` | E1 بدون fs/sharp در مسیرها · E2 تک‌منبعی حدود/MIME · E3 ممنوعیت امضای دست‌ساز · E4 گارد کلید driver · E5 ممنوعیت storeImage همزمان · E6 apiRoute · E7 MEDIA_POLICY در lifecycle/bootstrap · W1/W2 to Beh |

رگرسیون کامل این فاز: **۱۸۹/۱۸۹ bun test + ۴۵/۴۵ pentest + ۱۷/۱۷ E2E + سه گیت audit (media/backend/ui) سبز.**

---

## ۱۴. بدهی و محدودیت‌های صادقانه

| # | بدهی | زمینه |
|---|---|---|
| D-10-1 | بازکلاس‌بندی فایل موجودِ PUBLIC→PRIVATE فقط در نسخهٔ بعدی اعمال فیزیکی می‌شود (نسخه‌های عرضه‌شده با cache قدیمی تا ۱h زنده‌اند؛ PRIVATE→PUBLIC نیازمند آپلود مجدد) | §۳ |
| D-10-2 | JobQueue و rate-limit هنوز in-process تک‌نمونه‌ای — پورت Redis/BullMQ آماده (ADR-0005) | ED-102/114 |
| D-10-3 | ClamAV در dev فعال نیست (heuristic) — در پروداکشن الزامی | §۵ |
| D-10-4 | ۲ فایل یتیم در `storage/uploads/` (باقی‌مانده تست‌های pre-migration) — پاک‌سازی عملیاتی | §۹ |
| D-10-5 | UI مدیریت رسانه (گالری ادمین/فرم آپلود تصویر محصول) در PHASE 09 UI Rebuild — API آماده است | §۱۱ |
| D-10-6 | سرو ۲۰۲ از فایل‌های بسیار بزرگ بدون chunk-upload — کافی برای حد ۲۵MB فعلی | ED-114 |

---

## ۱۵. رجیستری تصمیم‌های مهندسی این فاز

| ED | تصمیم |
|---|---|
| ED-106 | طبقه‌بندی سه‌گانه PUBLIC/PRIVATE/TEMPORARY + ۴ وضعیت چرخه حیات |
| ED-107 | MEDIA_POLICY تک‌منبع حدود/allowlist — هاردکد ممنوع (گیت E2) |
| ED-108 | اعتبارسنجی لبه: magic bytes + تطابق declared/detected → 413/415 |
| ED-109 | driver ناحیه‌بندی‌شده با پورت (S3 آماده) |
| ED-110 | ایمنی ساختاری کلیدها (traversal/مطلق/بدون-ناحیه رد قبل از fs) |
| ED-111 | اسکن بدافزار L1..L4 + قرنطینه + اعلان + audit |
| ED-112 | Signed URL مقید به (fileId, version, variant, exp) — رفع F11 |
| ED-113 | نسخه‌بندی تغییرناپذیر + بازکدگذاری مشتقات (L3) + حذف EXIF |
| ED-114 | آپلود ۲۰۲ + پردازش асинх در Worker — الزام «عدم بلاک» |
| ED-115 | پل MedicalImage (storedFileId + مسیرهای legacy همگام) |
| ED-116 | رویدادهای media.* + اتصال به ابطال کش/اعلان |
| ED-117 | چرخه حیات + retention + Backup/Restore عملیاتی |
| ED-118 | ماتریس دسترسی طبقه‌بندی-آگاه + رفع F6 تصویر محصول |
| ED-119 | گیت CI `audit:media` (E1..E7) |
