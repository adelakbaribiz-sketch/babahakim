# BabaHakim — Threat Model | مدل تهدید (PHASE 05)

> **روش:** STRIDE (دسته‌بندی) + DREAD (اولویت‌دهی) · **دامنه:** اپ Next.js + API + دیتابیس + فایل‌های پزشکی + گردش کار بالینی
> **مرجع پیاده‌سازی:** `SECURITY.md` · **وضعیت:** هر تهدید به کنترل کد + تست زنده نگاشت شده (قاعده ۲ منشور: هر قاعده قابل تست).

---

## ۱) دارایی‌ها (Assets)

| ID | دارایی | طبقه‌بندی |
|---|---|---|
| A1 | تصاویر زبان/چهره بیماران | پزشکی-بسیار حساس |
| A2 | شرح حال، تشخیص، نسخه، مزاج | پزشکی-حساس |
| A3 | هویت (تلفن/کدملی/نام) و نشست‌ها | PII |
| A4 | سوابق مالی (پرداخت/فاکتور) | مالی-حساس |
| A5 | Integrity گردش کار (نسخه/تأیید/پرداخت) | Critical |
| A6 | مدل‌ها/دیتاست‌های AI | محرمانه تجاری |
| A7 | Secretها (JWT/ENC) و AuditLog | Critical |
| A8 | دسترس‌پذیری سرویس (بیمار/کارشناس) | Availability |

## ۲) کنترل‌کنندگان تهدید و مرزهای اعتماد

```
[ اینترنت ]
   │  TLS (لبه)
[ مرز ۱: Reverse Proxy ]  ← هدرها/HSTS/محدودیت نرخ لبه (هدف)
   │
[ مرز ۲: Middleware (Edge) ]  ← Origin + CSRF double-submit (پیاده‌شده)
   │
[ مرز ۳: API Routes (Node) ]  ← AuthN (JWT/Refresh/OTP) + AuthZ (RBAC/مالکیت) + RL + Audit
   │                    │
[ مرز ۴: دیتابیس ]   [ مرز ۵: فایل پزشکی ]
  (CHECK/تریگر-های    (مسیر خصوصی + Signed URL
   فاز ۰۴ هدف)         انقضادار + Audit دسترسی)
```
- **Actorها:** بیمار · کارشناس۱ · کارشناس۲ · پزشک · اپراتور · ادمین · سیستم (Worker/درگاه) · مهاجم خارجی · کاربر Insider سوءاستفاده‌گر.

---

## ۳) کاتالوگ تهدیدها (STRIDE + DREAD)

امتیاز DREAD: هر محور ۰..۱۰؛ **Risk = میانگین**. وضعیت: 🟢 کنترل‌شده+تست‌شده · 🟡 کنترل با بدهی · 🔴 باز.

### Spoofing (جعل هویت)

| ID | تهدید | D/R/E/A/D | Risk | کنترل | تست |
|---|---|---|---|---|---|
| T-SPF-01 | حدس رمز / Brute-force حساب | 8/6/8/10/4 | 7.2 🟢 | قفل ۵ خطا→۱۰دقیقه + RL حساب 5/5m + Audit | pentest: 401×۵ سپس 429 |
| T-SPF-02 | Credential Spraying از یک IP روی حساب‌های متعدد | 7/7/7/9/4 | 6.8 🟢 | RL per-IP 15/5m | pentest (RUN_IP isolation) |
| T-SPF-03 | سرقت Refresh Token و استفاده مجدد | 9/6/6/10/5 | 7.2 🟢 | چرخش + کشف Replay → کشتار خانواده (ED-64) | unit: replay kills family |
| T-SPF-04 | جعل JWT (alg-none/امضای خارجی/tamper payload) | 8/5/4/10/3 | 6.0 🟢 | HS256 پین + iss/aud + verify سخت‌گیرانه | unit ×۴ + pentest forge |
| T-SPF-05 | جعل درگاه پرداخت (Callback جعلی) | 9/4/3/9/6 | 6.2 🟢 | کلید Idempotency + Authority یکتا + verify درگاه | فاز ۰۰ E2E + check DB |
| T-SPF-06 | MFA bypass (حدس OTP) | 8/5/3/10/3 | 5.8 🟢 | ۵ تلاش/۲ دقیقه TTL/هش/یک‌بارمصرف/RL ارسال | unit ×۴ + pentest |
| T-SPF-07 | جعل هویت بیمار در تماس/تیکت (SOCIAL) | 6/4/5/6/5 | 5.2 🟡 | احراز درگاهِ مالکیت + ContactLog (فرآیند سازمانی مستند) | — (D-6) |

### Tampering (دستکاری)

| ID | تهدید | Risk | کنترل | تست |
|---|---|---|---|---|
| T-TAM-01 | دستکاری payload سفارش (total≠subtotal-discount+shipping) | 6.4 🟢* | CHECK دیتابیس هدف (فاز ۰۴) + منطق اپ | db-tests ×۸۵ |
| T-TAM-02 | alg-confusion در JWT | 6.0 🟢 | allowlist الگوریتم در jose | unit |
| T-TAM-03 | دستکاری تاریخچه قیمت/حساب/رویداد | 7.0 🟢* | Append-Only + تریگر forbid_mutation (DB هدف) | db-tests |
| T-TAM-04 | دستکاری امضای Signed URL تصویر | 6.6 🟢 | HMAC + timing-safe + انقضا | unit ×۴ + pentest |
| T-TAM-05 | دستکاری رضایت (Consent) کاربر | 5.4 🟢 | رویداد فقط-افزودنی با IP/Device | unit + pentest |
| T-TAM-06 | CSRF — اجرای عملیات از سایت مهاجم | 8.2 🟢 | double-submit سراسری + Origin + معاف واحد درگاه | pentest ×۳ |
| T-TAM-07 | آپلود فایل جعلی (MIME دروغ/Payload) | 7.0 🟢 | Magic-byte + sharp decode + سایز + RL + Audit | pentest: fake jpg→400 |

### Repudiation (انکار)

| ID | تهدید | Risk | کنترل | تست |
|---|---|---|---|---|
| T-REP-01 | انکار مشاهده پرونده پزشکی توسط staff | 8.0 🟢 | VIEW_MEDICAL_FILE برای همه staff (بسته شکاف OPERATOR) | کد + سناریوی audit |
| T-REP-02 | انکار دانلود/اشتراک تصویر | 7.0 🟢 | DOWNLOAD_IMAGE روی Signed URL | کد |
| T-REP-03 | انکار عملیات مالی/نسخه | 7.4 🟢 | WORKFLOW_* + حسابرسی اتمیک (ED-32) | فاز ۰۲ تست‌ها |
| T-REP-04 | حذف/ویرایش AuditLog توسط DBA | 8.6 🟢* | تریگر Append-Only در DB هدف | db-tests: UPDATE/DELETE→check_violation |

### Information Disclosure (افشا)

| ID | تهدید | Risk | کنترل | تست |
|---|---|---|---|---|
| T-INF-01 | IDOR — دسترسی پرونده/تصویر بیمار دیگر | 9.0 🟢 | مالکیت سروری + Permission ED-66 | pentest: patient2→case/ایمج 403 |
| T-INF-02 | لینک تصویر عمومی/ماندگار | 8.4 🟢 | Signed URL ۳۰۰s + مسیر خصوصی | pentest: بدون sig→403 |
| T-INF-03 | افشای اطلاعات از پیام خطا (User Enumeration) | 5.8 🟢 | پیام واحد login 401؛ 404/403 عمدی | pentest |
| T-INF-04 | افشای PII در گزارش/دیتاست | 7.2 🟡 | redactText/pseudonymize (ED-70) — اعمال در pipeline دیتاست فاز آینده | unit |
| T-INF-05 | افشای Secret در Git/لاگ | 8.8 🟢 | env fail-fast + untrack .env + اسکن validators | اسکن هر فاز |
| T-INF-06 | Rowhammer/دسترسی مستقیم DB از بیرون | 8.0 🟡 | شبکه ایزوله Docker (هدف ADR-0011) | استقرار فاز Deployment |
| T-INF-07 | افشای داده در خروجی Export توسط مهاجم نشست‌دارِ دیگری | 8.6 🟢 | scope مالکیت + RL + Audit | pentest: export 401/200/429 |

### Denial of Service

| ID | تهدید | Risk | کنترل | تست |
|---|---|---|---|---|
| T-DOS-01 | سیل درخواست Login/OTP | 7.4 🟢 | RL چند-کلیدی + 429/Retry-After | pentest |
| T-DOS-02 | Flood آپلود | 6.8 🟢 | RL upload 20/m + سقف سایز | کد |
| T-DOS-03 | Flood Export (CPU/IO) | 6.2 🟢 | RL 1/day | pentest: 429 |
| T-DOS-04 | L7 حجمی (Syn flood و…) | 8.0 🟡 | محدودیت لبه/CDN — فاز Deployment | — (D-2/D-3) |

### Elevation of Privilege

| ID | تهدید | Risk | کنترل | تست |
|---|---|---|---|---|
| T-EOP-01 | بیمار → عملیات ادمین | 9.2 🟢 | requirePermission سروری | pentest: 403×۴ |
| T-EOP-02 | جعل نقش در JWT (ادعا) | 8.8 🟢 | امضا + دسترسی از DB در getAuth (نه ادعا) | pentest forge |
| T-EOP-03 | OPERATOR → مشاهده تصویر بدون Permission | 7.0 🟢 | ED-66 سروری | unit-محور + کد |
| T-EOP-04 | Mass Assignment (فیلدهای غیرمجاز) | 6.6 🟡 | اعتبارسنجی صریح در مسیرهای حساس؛ الگوی Zod برای بقیه — بدهی D-7 | pentest بخشی |

**\* ستاره:** کنترل کامل در دیتابیس PostgreSQL هدف فاز ۰۴ مستقر است؛ اپ SQLite فعلی منطق اپ-سایت دارد (سوئیچ: D-4 در SECURITY.md).

---

## ۴) سناریوهای حمله کلیدی (Attack Narratives)

1. **سرقت نشست کامل:** مهاجم Refresh را می‌دزدد → اولین چرخشِ قربانی → مهاجم با توکن قدیمی برمی‌گردد → **خانواده کشته می‌شود**؛ هر دو مجبور به login مجدد (رویداد `REFRESH_REUSE_DETECTED` برای آشکارسازی جرم).
2. **CSRF روی تأیید پرداخت:** سایت شرور POST به `/payments/…/verify` → Origin خارجی → 403 قبل از route؛ با Origin جعل‌شده؟ مرورگر اجازه Set-Cookie/هدر سفارشی متقاطع را بدون preflight نمی‌دهد و preflight توسط سیاست CORS رد می‌شود.
3. **جعل هویت با توکن دستکاری‌شده:** payload role=ADMIN + امضای چرخیده → verify (alg پین + امضا) → 401؛ حتی اگر رد می‌شد، getAuth نقش را از DB می‌خواند نه ادعا.
4. **دسترسی به تصویر زبان:** لینک بدون امضا → 403؛ امضای منقضی/دستکاری → 403؛ کارشناس بدون Permission → 403 + رویداد `MEDICAL_FILE_ACCESS_DENIED`.
5. **Input Injection:** SQLi در جستجو → Prisma پارامتری → بی‌اثر؛ XSS در تیکت → ذخیره خام، رندر React فرار + CSP.

## ۵) ریسک‌های باقی‌مانده (Residual) — رتبه‌بندی

| # | ریسک | چرا باز | اقدام |
|---|---|---|---|
| R1 | RL درون-حافظه در استقرار چند-Replica ناهم‌داستان است | پیاده‌سازی تک-پروسه فعلی | Redis adapter (D-2) قبل از Scale |
| R2 | CSP با unsafe-inline | Next bootstrap | nonce migration (D-1) |
| R3 | IP از XFF قابل جعل است بدون Proxy معتبر | توپولوژی فعلی | پیکربندی لبه (D-3) |
| R4 | Malware در فایل تصویری (نه اجرا، ولی ذخیره) | بدون AV | ClamAV در Upload (D-5) |
| R5 | سوءاستفاده Insider با Permission معتبر | ذاتاً کامل نیست | Audit کامل + بازبینی دوره‌ای `is_sensitive` |
| R6 | CSRF مقایسه غیر-ثابت-زمان | توکن ۲۵۶-بیتی تصادفی | قابل ارتقا در صورت نیاز (تحلیل §4.3 SECURITY) |

## ۶) پوشش تست ↔ تهدید

| تهدید | Unit (35) | Pentest (45) |
|---|---|---|
| T-SPF-01/02 | — | ✓ (brute + RL) |
| T-SPF-03 | ✓ (family kill) | ✓ (refresh 401) |
| T-SPF-04 | ✓ ×۴ (tamper/forge/none/aud) | ✓ ×۲ (forge HTTP) |
| T-SPF-06 | ✓ ×۴ (OTP lifecycle) | ✓ ×۳ |
| T-TAM-04/06 | ✓ ×۵ (sig/csrf) | ✓ ×۳ |
| T-TAM-07 | — | ✓ ×۳ (MIME/empty/unauth) |
| T-REP-01/02 | — | ✓ (کد + MED) |
| T-INF-01 | — | ✓ (IDOR + admin 403) |
| T-INF-02 | ✓ (sig ×۴) | ✓ ×۴ |
| T-INF-05 | — | ✓ (headers + env) |
| T-EOP-01/03 | ✓ (permission path) | ✓ ×۴ |
| T-DOS-01/03 | ✓ (RL ×۳) | ✓ (429) |
| T-REP/deletion | ✓ (anonymize) | ✓ ×۱۲ (privacy) |
