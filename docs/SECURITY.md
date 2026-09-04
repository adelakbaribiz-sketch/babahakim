# BabaHakim — Security & Privacy Architecture | معماری امنیت و حریم خصوصی (PHASE 05)

> **فاز:** PHASE 05 — Security & Privacy · **تاریخ:** ۱۴۰۵/۰۶/۱۴ (2026-09-04)
> **اسناد مرتبط:** `THREAT-MODEL.md` · `ARCHITECTURE.md §9` · `ADR-0014` · `ADR-0015` · ED-59..70 در `BUSINESS-RULES.md §5`
> **وضعیت تست:** ۳۵ Unit + ۴۵ Pentest HTTP = **۸۰/۸۰ PASS** · lint پاک

---

## ۰) خلاصه اجرایی — لایه‌های دفاع

| لایه | سازوکار | فایل/موقعیت |
|---|---|---|
| ۱. لبه | Security Headers (CSP/HSTS/XFO/nosniff/Referrer/Permissions) | `next.config.ts` |
| ۲. لبه | Origin/CORS تایید + CSRF double-submit (همه متدهای تغییردهنده) | `src/middleware.ts` |
| ۳. AuthN | scrypt + JWT (HS256, issuer+audience پین‌شده) + چرخش Refresh + کشف Replay | `src/lib/auth.ts` |
| ۴. AuthN | OTP/MFA (هش‌شده، ۲دقیقه TTL، ۵ تلاش، یک‌بارمصرف) | `src/lib/security/otp.ts` |
| ۵. Anti-Abuse | Rate Limit اسلایدینگ-ویندو (login/OTP/upload/export/register) + قفل Brute-force | `src/lib/security/rate-limit.ts` + login route |
| ۶. AuthZ | RBAC سروری ۳۱ Permission + مالکیت (IDOR guard) | `requirePermission` + مسیرها |
| ۷. داده | AES-256-GCM فیلد-رمزنگاری + Signed URL انقضادار (timing-safe) | `encryption.ts` / `auth.ts` |
| ۸. داده پزشکی | Private storage + access control + حسابرسی هر دسترسی/دانلود تصویر | `images/[id]/file/route.ts` |
| ۹. Privacy | Consent نسخه‌دار + Export + Deletion→Anonymization | `src/lib/security/privacy.ts` |
| ۱۰. حسابرسی | AuditLog جریان رویداد حساس (append-only در DB هدف فاز ۰۴) | `api.ts audit()` |

---

## ۱) Authentication

### ۱.۱ رمز عبور
- **الگوریتم:** `scrypt` (N=16384 پیش‌فرض Node) با Salt تصادفی ۱۶بایتی، خروجی ۶۴بایت؛ مقایسه **timing-safe** (`timingSafeEqual`).
- **سیاست رمز (register):** حداقل ۸ کاراکتر، حرف + رقم (پیام خطای فارسی ۴۲۲).
- رمز هرگز در Log/Audit/Response ظاهر نمی‌شود.

### ۱.۲ JWT (Access Token)
- **الگوریتم:** HS256 با `JWT_SECRET` (≥۳۲ کاراکتر در Production — ED-59).
- **Claims سخت‌گیرانه:** `iss: tongueai` + `aud: babahakim-web` — هر دو در verify **پین** شده‌اند؛ تست نفوذ «alg=none» و توکن امضاشده با کلید خارجی رد می‌شود (T-TAM-01/02).
- **TTL:** ۱۲ ساعت (httpOnly cookie `ta_access`).

### ۱.۳ Refresh Token Rotation + کشف سرقت (ED-64)
- توکن خام ۴۸بایت تصادفی؛ در DB فقط `sha256(token)` ذخیره می‌شود.
- **چرخش اتمیک:** هر فراخوانی `/auth/refresh` توکن قدیمی را `ROTATED` (با زنجیره `replacedByToken`) و جانشین تازه صادر می‌کند — داخل یک `$transaction`.
- **کشف Replay:** ارائه مجدد توکنِ قبلاً-چرخیده = سیگنال سرقت → **کل خانواده توکن‌های کاربر ابطال** (`REUSE_DETECTED`) + رویداد `REFRESH_REUSE_DETECTED` در AuditLog → هر دو مهاجم و قربانی باید دوباره login کنند.
- ابطال‌ها دلیل دارند: `ROTATED | LOGOUT | REUSE_DETECTED | PASSWORD_CHANGE | DELETION`.

### ۱.۴ OTP/MFA (ED-63)
| ویژگی | مقدار |
|---|---|
| طول کد | ۶ رقم از `crypto.randomInt` (CSPRNG) |
| ذخیره‌سازی | `sha256(salt:code)` — هرگز Plaintext (تست‌شده) |
| اعتبار | ۲ دقیقه |
| تلاش | حداکثر ۵؛ سپس چالش مرده (حتی کد درست) |
| تک‌بارمصرف | `consumedAt`؛ درخواست جدید چالش قبلی را بی‌اثر می‌کند |
| محدودیت ارسال | ۳ به‌ازای شماره در ۱۰ دقیقه |
| دروازه SMS | Port `OtpSmsSender` (Kavenegar در Production / لاگ در dev) |
| مقاصد | `LOGIN_MFA` · `PASSWORD_RESET` · `PHONE_VERIFY` |
| جریان MFA | login: رمز ✓ → پاسخ `{mfaRequired, challengeId}` → `/auth/otp/verify` → نشست کامل |
| devCode | فقط در non-production برای تست محلی |

### ۱.۵ مدیریت نشست
- Cookieها: `httpOnly` + `sameSite=lax` + `secure` در Production.
- Logout: ابطال همه Refreshها + پاک‌سازی کوکی‌ها.
- getAuth هر درخواست: JWT ✓ → کاربر فعال/غیرحذف‌شده در DB ✓ (ابطال فوری با deactivate).
- قفل Brute-force حساب: ۵ خطا → ۱۰ دقیقه (`failedLogins`/`lockedUntil`) + Audit.

---

## ۲) Authorization / RBAC / Permission

- **۶ نقش × ۳۱ Permission** (کاتالوگ `constants.ts`)؛ بررسی **سروری** در همه مسیرهای مدیریتی (`requirePermission`) — نقش ADMIN فقط در لایه Permission پاس می‌شود (BR-RBAC-02).
- **قاعده مالکیت (ضد-IDOR):** بیمار فقط رکوردهای خودش (case/ticket/order/image از طریق owner یا patientId پرونده). تست نفوذ IDOR بین دو بیمار → 403.
- **ED-66 (بستن شکاف قبلی):** دسترسی تصویر پزشکی برای staff فقط با Permission صریح `view_images` **یا** `view_medical_files` — قبلاً «هر نقش staff» مجاز بود؛ اکنون سروری اعمال می‌شود.
- پیام خطاها اطلاعاتی افشا نمی‌کنند (Enumerate نبودن: login ناموفق = پیام واحد 401).

---

## ۳) Rate Limiting & Brute Force (ED-60)

| Preset | حد | پنجره | کلید |
|---|---|---|---|
| login (حساب) | ۵ | ۵ دقیقه | `login:acct:{userId}` |
| login (IP) | ۱۵ | ۵ دقیقه | `login:ip:{ip}` (ضد Spray بین حساب‌ها) |
| register | ۵ | ۱ ساعت | `register:{ip}` |
| refresh | ۳۰ | ۱ دقیقه | `refresh:{ip}` |
| otp send | ۳ | ۱۰ دقیقه | `otp:send:{phone}` |
| otp verify | ۱۰ | ۱۰ دقیقه | `otp:verify:{phone\|challengeId}` |
| upload | ۲۰ | ۱ دقیقه | `upload:{userId}` |
| export | ۱ | ۲۴ ساعت | `export:{userId}` |

- پیاده‌سازی: **اسلایدینگ-ویندو درون-پروسه** با Sweep دوره‌ای حافظه؛ پاسخ 429 + `Retry-After`.
- مسیر Production چند-Replica: اینترفیس `RateLimitStore` → Redis `INCR+EXPIRE` (ADR-0014؛ بدهی ثبت‌شده D-3).
- login موفق → reset کلید حساب (بخشش کاربر صادق).
- IP از `X-Forwarded-For` نخستین hop / `X-Real-IP` (پشت Reverse Proxy معتبر؛ در کامیونیتی مستقیم باید محدود شود — D-4).

---

## ۴) Secure Headers / CORS / CSRF

### ۴.۱ هدرها (همه پاسخ‌ها — `next.config.ts`)
`Content-Security-Policy` (default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri/form-action 'self') · `X-Frame-Options: DENY` · `X-Content-Type-Options: nosniff` · `Referrer-Policy: strict-origin-when-cross-origin` · `Permissions-Policy: camera=(self), microphone=(), geolocation=(), payment=()` · `Cross-Origin-Opener-Policy: same-origin` · HSTS در Production.
> بدهی D-1: script/style فعلاً `'unsafe-inline'/'unsafe-eval'` دارند (Next bootstrap) — مهاجرت به nonce در فاز Deployment.

### ۴.۲ CORS / Origin
- SPA هم‌مبدأ است → **سیاست پیش‌فرض: ردّ همه مبدأهای متقاطع**.
- استثنا فقط از `CORS_ALLOWED_ORIGINS` (env) — بررسی در middleware قبل از هر کد اپ.
- مبدأِ malformed رد می‌شود؛ نبودِ Origin (کلاینت غیرمرورگری) مجاز ولی لایه CSRF همچنان فعال.

### ۴.۳ CSRF (ED-61) — Double-Submit + Origin
- کوکی `ta_csrf` (خوانا برای JS، sameSite=lax، ۲۴h) == هدر `x-csrf-token`.
- **همه** POST/PATCH/PUT/DELETE روی `/api/v1/*` (middleware، قبل از route) اعمال می‌شود — پوشش سراسری بدون بازنویسی ۳۰+ مسیر.
- **معاف واحد:** `payments/zarinpal/callback` (server-to-server بدون کوکی؛ یکپارچگی = امضای درگاه).
- کلاینت SPA (`contexts/app.tsx`) هدر را از کوکی می‌خواند و به همه درخواست‌های غیر-GET می‌چسباند.
- مقایسه ساده رشته‌ای عمدی است (Edge-safe)؛ محرمانگی توکن ۲۵۶-بیتی خودِ مقدار است نه زمان-مقایسه (تحلیل در THREAT-MODEL).

---

## ۵) Input Validation / SQLi / XSS / Upload

| تهديد | کنترل | تست |
|---|---|---|
| اعتبار ورودی | اعتبارسنجی صریح در مسیرهای حساس (phone regex `^09\d{9}$`، رمز، enumها، طول‌ها) | pentest 422 cases |
| SQL Injection | **صفر کوئری خام** — همه Prisma (پارامتری‌شده)؛ نرمال‌سازی فارسی فقط در حافظه برای جستجو | pentest: `' OR 1=1--` / `DROP TABLE` → 200 بدون اثر |
| XSS | React escape پیش‌فرض + CSP + `nosniff`؛ API خام ذخیره می‌کند و UI رندر امن | pentest: payload `<script>`/`onerror` ذخیره می‌شود، رندر فرار می‌شود |
| File Upload | سه‌لایه: MIME اعلامی ∈ {jpeg,png,webp} → **Magic-Byte sniffing** (سرآیند واقعی فایل) → decode واقعی sharp + گِیت کیفیت؛ سقف ۱۰MB؛ Rate limit؛ Audit ردّها | pentest: فایل متنی با MIME جعلی → 400 |

---

## ۶) Secret Management / Encryption / Signed URLs

### ۶.۱ Secretها (ED-59)
- فقط Env: `JWT_SECRET` (≥۳۲) · `FIELD_ENC_KEY` (32B base64) — **fail-fast در Production**؛ dev فقط با Secret مشتق‌شده هشدار‌دار.
- `.env` از Git untrack شد و gitignore شد (بررسی تاریخچه: فقط DATABASE_URL مسیر dev — بدون نشت).
- اسکن Secret در validators هر فاز (قاعده ۶ منشور).

### ۶.۲ رمزنگاری (ED-65)
- **AES-256-GCM** `encryptField/decryptField` (پاکت `v1:iv:tag:ct`) — برای فیلدهای حساس آتی (کد ملی)؛ دستکاری → شکست AuthTag.
- در دیتابیس هدف (فاز ۰۴) همین الگو برای ستون‌های حساس مستند شد.
- `pseudonymize` (شبه‌نام قطعی per-dataset) + `redactText` (موبایل/ایمیل/کد) برای خروج داده از بستر بالینی.

### ۶.۳ Signed URLها
- HMAC-SHA256 با `JWT_SECRET`، **انقضای ۳۰۰ ثانیه**، مقایسه **timing-safe** (ED قبلی `===` بود — بسته شد).
- فرمت شناسه مقاوم به Path-Traversal (regex `[a-zA-Z0-9]{10,40}` قبل از lookup).

---

## ۷) Audit Logging

- جریان رویداد از `audit()` (api.ts) — entity/entityId/old/new/ip/device/sensitive.
- رویدادهای امنیتی فاز ۰۵: `LOGIN` · `LOGIN_FAILED` · `LOGIN_RATE_LIMITED` · `REGISTER` · `REFRESH_REUSE_DETECTED` · `REFRESH_REJECTED` · `OTP_REQUESTED/VERIFIED/FAILED/RATE_LIMITED` · `CONSENT_GRANTED/REVOKED` · `DATA_EXPORT` · `DELETION_REQUESTED/ANONYMIZED/REJECTED` · `UPLOAD_MAGIC_REJECT` · `MEDICAL_FILE_ACCESS_DENIED`.
- در معماری هدف (ADR-0004) جدول `administration.audit_logs` **Append-Only با تریگر DB** است — UPDATE/DELETE فیزیکی غیرممکن (فاز ۰۴ تست‌شده؛ اتصال اپ در فاز سوئیچ Postgres).

---

## ۸) Medical Data Security (§ ویژه تصاویر زبان)

| الزام | پیاده‌سازی |
|---|---|
| **Private Storage** | فایل‌ها خارج از مسیر عمومی (`storage/uploads` محلی / Object Storage خصوصی `bh-medical` در هدف ADR-0006)؛ سرو غیرمستقیم فقط از مسیر API |
| **Expiring URLs** | Signed URL با TTL ۳۰۰s + timing-safe + انقضای سروری |
| **Access Control** | بیمار=مالک؛ Staff=Permission صریح (ED-66)؛ بدون نشست و بدون امضا → 403 |
| **Download Audit** | `DOWNLOAD_IMAGE` (via SIGNED_URL) — هر دریافت با امضا ثبت می‌شود |
| **Image Access Audit** | `VIEW_MEDICAL_FILE` برای **هر** دسترسی staff (شامل OPERATOR — قبلاً فقط پزشک/کارشناس) + `MEDICAL_FILE_ACCESS_DENIED` برای تلاش‌های رد‌شده |
| **Patient Data Access Audit** | Audit حساس روی: مشاهده پرونده، ویرایش/تأیید نسخه، verify پرداخت، تغییر قیمت، خروجی داده (`DATA_EXPORT`) |
| Metadata | EXIF در pipeline تصویر strip می‌شود (sharp)؛ `is_deidentified` در مدل هدف |
| De-identification | `pseudonymize` + `redactText` برای دیتاست/گزارش (ED-70) |

---

## ۹) Privacy

### ۹.۱ Consent و پذیرش‌ها (ED-67)
- مدل `ConsentRecord` (نسخه‌دار): انواع `TERMS` · `PRIVACY` · `DATA_PROCESSING` · `MEDICAL_IMAGE_AI` · `MARKETING`.
- پذیرش در ثبت‌نام (`acceptTerms`) + اندپوینت‌های `/privacy/consents` (لیست/اعطا).
- **قابل لغو:** فقط `MARKETING` (۴۰۹ برای بقیه تا وقتی رابطه خدمت فعال است) — مسیر خروج کامل: Deletion Request.
- هر رویداد با IP/Device/نسخه سند ثبت می‌شود.

### ۹.۲ Data Access / Export (ED-68)
- `GET /api/v1/privacy/export` — بسته JSON کامل خودِ کاربر (پروفایل، پاسخ‌ها، پرونده‌ها+تشخیص+نسخه‌ها، سفارش‌ها، تیکت‌ها)؛ **۱ بار در ۲۴ ساعت**؛ Audit حساس.
- Data Access بیمار از قبل از طریق داشبورد/پرونده خودش (scope مالکیت).

### ۹.۳ Deletion Request → Anonymization (ED-69)
- `POST /api/v1/privacy/deletion-request` (کاربر) → صف ادمین `GET/PATCH /api/v1/admin/deletion-requests`.
- **ANONYMIZE** (اجرای ادمین): تلفن/نام/کدملی/ایمیل/تاریخ تولد → جاگذار غیرقابل بازگشت، ابطال همه نشست‌ها، غیرفعال‌سازی حساب، تصاویر `REJECTED/RIGHT_TO_ERASURE`؛ **تجمیع‌های مالی/بالینی حفظ می‌شوند** (تعهد حسابداری ED-49؛ سازگار با Soft-Delete-فقط-status فاز ۰۴).
- تکرار درخواستِ در-جریان → 409.

---

## ۱۰) تست‌های نفوذ داخلی و Negative Tests

| سوئیت | تعداد | اجرا |
|---|---|---|
| Unit (bun) — AuthN/AuthZ/OTP/CSRF/Encryption/RL/Anonymize | ۳۵ | `bun run test:security` |
| HTTP Pentest — brute force, JWT tamper (alg-none/فارِج), IDOR, privilege escalation, CSRF×۳, Origin, MIME spoof, empty upload, unauth upload, expired/tampered/unknown signed URL, path traversal, SQLi×۲, XSS storage, headers×۵, privacy×۱۲, OTP×۳ | ۴۵ | `bun run pentest` |

سیناریوهای کلیدی Negative:
- توکن JWT دستکاری‌شده (تغییر role به ADMIN + امضای وارونه) → 401 در me و admin.
- POST بدون/با CSRF غلط → 403؛ Origin خارجی → 403.
- ۵ رمز غلط → ۴۰۱×۵؛ تلاش ششم حتی با رمز درست → **429**.
- تیکت با payload XSS ذخیره می‌شود؛ رندر React فرار می‌دهد (CSP لایه دوم).
- تصویر بیمار دیگر (بدون نشست/امضا) → 403.

---

## ۱۱) نقشه فایل‌ها

```
src/middleware.ts                          ← Origin/CORS + CSRF سراسری
src/lib/security/
├── env.ts            ← secretها + fail-fast prod
├── rate-limit.ts     ← اسلایدینگ-ویندو + presets
├── csrf.ts           ← double-submit (Edge-safe)
├── otp.ts            ← چالش OTP/MFA + Port SMS
├── encryption.ts     ← AES-256-GCM + pseudonymize/redact
└── privacy.ts        ← consent/export/deletion/anonymize
src/lib/auth.ts (سخت‌شده) ← چرخش+Replay-kill + timing-safe sig
src/app/api/v1/auth/{register,login,refresh}/route.ts + auth/otp/{request,verify}
src/app/api/v1/privacy/{consents,consents/revoke,export,deletion-request}
src/app/api/v1/admin/deletion-requests
tests/security-pentest.sh                  ← ۴۵ چک نفوذی
src/lib/security/__tests__/security.test.ts ← ۳۵ تست واحد
```

## ۱۲) بدهی و گام‌های بعدی

| ID | مورد | فاز هدف |
|---|---|---|
| D-1 | CSP nonce-based (حذف unsafe-inline) | Deployment |
| D-2 | Rate-limit Redis (چند-Replica) | Deployment |
| D-3 | XFF فقط پشت Proxy معتبر (پیکربندی لبه) | Deployment |
| D-4 | سوئیچ اپ → PostgreSQL فاز ۰۴ (AuditLog تریگری) + MFA فعال‌سازی UI/OTP برای PASSWORD_RESET کامل | فاز ۰۶ |
| D-5 | Malware-Scan فایل (ClamAV) در Upload | Hardening بعدی |
| D-6 | Account-Lockout اطلاع‌رسانی SMS + CAPTCHA پیش از قفل | محصول |
