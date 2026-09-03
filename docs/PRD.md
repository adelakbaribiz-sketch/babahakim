# BabaHakim — سند نیازمندی‌های محصول (PRD)

| فیلد | مقدار |
|---|---|
| نام پروژه | BabaHakim (باباحکیم) |
| شناسه فنی | `babahakim` |
| نسخه سند | 1.0.0 |
| تاریخ | 1405/06/13 (2026-09-04) |
| فاز | PHASE 01 — Product Requirements & System Specification |
| مالک سند | Senior Software Architect & Lead Engineer |
| وضعیت | Approved — مبنای فازهای بعدی |
| مرجع نیازمندی | Master Prompt نسخه ۱۰۴ بخشی (`upload/Pasted Content_1788467744752.txt`) |
| زبان سند | فارسی (اصطلاحات فنی به انگلیسی حفظ شده‌اند) |

> **قاعده حاکم بر این سند:** هیچ نیازمندی در این سند «به‌صورت ضمنی» در نظر گرفته نمی‌شود. هر قابلیت دارای شناسه یکتا (FR/NFR) است و در ماتریس Traceability به User Story، Use Case، Business Rule، Acceptance Criterion و وضعیت پیاده‌سازی نگاشت می‌شود. ابهامات محصول با «Engineering Decision» (ED) حل و در `BUSINESS-RULES.md` ثبت شده‌اند.

---

## فهرست

1. [معرفی محصول و چشم‌انداز](#1-معرفی-محصول-و-چشم‌انداز)
2. [شخصیت‌های کاربری (Personas) و نقش‌ها](#2-شخصیت‌های-کاربری-personas-و-نقش‌ها)
3. [دامنه محصول (Scope)](#3-دامنه-محصول-scope)
4. [مفروضات، محدودیت‌ها و وابستگی‌ها](#4-مفروضات-محدودیت‌ها-و-وابستگی‌ها)
5. [نیازمندی‌های عملکردی (Functional Requirements)](#5-نیازمندی‌های-عملکردی-functional-requirements)
6. [نیازمندی‌های غیرعملکردی (Non-Functional Requirements)](#6-نیازمندی‌های-غیرعملکردی-non-functional-requirements)
7. [کاتالوگ رخدادها و اعلان‌ها (Notification Catalog)](#7-کاتالوگ-رخدادها-و-اعلان‌ها-notification-catalog)
8. [کاتالوگ تأییدها (Approval Catalog)](#8-کاتالوگ-تأییدها-approval-catalog)
9. [مدل چرخه عمر بیمار (Patient Lifecycle)](#9-مدل-چرخه-عمر-بیمار-patient-lifecycle)
10. [شاخص‌های موفقیت محصول (KPI)](#10-شاخص‌های-موفقیت-محصول-kpi)
11. [ریسک‌های محصول و کاهش آن‌ها](#11-ریسک‌های-محصول-و-کاهش-آن‌ها)
12. [نقشه انتشار (Release Roadmap)](#12-نقشه-انتشار-release-roadmap)
13. [واژه‌نامه دوزبانه](#13-واژه‌نامه-دوزبانه)
14. [ارجاعات و اسناد مرتبط](#14-ارجاعات-و-اسناد-مرتبط)

---

## 1. معرفی محصول و چشم‌انداز

### 1.1 شرح محصول

BabaHakim یک **پلتفرم سلامت مبتنی بر هوش مصنوعی** برای **تحلیل تصویر زبان و مدیریت پرونده سلامت بیماران** است. هسته محصول، یک گردش کار بالینی چندمرحله‌ای است که از ثبت‌نام بیمار شروع می‌شود، با پرسشنامه مزاج‌شناسی (بر پایه طب ایرانی)، آپلود تصویر زبان، تحلیل preliminary توسط AI، و سپس **زنجیره بازبینی انسانی** (کارشناس اول ← کارشناس دوم ← پزشک) ادامه می‌یابد و در نهایت به تجویز نسخه، فروش اقلام دارویی، پرداخت، ارسال و پیگیری درمان منتهی می‌شود.

محصول علاوه بر مسیر بالینی، یک **واحد کسب‌وکار کامل** شامل فروشگاه محصولات سلامت، سفارش، پیش‌فاکتور، درگاه پرداخت، ارسال با پیک/خودرو/پست، سیستم معرف (Referral)، مالی و گزارش‌گیری دارد.

### 1.2 اصول طراحی محصول (Product Principles)

این اصول از Master Prompt استخراج شده و **غیرقابل مذاکره** هستند:

| # | اصل | شرح |
|---|---|---|
| P1 | **AI-Assisted CDS** | هوش مصنوعی ابزار «پشتیبان تصمیم بالینی» است؛ هیچ نتیجه پزشکی حساس صرفاً از خروجی خام AI قطعی نمی‌شود. زنجیره الزمی: AI → Expert 1 → Expert 2 → Doctor → User. |
| P2 | **شفافیت AI** | UI باید در همه نقاط مرتبط، AI Confidence، عدم قطعیت، نیاز به بررسی انسانی، توضیحات کارشناس و نسخه نهایی تأییدشده را نشان دهد. Explainability هرگز به‌عنوان «اثبات قطعی پزشکی» عرضه نمی‌شود. |
| P3 | **Audit-First** | هر عمل حساس (ورود، مشاهده پرونده پزشکی، تغییر تشخیص/نسخه/قیمت، تأیید/رد، پرداخت، حذف، Export) دارای رکورد Audit کامل (بازیگر، زمان، IP، مقادیر قبلی/جدید) است. |
| P4 | **Preservation of History** | تاریخچه داده‌های مهم (قیمت، نسخه، نتایج پرسشنامه، تراکنش‌ها) هرگز حذف یا بازنویسی نمی‌شود؛ تغییر یعنی «نسخه جدید + حفظ قدیمی». |
| P5 | **Privacy by Design** | تصاویر پزشکی هرگز Public نمی‌شوند؛ دسترسی فقط از طریق Signed URL منقضی‌شونده و با Audit. اطلاعات سلامت هرگز در URL قرار نمی‌گیرد. |
| P6 | **دوزبانه واقعی** | فارسی (RTL + تقویم شمسی) و انگلیسی (LTR + تقویم میلادی) از روز اول؛ هیچ متن Hardcode شده در UI نیست (i18n کامل). |
| P7 | **عدم جعل نتایج پزشکی** | در محیط Development/Demo هیچ خروجی ساختگی به‌عنوان نتیجه واقعی پزشکی نمایش داده نمی‌شود؛ برچسب `SIMULATED / DEMO / NOT MEDICAL RESULT` الزامی است. |
| P8 | **Production-Grade** | هدف یک Demo نیست؛ محصول باید قابل Deploy روی سرور واقعی، قابل Test، قابل Backup و قابل توسعه باشد. |

### 1.3 چشم‌انداز (Vision)

تبدیل شدن به مرجع **ایمن و قابل اعتماد** تحلیل تصویر زبان در طب ایرانی با سه موتور ارزش‌آفرین:

1. **موتور بالینی:** گردش کار چندلایه با بازبینی انسانی که ایمنی بیمار را تضمین می‌کند.
2. **موتار داده:** جمع‌آوری ساخت‌یافته (تصویر + برچسب کارشناس + پیگیری درمان) برای بهبود تدریجی مدل AI — بدون خودآموزی خطرناک.
3. **موتور کسب‌وکار:** فروش اقلام درمانی با کنترل نسخه، پرداخت امن و پیگیری تحویل.

---

## 2. شخصیت‌های کاربری (Personas) و نقش‌ها

سیستم دقیقاً **۶ نقش** دارد (RBAC + Permission-Based). جدول زیر Persona، هدف اصلی و دسترسی‌های کلیدی هر نقش را نشان می‌دهد. ماتریس کامل دسترسی‌ها در `BUSINESS-RULES.md §2` آمده است.

| نقش | Persona | هدف اصلی در محصول | دسترسی‌های کلیدی (خلاصه) |
|---|---|---|---|
| **Patient / User** (بیمار) | «سارا»، ۳۴ ساله، کاربر موبایل | دریافت ارزیابی مزاج و زبان، خرید اقلام درمانی با اطمینان | ثبت‌نام، پروفایل، پرسشنامه، آپلود تصویر، تأیید ارزیابی/پیش‌فاکتور، پرداخت، فروشگاه OTC، تیکت، پیگیری ارسال |
| **Expert 1** (کارشناس اول) | «کیارش»، کارشناس ارزیابی اولیه | بررسی سریع پرونده‌های صف و صدور ارزیابی و نسخه اولیه | Claim پرونده، مشاهده تصاویر/شرح حال، ثبت تشخیص اولیه، نسخه + دستور مصرف، تدابیر غذایی، ارجاع مجدد |
| **Expert 2** (کارشناس دوم) | «ثریا»، داور فنی و تجاری | بازبینی نسخه، قیمت‌گذاری و اقلام، ارسال به پزشک | Review نتیجه Expert 1، ویرایش نسخه، تعیین اقلام موجود/ناقص، قیمت، ارسال به Doctor، پیش‌فاکتور |
| **Doctor** (پزشک) | «دکتر نیک‌پور»، مقام نهایی بالینی | تأیید ایمن نسخه‌ها | Approve / Reject / Request Revision + کامنت، مشاهده کل پرونده و پیشنهادها، تاریخچه |
| **Operator** (اپراتور) | «پویا»، هماهنگ‌کننده عملیات | اجرای روان چرخه عملیاتی و مالی | تأیید پرداخت کارت‌به‌کارت، پیش‌فاکتور، ارسال/تحویل، تیکت، پیگیری بیماران، مدیریت محصولات/قیمت، SMS |
| **Admin** (مدیر سیستم) | «رعیا»، مدیر کسب‌وکار و سیستم | حاکمیت داده، تنظیمات و گزارش | همه دسترسی‌ها؛ مدیریت کاربران/RBAC، بیماری‌ها، محصولات/قیمت/Import، پرسشنامه، AI Models، مالی، Audit، گزارش‌ها |

**نکات مدل‌سازی نقش‌ها:**

- نقش Patient به‌جای Permissionهای سازمانی، مالکیت داده خود را دارد (Ownership-based access): فقط به پرونده/تصاویر/سفارش‌های خودش دسترسی دارد.
- تخصیص نقش فقط توسط Admin و با Audit انجام می‌شود؛ کاربر خودش نقش خود را تغییر نمی‌دهد.
- یک کاربر هم‌زمان فقط یک نقش دارد (ED-26؛ جزئیات در BUSINESS-RULES.md).

---

## 3. دامنه محصول (Scope)

### 3.1 در دامنه (In Scope) — ۱۸ ماژول محصول

| # | ماژول | شرح | FR Domain |
|---|---|---|---|
| M01 | مدیریت هویت و دسترسی | ثبت‌نام، ورود، نشست، قفل حساب، Consent | `AUTH` |
| M02 | پروفایل و پرونده سلامت بیمار | اطلاعات پایه + تاریخچه بالینی کامل | `PROF` |
| M03 | موتور مزاج‌شناسی (Questionnaire) | پرسشنامه Versioning-دار و قابل مدیریت | `MIZAJ` |
| M04 | خط لوله تصویر پزشکی | Validation، کیفیت، فشرده‌سازی، نسخه‌بندی ۴گانه | `IMG` |
| M05 | موتور AI و Explainability | تحلیل تصویر زبان با Confidence و بازبینی انسانی | `AI` |
| M06 | مدیریت Dataset و یادگیری | ذخیره بازخوردها، Disagreement، Dataset Versioning | `AI` |
| M07 | موتور Workflow (پرونده) | State Machine با ۲۱ وضعیت و Audit کامل | `CASE` |
| M08 | صف کارشناسان و SLA | صف، Claim، اولویت، Escalation | `CASE` |
| M09 | پنل کارشناس اول | ارزیابی اولیه، تشخیص، نسخه | `EXP1` |
| M10 | پنل کارشناس دوم | داوری، قیمت‌گذاری، اقلام، ارسال به پزشک | `EXP2` |
| M11 | پنل پزشک | تأیید نهایی بالینی | `DR` |
| M12 | موتور نسخه (Prescription) | Entity مستقل + Versioning | `RX` |
| M13 | فروشگاه و کاتالوگ | جستجوی فارسی-normalized، سبد خرید، OTC | `SHOP` |
| M14 | سفارش، پیش‌فاکتور و فاکتور | Proforma، تأیید، Invoice | `ORD` |
| M15 | پرداخت | Zarinpal + کارت‌به‌کارت + Idempotency | `PAY` |
| M16 | ارسال و تحویل | پیک/خودرو/پست + Tracking | `SHIP` |
| M17 | پیگیری درمان (Follow-up) | زمان‌بندی، Reminder، Outcome | `FUP` |
| M18 | پشتیبانی و ارتباطات | تیکت، اعلان چندکاناله، SMS Log | `TKT`, `NTF` |
| M19 | مالی، گزارش و Referral | درآمد/هزینه/بدهی، گزارش‌های پویا، معرف | `FIN`, `REF` |
| M20 | پنل Admin و حاکمیت | کاربران، RBAC، بیماری‌ها، قیمت، پرسشنامه، AI، Audit | `ADM`, `AUD` |

> ماژول‌های M01–M20 بیان **قابلیت محصول** هستند؛ معماری فنی (سرویس‌ها، صف‌ها، استقرار) در فاز ۰۲ (ARCHITECTURE.md) مستند می‌شود.

### 3.2 خارج از دامنه فعلی (Out of Scope — v1)

| مورد | دلیل | زمان بازنگری |
|---|---|---|
| اپلیکیشن Native (iOS/Android) | UI Responsive وب، PWA-ready | Phase 06+ |
| Multi-Tenant واقعی (چند سازمان) | v1 تک‌سازمانی؛ Schema آماده `orgId` آینده (ED-22) | بعد از Product-Market Fit |
| پرداخت با درگاه‌های غیر از Zarinpal | Abstraction آماده (PaymentProvider) اما فقط Zarinpal فعال | به‌موجب نیاز کسب‌وکار |
| Elasticsearch/OpenSearch | جستجوی normalized DB برای حجم فعلی کافی است (ED-23) | وقتی Scale داده ایجاب کند |
| Push Notification (فوری) | In-app + SMS کانال‌های اصلی ثبت شده‌اند؛ Push معماری‌پذیر | v1.1 |
| تماس تصویری/چت زنده با پزشک | مدل ارتباط فعلی: تیکت + کامنت + اظهارنظر | v2 |
| فروش بین‌المللی و ارز غیر تومان | بازار هدف: ایران | — |

---

## 4. مفروضات، محدودیت‌ها و وابستگی‌ها

### 4.1 مفروضات (Assumptions)

- A1: بازار هدف ایران است؛ شماره موبایل شناسه اصلی کاربر است و پیامک کانال ارتباطی قابل اتکاست.
- A2: واحد پول تومان (Toman) با ذخیره‌سازی عدد صحیح است (ED-11).
- A3: کاربران بیمار با موبایل (عمده) و کارکنان با دسکتاپ کار می‌کنند؛ UI باید برای هر دو بهینه باشد.
- A4: مدل AI تشخیص زبان در زمان راه‌اندازی v1 از نوع Mock/Heuristic قابل اجراست (TongueModelV1)؛ معماری جایگزینی با مدل واقعی (Local/GPU/Cloud API) بدون تغییر هسته فراهم است (ED-25).
- A5: خدمات بیرونی (زرین‌پال، SMS Provider) در محیط Development با Mock/Adapter قابل تست هستند.

### 4.2 محدودیت‌ها (Constraints)

- C1: **حقوقی/تنظیمی:** پیش از استقرار Production، الزامات قانونی حفاظت داده سلامت و مقررات پزشکی ایران باید توسط متخصص حقوقی تأیید شود (Production Checklist). تا آن زمان برچسب DEMO الزامی است.
- C2: **زبان و تقویم:** UI فارسی = RTL + تقویم شمسی؛ UI انگلیسی = LTR + میلادی؛ ذخیره‌سازی DateTime استاندارد UTC (timezone-aware) — تبدیل‌های تقویمی هرگز نباید تاریخ ثبت‌شده را خراب کنند.
- C3: **رنگ برند:** پالت رسمی BabaHakim (`#173F76` آبی تیره، `#225BBE` آبی، `#57AFE2` آبی روشن، `#DEDBDB` خاکستری) تنها مرجع رنگ است؛ رنگ‌های Semantic فقط برای موفقیت/هشدار/خطا (مطابق DESIGN-SYSTEM).
- C4: **Schema فقط با Migration:** هیچ تغییر دستی Schema بدون Migration مجاز نیست.
- C5: **داده تست:** داده واقعی بیمار هرگز وارد Seed/Development نمی‌شود.
- C6: **اجرای یک‌دستوری:** پروژه باید با یک فرمان (Docker Compose یا اسکریپت) در VSCode قابل اجرا باشد.

### 4.3 وابستگی‌های بیرونی (External Dependencies)

| وابستگی | نوع | وضعیت v1 | استراتژی |
|---|---|---|---|
| Zarinpal Payment Gateway | پرداخت | Adapter واقعی + Mock قابل اجرا برای تست | PaymentProvider Interface |
| SMS Provider (Kavenegar/…) | پیامک | Adapter + SMSLog کامل | Provider Interface؛ ثبت و Retry مستقل از موفقیت ارسال |
| Object Storage سازگار با S3 | ذخیره‌سازی تصاویر | Storage Adapter با نسخه‌بندی و Hash | Signed URL + Expiration |
| مدل AI تشخیص زبان | استنتاج | TongueModelV1 (Heuristic قابل اجرا) | AIModelProvider Interface + رجیستری مدل |

---

## 5. نیازمندی‌های عملکردی (Functional Requirements)

قواعد نگارش: هر FR یک شناسه یکتا، شرح، اولویت MoSCoW، مرجع بخش Master Prompt (§) و وضعیت پیاده‌سازی فعلی دارد. «وضعیت» فقط گزارش صداقت‌محور Traceability است و ربطی به الزام بودن نیازمندی ندارد.

راهنمای وضعیت: **[I]** = پیاده‌سازی‌شده در v1 فعلی · **[P]** = جزئی · **[R]** = برنامه‌ریزی‌شده (فازهای بعد)

### 5.1 ماژول M01 — هویت و دسترسی (`FR-AUTH`)

| ID | شرح نیازمندی | اولویت | مرجع | وضعیت |
|---|---|---|---|---|
| FR-AUTH-01 | ثبت‌نام بیمار با شماره موبایل (یکتا)، نام، نام خانوادگی، جنسیت، تاریخ تولد و رمز عبور؛ تولید خودکار کد معرف در ثبت‌نام | Must | §1, §36 | [I] |
| FR-AUTH-02 | پذیرش Privacy Policy و Terms در ثبت‌نام با ثبت نسخه و زمان Consent | Must | §59 | [P] — رکورد Consent ثبت می‌شود؛ صفحه متون قانونی مستقل v1.1 |
| FR-AUTH-03 | ورود با موبایل + رمز عبور؛ JWT Access (کوتاه‌عمر) + Refresh Token چرخشی (Rotation) در کوکی httpOnly | Must | §43 | [I] |
| FR-AUTH-04 | خروج فعال (Logout) با ابطال Refresh Token + Audit | Must | §42 | [I] |
| FR-AUTH-05 | قفل حساب بعد از N تلاش ناموفق ورود (Brute-Force Protection) با ثبت زمان قفل | Must | §43, §56 | [I] |
| FR-AUTH-06 | Rate Limiting روی Login، آپلود تصویر، API، Payment و Ticket | Must | §89 | [P] — روی Login و آپلود فعال؛ پوشش کامل Endpoints در فاز Hardening |
| FR-AUTH-07 | رمز عبور با Hash مقاوم (scrypt) و سیاست حداقل طول | Must | §43 | [I] |
| FR-AUTH-08 | ورود دومرحله‌ای OTP (اختیاری/آینده) — آماده‌سازی Rate Limit | Could | §89 | [R] |

### 5.2 ماژول M02 — پروفایل و پرونده سلامت (`FR-PROF`)

| ID | شرح نیازمندی | اولویت | مرجع | وضعیت |
|---|---|---|---|---|
| FR-PROF-01 | فرم مشخصات اولیه: نام، نام خانوادگی، موبایل، ایمیل (اختیاری)، جنسیت، تاریخ تولد، سن (محاسبه‌شده — ED-21)، کد ملی (اختیاری و امن — ED-21)، آدرس، کد پستی، استان، شهر، اطلاعات تماس، معرف، وضعیت حساب | Must | §6 | [I] |
| FR-PROF-02 | پرونده سلامت بیمار شامل: تاریخچه مراجعات، تصاویر زبان/چهره، شرح حال، نتایج مزاج‌شناسی، تشخیص‌های قبلی، نسخه‌های قبلی، داروها و دستور مصرف، کامنت کارشناسان و پزشک، روند درمان، Follow-upها، تاریخ ارجاع بعدی، Feedback | Must | §6 | [I] |
| FR-PROF-03 | ویرایش اطلاعات بیمار توسط کاربر خودش و توسط کارکنان مجاز — همیشه با Audit | Must | §6, §42 | [I] |
| FR-PROF-04 | Patient Timeline: نمایش خطی همه رخدادها (ثبت‌نام ← پرسشنامه ← تصویر ← AI ← ارزیابی ← نسخه ← پزشک ← فاکتور ← پرداخت ← ارسال ← تحویل ← پیگیری) با timestamp، بازیگر، شرح و وضعیت هر Event | Must | §41 | [I] |
| FR-PROF-05 | آپلود تصویر چهره در صورت نیاز توسط بیمار/کارشناس، همان خط لوله پردازش تصویر زبان | Should | §1 | [P] — زیرساخت آماده؛ مورد استفاده بالینی محدود |
| FR-PROF-06 | درخواست Export داده شخصی (Data Export) و درخواست حذف داده (Data Deletion Request) با گردش کار Admin و Audit | Should | §59 | [R] |

### 5.3 ماژول M03 — موتور مزاج‌شناسی (`FR-MIZAJ`)

| ID | شرح نیازمندی | اولویت | مرجع | وضعیت |
|---|---|---|---|---|
| FR-MIZAJ-01 | پرسشنامه قابل مدیریت توسط Admin: افزودن/حذف/ویرایش سؤال، تغییر گزینه‌ها و امتیازها، ترتیب سؤالات | Must | §7 | [I] |
| FR-MIZAJ-02 | Versioning پرسشنامه: هر تغییر ساختاری نسخه جدید می‌سازد؛ پاسخ‌ها به نسخه مربوطه متصل‌اند | Must | §7 | [I] |
| FR-MIZAJ-03 | تکمیل پرسشنامه توسط بیمار (Wizard مرحله‌ای) و محاسبه نتیجه مزاج با مدل امتیازی چهاربُعدی گرم/سرد/خشک/تر (ED-09) | Must | §7 | [I] |
| FR-MIZAJ-04 | ذخیره نتیجه در پرونده با جزئیات امتیاز ابعاد + نمایش نتیجه به کاربر | Must | §7 | [I] |
| FR-MIZAJ-05 | تاریخچه نتایج پرسشنامه هرگز حذف نمی‌شود؛ نتایج قدیمی قابل مشاهده‌اند | Must | §7 | [I] |
| FR-MIZAJ-06 | مدل امتیازدهی: خروجی یکی از `HOT_DRY / HOT_WET / COLD_DRY / COLD_WET / BALANCED` + امتیاز عددی هر بُعد | Must | §7 | [I] |

### 5.4 ماژول M04 — خط لوله تصویر پزشکی (`FR-IMG`)

| ID | شرح نیازمندی | اولویت | مرجع | وضعیت |
|---|---|---|---|---|
| FR-IMG-01 | آپلود تصویر زبان از موبایل و دسکتاپ (کامرا/فایل) | Must | §8 | [I] |
| FR-IMG-02 | زنجیره پردازش قبل از AI: Validate → MIME → Size → Corruption → حذف Metadata اضافی → Resize → Compress → Normalize → Crop (در صورت امکان) → Quality Assessment | Must | §8 | [I] |
| FR-IMG-03 | ارزیابی کیفیت مخصوص زبان: Blur Detection، Brightness، Exposure، Resolution، Orientation و Quality Score عددی | Must | §8 | [I] |
| FR-IMG-04 | اگر کیفیت نامناسب باشد، رد تصویر با پیام قابل‌اقدام فارسی (علت + راهنمای تصویربرداری مجدد)؛ کاربر باید بتواند مجدداً ارسال کند | Must | §8 | [I] |
| FR-IMG-05 | فشرده‌سازی هوشمند ۴ نسخه‌ای: Original (آرشیو امن) / Compressed (شبکه) / AI-Optimized (مدل) / Thumbnail (UI) | Must | §9 | [I] |
| FR-IMG-06 | متادیتای هر فایل: checksum، SHA-256 hash، metadata پردازش، version، owner، creation date | Must | §9 | [I] |
| FR-IMG-07 | امنیت Upload: extension validation، MIME validation، content sniffing، سقف حجم، image decode validation، نام ذخیره‌سازی Random (نام کاربر هرگز وارد filesystem نمی‌شود) | Must | §90 | [I] |
| FR-IMG-08 | دسترسی به تصاویر فقط با Authorization + Signed URL منقضی‌شونده؛ هر مشاهده پرونده پزشکی Audit می‌شود | Must | §44, §42 | [I] |
| FR-IMG-09 | افزودن تصویر پزشکی به پرونده توسط کارشناس (با همان خط لوله) | Should | §19 | [I] |
| FR-IMG-10 | تشخیص و ثبت Orientation برای جلوگیری از تحلیل غلط مدل | Should | §8 | [I] |

### 5.5 ماژول M05 — موتور AI و Explainability (`FR-AI`)

| ID | شرح نیازمندی | اولویت | مرجع | وضعیت |
|---|---|---|---|---|
| FR-AI-01 | معماری مستقل و قابل تعویض AI از طریق `AIModelProvider` Interface؛ بدون Hardcode مدل در هسته | Must | §10, §99 | [I] |
| FR-AI-02 | رجیستری مدل: ثبت TongueModelV1/V2/… با model_id، model_version، dataset_version، preprocessing_version، training_date، metrics، approval_status، deployment status | Must | §11, §61 | [I] |
| FR-AI-03 | هر Prediction شامل: prediction، confidence، threshold، explainability (features/اندیکاتورها)، model_version، timestamp | Must | §61 | [I] |
| FR-AI-04 | خروجی AI شامل شاخص‌های بالینی زبان: رنگ بدنه، پوشش (Coating)، رطوبت، بافت/Texture، قرمزی/کم‌خونی، و hint مزاجی | Must | §1 | [I] |
| FR-AI-05 | Confidence با ضریب کیفیت تصویر تعدیل (Damping) شود؛ تصویر بی‌کیفیت = خروجی کم‌اعتماد | Should | §8, §60 | [I] |
| FR-AI-06 | رابط بازبینی انسانی: کارشناس تصویر اصلی، تصویر پردازش‌شده، AI Prediction، Confidence و Disease Candidates را می‌بیند و Accept / Modify / Reject + Comment ثبت می‌کند | Must | §81 | [I] |
| FR-AI-07 | هر خروجی AI در UI برچسب «نیازمند بررسی انسانی» + Disclaimer دارد؛ در محیط غیر Production برچسب SIMULATED/DEMO | Must | §2, §100 | [I] |
| FR-AI-08 | Failure Handling: خطای AI نباید پرونده را متوقف کند؛ ثبت خطا، Retry و ادامه مسیر انسانی | Must | §56 | [I] |

### 5.6 ماژول M06 — Dataset و یادگیری (`FR-AI-D`)

| ID | شرح نیازمندی | اولویت | مرجع | وضعیت |
|---|---|---|---|---|
| FR-AI-D-01 | برای هر بررسی ذخیره: Input Image، AI Prediction، نتیجه Expert 1، نتیجه Expert 2، نتیجه Doctor، نتیجه نهایی، Outcome پیگیری | Must | §11 | [I] |
| FR-AI-D-02 | سیستم Dataset Management: تصویر، Label، Expert Label، Final Label، Confidence، Disagreement Flag، Review Status، Dataset Version | Must | §12 | [I] |
| FR-AI-D-03 | اختلاف Expert 1 و Expert 2 به‌صورت خودکار Disagreement Flag ثبت شود | Must | §12 | [P] — زیرساخت داده آماده؛ فلگ خودکار در فاز Data Pipeline |
| FR-AI-D-04 | Pipeline داده: Collected → Validation → De-identification → QC → Label Review → Dataset Version → Training → Validation → Evaluation → Approval → Deployment؛ آموزش مدل هرگز خودکار و بدون کنترل نیست | Must | §11 | [R] — فاز MLOps (Design ثبت شد) |
| FR-AI-D-05 | Outcome پیگیری: Improved / No Change / Worsened / Unknown — ثبت در پرونده و استفاده در Dataset آینده | Must | §82 | [P] |
| FR-AI-D-06 | Feedback هرگز خودکار «حقیقت» تلقی نمی‌شود؛ باید Reviewed/Validated/Labelled شود | Must | §83 | [I] — به‌صورت قانون (BR-MED-08) |
| FR-AI-D-07 | Dataset Split بیمار-محور (Patient-Level) برای جلوگیری از Leakage؛ Split تصویری صرف مجاز نیست | Must | §63 | [R] — فاز MLOps |
| FR-AI-D-08 | ارزیابی مدل فراتر از Accuracy: Precision، Recall، F1، Confusion Matrix، Sensitivity، Specificity، Calibration، Per-class، Dataset Imbalance | Must | §60 | [R] — فاز MLOps (رجیستری فیلدها موجود) |
| FR-AI-D-09 | استقرار مدل نیازمند Approval + ثبت metrics است | Must | §11 | [I] — رجیستری approval_status |

### 5.7 ماژول M07 — موتور Workflow پرونده (`FR-CASE`)

| ID | شرح نیازمندی | اولویت | مرجع | وضعیت |
|---|---|---|---|---|
| FR-CASE-01 | پرونده (Case) بعد از آپلود تصویر موفق ایجاد و در صف کارشناسان قرار می‌گیرد | Must | §1, §17 | [I] |
| FR-CASE-02 | Workflow به‌صورت State Machine تعریف شده — بدون Hardcode منطق در UI؛ ۲۱ وضعیت مطابق کاتالوگ BUSINESS-RULES §3 | Must | §17 | [I] |
| FR-CASE-03 | هر Transition با Actor، Timestamp، Previous Status، New Status، Reason، Comment در CaseEvent ثبت و در Timeline نمایش داده می‌شود | Must | §17, §41 | [I] |
| FR-CASE-04 | Guard هر Transition: فقط برای نقش/دسترسی مجاز؛ تخلف با خطای دسترسی + Audit رد می‌شود | Must | §17, §5 | [I] |
| FR-CASE-05 | انصراف/لغو پرونده فقط از وضعیت‌های مجاز ماتریس، با دلیل اجباری | Must | §17 | [I] |
| FR-CASE-06 | Timeline بیمار شامل همه رخدادها با status/actor/description/timestamp | Must | §41 | [I] |

### 5.8 ماژول M08 — صف کارشناسان و SLA (`FR-QUEUE`)

| ID | شرح نیازمندی | اولویت | مرجع | وضعیت |
|---|---|---|---|---|
| FR-QUEUE-01 | صف پرونده‌های در انتظار با: زمان انتظار، اولویت، وضعیت تخصیص | Must | §18 | [I] |
| FR-QUEUE-02 | Claim اتمیک پرونده (کارشناس هم‌زمان فقط یک Claim موفق) + امکان Release/Reassign با دلیل | Must | §18, §79 | [I] |
| FR-QUEUE-03 | SLA مرحله‌ای با رنگ‌بندی در داشبورد: Waiting / In Progress / Completed / Overdue | Must | §18 | [I] |
| FR-QUEUE-04 | Escalation برای موارد SLA-گذر (اطلاع رسانی به نقش بالادست) | Should | §18 | [P] — نمایش Overdue فعال؛ اعلان خودکار Escalation فاز بعد |
| FR-QUEUE-05 | اولویت صف (NORMAL/HIGH/URGENT) قابل تنظیم توسط Operator/Admin | Should | §18 | [P] — زیرساخت آماده، UI تنظیم اولویت فاز بعد |
| FR-QUEUE-06 | داشبورد سریع کارشناسی با چیدمان سه‌ستونی: Patient Summary / Images+AI / Diagnosis+Prescription+Actions + Timeline پایین | Must | §80 | [I] |

### 5.9 ماژول M09 — پنل کارشناس اول (`FR-EXP1`)

| ID | شرح نیازمندی | اولویت | مرجع | وضعیت |
|---|---|---|---|---|
| FR-EXP1-01 | مشاهده پرونده‌های بدون اقدام (Queue) و Claim | Must | §19 | [I] |
| FR-EXP1-02 | مشاهده تصاویر، شرح حال، نتایج مزاج، نتایج AI و تاریخچه قبلی | Must | §19 | [I] |
| FR-EXP1-03 | ویرایش شرح حال با Audit | Must | §19, §42 | [I] |
| FR-EXP1-04 | ثبت تشخیص/ارزیابی اولیه (بیماری‌ها + شرح) و ارسال نتیجه به کاربر برای تأیید | Must | §1, §19 | [I] |
| FR-EXP1-05 | تعیین نسخه: اقلام + Dosage + Frequency + Duration + Instructions + Warnings + تدابیر غذایی | Must | §16, §19 | [I] |
| FR-EXP1-06 | ویرایش نسخه → نسخه جدید (Versioning) بدون از بین رفتن تاریخچه | Must | §16 | [I] |
| FR-EXP1-07 | تعیین مدت ارجاع مجدد (Reassessment interval) | Must | §19 | [I] |
| FR-EXP1-08 | دستورالعمل مصرف به صورت متن؛ پیوست صوتی اختیاری | Should | §19 | [P] — متن کامل؛ صوت فاز بعد (ED-19) |
| FR-EXP1-09 | گزارش عملکرد روزانه/هفتگی/ماهانه از فعالیت کارشناس | Should | §19 | [I] |

### 5.10 ماژول M10 — پنل کارشناس دوم (`FR-EXP2`)

| ID | شرح نیازمندی | اولویت | مرجع | وضعیت |
|---|---|---|---|---|
| FR-EXP2-01 | مشاهده Queue و پرونده‌ها؛ Claim | Must | §21 | [I] |
| FR-EXP2-02 | بررسی نتیجه Expert 1 (شامل AI Card و بازخورد) | Must | §21 | [I] |
| FR-EXP2-03 | تعیین/ویرایش نسخه (Prescription 2) + دستور مصرف | Must | §21 | [I] |
| FR-EXP2-04 | تعیین اقلام موجود و اقلام ناقص (بر اساس انبار/موجودی) | Must | §1, §21 | [I] |
| FR-EXP2-05 | تعیین قیمت اقلام و برآورد هزینه درمان | Must | §21 | [I] |
| FR-EXP2-06 | ارسال نسخه برای Doctor + دریافت کامنت Doctor | Must | §21, §22 | [I] |
| FR-EXP2-07 | ایجاد Pre-Invoice (پیش‌فاکتور) پس از تأیید پزشک | Must | §21 | [I] |
| FR-EXP2-08 | Dynamic Filtering روی پرونده‌ها + مشاهده Notifications/Tickets/روند درمان | Should | §21 | [I] |

### 5.11 ماژول M11 — پنل پزشک (`FR-DR`)

| ID | شرح نیازمندی | اولویت | مرجع | وضعیت |
|---|---|---|---|---|
| FR-DR-01 | داشبورد درخواست‌های در انتظار تأیید | Must | §22 | [I] |
| FR-DR-02 | مشاهده کامل پرونده بیمار، نسخه، پیشنهاد کارشناسان و تحلیل AI | Must | §22 | [I] |
| FR-DR-03 | تصمیم: Approve / Reject / Request Revision + کامنت اجباری برای Reject و Revision | Must | §22 | [I] |
| FR-DR-04 | تعیین/تعدیل زمان Follow-up در تأیید نهایی | Must | §22, §33 | [I] |
| FR-DR-05 | همه عملیات Doctor با Audit Log | Must | §22 | [I] |
| FR-DR-06 | ارتباط از طریق Ticket در صورت نیاز | Should | §22 | [I] |

### 5.12 ماژول M12 — موتور نسخه (`FR-RX`)

| ID | شرح نیازمندی | اولویت | مرجع | وضعیت |
|---|---|---|---|---|
| FR-RX-01 | Prescription Entity مستقل با ساختار: Prescription + PrescriptionItem + ارتباط به Drug/Product | Must | §16 | [I] |
| FR-RX-02 | فیلدهای هر Item: Dosage، Frequency، Duration، Instructions، Warnings، Notes | Must | §16 | [I] |
| FR-RX-03 | DoctorComment و ExpertComment مستقل روی نسخه | Must | §16 | [I] |
| FR-RX-04 | Status + Version + CreatedBy + ApprovedBy + CreatedAt/UpdatedAt | Must | §16 | [I] |
| FR-RX-05 | هر تغییر نسخه Version جدید می‌سازد؛ تاریخچه نسخه‌ها همیشه قابل مشاهده | Must | §16 | [I] |
| FR-RX-06 | داروهای نیازمند تأیید متخصص بدون Workflow مربوطه قابل خرید/تجویز نهایی نیستند | Must | §66 | [I] |

### 5.13 ماژول M13 — فروشگاه و کاتالوگ (`FR-SHOP`)

| ID | شرح نیازمندی | اولویت | مرجع | وضعیت |
|---|---|---|---|---|
| FR-SHOP-01 | کاتالوگ با: نام fa/en، برند، SKU، دسته، تصویر، توضیحات، قیمت خرید/فروش، موجودی، وضعیت، OTC یا نیازمند تأیید، نحوه مصرف، محدودیت‌ها | Must | §14 | [I] |
| FR-SHOP-02 | جستجو با Normalization فارسی (ی/ي، ک/ك، اعداد فارسی/انگلیسی، نیم‌فاصله، توکن‌سازی) روی محصول/برند/بیماری/مزاج/دسته | Must | §25 | [I] |
| FR-SHOP-03 | فیلترها: دسته، برند، بیماری، قیمت، موجودی، OTC | Must | §24 | [I] |
| FR-SHOP-04 | سبد خرید (Cart) با ویرایش اقلام و محاسبه جمع | Must | §24 | [I] |
| FR-SHOP-05 | فقط محصولات OTC در فروش آزاد قابل افزودن به سبد هستند | Must | §66 | [I] |
| FR-SHOP-06 | تخفیف/کوپن: Discount روی سفارش/فاکتور ثبت و Audit می‌شود؛ سیستم Coupon مستقل (کد تخفیف عمومی) | Should | §24, §65 | [P] — فیلد discount و تخفیف درصدی گروهی موجود؛ Coupon مستقل [R] |
| FR-SHOP-07 | مرتب‌سازی بر اساس قیمت/نام/جدیدترین | Should | §24 | [I] |

### 5.14 ماژول M14 — سفارش، پیش‌فاکتور، فاکتور (`FR-ORD`)

| ID | شرح نیازمندی | اولویت | مرجع | وضعیت |
|---|---|---|---|---|
| FR-ORD-01 | سفارش داروهای نسخه‌ای از مسیر پرونده (Case-attached) پس از تأیید پزشک؛ اقلام از نسخه تأییدشده | Must | §1 | [I] |
| FR-ORD-02 | پیش‌فاکتور (Proforma) با اقلام، قیمت‌ها، هزینه ارسال و اعتبار؛ ارسال به کاربر برای تأیید | Must | §1 | [I] |
| FR-ORD-03 | تأیید/رد پیش‌فاکتور توسط کاربر (Gate قبل از پرداخت) | Must | §1 | [I] |
| FR-ORD-04 | Invoice نهایی پس از پرداخت موفق، غیرقابل ویرایش؛ اصلاح = صدور جدید مرتبط | Must | §47 | [I] |
| FR-ORD-05 | وضعیت‌های سفارش: CART → PENDING_CONFIRMATION → CONFIRMED → PAYMENT_PENDING → PAID → PREPARING → READY_TO_SHIP → SHIPPED → DELIVERED (+ CANCELLED / REFUNDED) | Must | §26 | [I] |
| FR-ORD-06 | سفارش فروشگاهی (OTC) مستقل از پرونده؛ جریان سبد ← Checkout ← تأیید ← پرداخت | Must | §24 | [I] |
| FR-ORD-07 | خرید هم‌زمان/تکراری کنترل شود (Idempotency در ساخت سفارش) | Must | §79 | [I] |

### 5.15 ماژول M15 — پرداخت (`FR-PAY`)

| ID | شرح نیازمندی | اولویت | مرجع | وضعیت |
|---|---|---|---|---|
| FR-PAY-01 | Abstraction پرداخت با PaymentProvider Interface (قابل تعویض Gateway) | Must | §27 | [I] |
| FR-PAY-02 | Integration زرین‌پال: Payment ID، Authority، Amount، Gateway، Status، Callback، Timestamp، Error، Reference Number | Must | §27 | [I] |
| FR-PAY-03 | Idempotency: پرداخت تکراری/Callback تکراری هرگز سفارش/وضعیت دوباره ثبت نمی‌کند | Must | §27, §56 | [I] |
| FR-PAY-04 | کارت‌به‌کارت: ارسال تصویر رسید + مبلغ + تاریخ + شماره پیگیری توسط کاربر | Must | §28 | [I] |
| FR-PAY-05 | تأیید کارت‌به‌کارت توسط Operator: Approve / Reject / Request More Information | Must | §28 | [I] |
| FR-PAY-06 | گزارش تراکنش‌های زرین‌پال: موفق/ناموفق/در انتظار/Refund + بررسی اختلاف (Reconciliation) | Must | §35 | [P] — گزارش تراکنش داخلی کامل؛ Reconciliation خودکار فاز مالی |
| FR-PAY-07 | Refund با دلیل اجباری + Audit؛ وضعیت REFUNDED روی Payment و Order | Should | §34, §35 | [P] |

### 5.16 ماژول M16 — ارسال و تحویل (`FR-SHIP`)

| ID | شرح نیازمندی | اولویت | مرجع | وضعیت |
|---|---|---|---|---|
| FR-SHIP-01 | روش‌های ارسال: Motorcycle / Car / Post | Must | §29 | [I] |
| FR-SHIP-02 | فیلدهای ارسال: driver_name، driver_phone، receiver_phone، vehicle_type، tracking_code، postal_code، shipment_cost، shipping_date، delivery_date، status | Must | §29 | [I] |
| FR-SHIP-03 | عکس/مدرک تحویل در صورت نیاز (پیوست Shipment) | Should | §29 | [P] |
| FR-SHIP-04 | پیگیری تحویل: نمایش وضعیت ارسال/تحویل به کاربر + Tracking Code | Must | §1, §29 | [I] |
| FR-SHIP-05 | ثبت تحویل → انتقال Case به DELIVERED و فعال‌سازی Follow-up | Must | §1 | [I] |

### 5.17 ماژول M17 — پیگیری درمان (`FR-FUP`)

| ID | شرح نیازمندی | اولویت | مرجع | وضعیت |
|---|---|---|---|---|
| FR-FUP-01 | تعریف تاریخ Follow-up برای هر بیمار (مثلاً ۴۰ روز بعد) — توسط Doctor/Expert 1 | Must | §33 | [I] |
| FR-FUP-02 | سیستم Reminder خودکار برای Follow-up رسیده | Must | §33 | [I] |
| FR-FUP-03 | داشبورد Operator پیگیری: Due Today / Overdue / Upcoming / Completed | Must | §33 | [I] |
| FR-FUP-04 | ثبت Outcome پیگیری (Improved / No Change / Worsened / Unknown) در پرونده و Dataset آینده | Must | §82 | [I] |
| FR-FUP-05 | Reminder خودکار برای پرونده‌های بدون اقدام (Operator) | Must | §20 | [P] — نمایش صف بی‌اقدام + دستی؛ Cron خودکار فاز Hardening |

### 5.18 ماژول M18 — تیکت و ارتباطات (`FR-TKT`)

| ID | شرح نیازمندی | اولویت | مرجع | وضعیت |
|---|---|---|---|---|
| FR-TKT-01 | تیکت با: User، Subject، Category، Priority، Status، AssignedTo، Messages، Attachments، Timestamp | Must | §30 | [I] |
| FR-TKT-02 | وضعیت‌های تیکت: OPEN / IN_PROGRESS / WAITING_USER / WAITING_EXPERT / RESOLVED / CLOSED | Must | §30 | [I] |
| FR-TKT-03 | SLA و Notification برای تیکت‌ها | Must | §30 | [P] — Notification فعال؛ SLA-رنگ‌بندی فاز بعد |
| FR-TKT-04 | یادداشت داخلی (Internal Note) برای کارکنان جدا از پیام کاربر | Should | §30 | [I] |

### 5.19 ماژول M18b — اعلان چندکاناله (`FR-NTF`)

| ID | شرح نیازمندی | اولویت | مرجع | وضعیت |
|---|---|---|---|---|
| FR-NTF-01 | Notification Engine با کانال‌های: In-app، SMS، Email (آماده Push) | Must | §31 | [P] — In-app + SMS Log فعال؛ Email فاز بعد |
| FR-NTF-02 | کاتالوگ رخدادهای اعلان مطابق §7 همین سند (۳۱+ رخداد) | Must | §31 | [I] |
| FR-NTF-03 | SMS Log کامل: recipient، template، content، provider، status، sent_at، delivery_status، error | Must | §32 | [I] |
| FR-NTF-04 | ارسال سنگین (SMS/Email/AI/پردازش تصویر) نباید Request را Block کند (Background Job) | Should | §46 | [P] — پردازش تصویر Async-در-جا؛ Queue مستقل Celery/BullMQ فاز معماری |
| FR-NTF-05 | مدیریت قالب‌های SMS/اعلان توسط Admin | Should | §64 | [P] — قالب‌ها Code-level؛ پنل ویرایش قالب فاز بعد |

### 5.20 ماژول M19 — مالی، گزارش و Referral (`FR-FIN`, `FR-REF`)

| ID | شرح نیازمندی | اولویت | مرجع | وضعیت |
|---|---|---|---|---|
| FR-FIN-01 | داشبورد مالی Admin: درآمد، فروش، هزینه، بدهکاران، بستانکاران، تسویه‌ها، پرداخت اپراتورها، حمل‌ونقل، سایر هزینه‌ها، پرداخت‌های موفق/ناموفق، Refund، سود تقریبی | Must | §34 | [I] |
| FR-FIN-02 | ثبت تراکنش‌های مالی (FinancialTransaction) برای هر جریان پولی | Must | §47 | [I] |
| FR-FIN-03 | ثبت هزینه‌ها (Expense) با دسته و شرح | Must | §34 | [I] |
| FR-FIN-04 | گزارش مالی بر اساس: تاریخ، کاربر، محصول، بازاریاب (Referral) | Must | §34 | [I] |
| FR-FIN-05 | گزارش‌های پویا با فیلترها: User، Doctor، Expert، Operator، Disease، Product، Brand، Date Range، Status، Payment، Order، Referral، City، Province، Case Type | Must | §38 | [I] |
| FR-FIN-06 | Export گزارش: Excel / CSV / PDF | Must | §38 | [P] — CSV داخلی فعال؛ Export کامل فاز Reporting |
| FR-FIN-07 | داشبورد Zarinpal: Transactions، Successful/Failed/Pending/Refund، Amount، Date، User، Order، Reference | Must | §35 | [I] |
| FR-REF-01 | تولید کد معرف در ثبت‌نام؛ ثبت رابطه Referrer ↔ Referred | Must | §36 | [I] |
| FR-REF-02 | پیگیری سفارش‌ها و درآمد ارجاع‌شده توسط هر معرف | Must | §36 | [I] |
| FR-REF-03 | محاسبه و پرداخت کمیسیون معرف طبق قواعد قابل تنظیم Admin | Should | §36 | [P] — رهگیری کامل؛ قواعد کمیسیون ED-10 |

### 5.21 ماژول M20 — پنل Admin و حاکمیت داده (`FR-ADM`, `FR-AUD`)

| ID | شرح نیازمندی | اولویت | مرجع | وضعیت |
|---|---|---|---|---|
| FR-ADM-01 | مدیریت کاربران: جستجو، مشاهده، فعال/غیرفعال، تغییر نقش، بازنشانی رمز — همه با Audit | Must | §64 | [I] |
| FR-ADM-02 | مدیریت Roles/Permissions و ماتریس RBAC قابل مشاهده/ویرایش | Must | §5, §64 | [I] |
| FR-ADM-03 | CRUD بیماری‌ها (نام fa/en، کد، دسته، توضیحات، علائم، داروهای مرتبط، فعال/غیرفعال) | Must | §13 | [I] |
| FR-ADM-04 | CRUD محصولات + مدیریت موجودی/وضعیت/تصویر | Must | §14, §64 | [I] |
| FR-ADM-05 | Import قیمت از Excel/CSV: Validate → شناسایی ستون‌ها → نمایش خطا → Preview → تأیید → Commit اتمیک؛ تاریخچه قیمت‌ها محفوظ | Must | §15 | [I] |
| FR-ADM-06 | تغییر گروهی قیمت‌ها ±X% (Bulk) با Audit و حفظ تاریخچه | Must | §15 | [I] |
| FR-ADM-07 | تاریخچه قیمت هر محصول با تاریخچه تغییر، بازیگر و مقادیر قدیم/جدید | Must | §15, §65 | [I] |
| FR-ADM-08 | ویرایشگر پرسشنامه با نسخه‌بندی | Must | §7 | [I] |
| FR-ADM-09 | مدیریت AI Models + Learning Dataset (رجیستری + آمار Dataset) | Must | §64 | [I] |
| FR-ADM-10 | SMS Log قابل مشاهده/فیلتر | Must | §32, §64 | [I] |
| FR-ADM-11 | داشبورد جامع: Users، Patients، Cases، Images، Orders، Sales، Revenue، Pending Cases، Experts، Doctors، Payments، Tickets، Follow-ups، Shipping، Operator Costs | Must | §37 | [I] |
| FR-ADM-12 | مدیریت قواعد Referral و تنظیمات Workflow و AI Settings | Should | §64 | [P] |
| FR-AUD-01 | Audit Log برای عملیات حساس: Login/Logout، View Medical File، Edit Patient/Diagnosis/Prescription، Approve/Reject، Payment، Price Change، Delete، Export، Download Image | Must | §42 | [I] |
| FR-AUD-02 | رکورد Audit: User، IP، Device، Timestamp، Action، Entity، Old Value، New Value | Must | §42 | [I] |
| FR-AUD-03 | اطلاعات حساس در Logهای معمولی ذخیره نمی‌شود | Must | §42, §88 | [I] |
| FR-AUD-04 | اکسپلورر Audit Log با فیلتر (کاربر/عمل/موجودیت/تاریخ) + پرچم حساسیت | Must | §42 | [I] |

---

## 6. نیازمندی‌های غیرعملکردی (Non-Functional Requirements)

| ID | دسته | نیازمندی | هدف قابل سنجش | اولویت | وضعیت |
|---|---|---|---|---|---|
| NFR-SEC-01 | امنیت | Password Hash مقاوم + JWT + Refresh Rotation + RBAC + Permission System | تست نفوذ داخلی Pass | Must | [I] |
| NFR-SEC-02 | امنیت | Signed URL منقضی‌شونده (پیش‌فرض ≤ ۱۰ دقیقه) برای همه فایل‌های پزشکی | هیچ URL عمومی دائمی | Must | [I] |
| NFR-SEC-03 | امنیت | Input Validation + SQL Injection Protection + XSS Protection + Secure Headers + HTTPS | اسکن SAST بدون خطای بحرانی | Must | [P] — فاز Hardening تکمیل |
| NFR-SEC-04 | امنیت | Secret Management: هیچ Secret در Git؛ `.env.example` مرجع | Secret Scan = 0 | Must | [I] |
| NFR-SEC-05 | امنیت | Rate Limiting روی Login/OTP/Upload/API/Payment/Ticket | حد مجاز هر Endpoint تعریف‌شده | Must | [P] |
| NFR-SEC-06 | امنیت | File Upload Security کامل (FR-IMG-07) + معماری Malware Scanning | Scan قبل از ذخیره در Production | Should | [P] |
| NFR-PERF-01 | کارایی | صفحه Queue کارشناسان «بسیار سریع» بارگذاری شود | P95 < 1.5s برای ۱۰۰ رکورد | Must | [I] |
| NFR-PERF-02 | کارایی | آپلود + پردازش تصویر کاربر را مسدود نکند | تجربه کاربر بدون Freeze | Must | [I] |
| NFR-SCAL-01 | مقیاس‌پذیری | Horizontal Scaling مستقل Frontend/Backend/Worker | Stateless Services + Queue | Should | [R] — فاز معماری |
| NFR-SCAL-02 | مقیاس‌پذیری | آمادگی Multi-Tenant (Schema آماده orgId) | بدون Refactor اساسی | Could | [P] |
| NFR-I18N-01 | دوزبانگی | UI کامل fa (RTL+شمسی) / en (LTR+میلادی)؛ Language Switcher بدون Reload صفحات | ۰ متن Hardcode | Must | [I] |
| NFR-I18N-02 | تقویم | ذخیره‌سازی UTC timezone-aware؛ نمایش Jalali در فارسی؛ هیچ تخریب تاریخی در تبدیل | تست تبدیل رفت/برگشت | Must | [I] |
| NFR-A11Y-01 | دسترسی‌پذیری | Keyboard Navigation، فونت خوانا، کنتراست مناسب (AA)، ARIA، Responsive | چک‌لیست QA درست باشد | Should | [P] |
| NFR-REL-01 | قابلیت اطمینان | Backup: روزانه DB + هفتگی Full + Backup تصاویر + Retention Policy + Restore Test + مستند DR | بازیابی تست‌شده | Must | [R] — فاز استقرار |
| NFR-REL-02 | قابلیت اطمینان | Idempotency + Locking + Retry + Dead Letter برای جریان‌های بحرانی | تست‌های همزمانی سبز | Must | [I] |
| NFR-OBS-01 | مشاهده‌پذیری | Health/Readiness/Liveness Endpoints | `/health` پاسخ بدهد | Must | [P] |
| NFR-OBS-02 | مشاهده‌پذیری | Structured JSON Logging با سطوح + Request ID قابل Trace | هر خط Log دارای request_id | Must | [P] |
| NFR-OBS-03 | مشاهده‌پذیری | Metrics: CPU/Memory/Disk/DB/Queue/Worker/API latency/Error rate/AI latency/Storage/Payment | داشبورد Monitoring | Should | [R] |
| NFR-CMP-01 | انطباق | Privacy by Design: Consent، Data Export، Data Deletion Request، Data Access Log | قابلیت‌ها فعال | Must | [P] |
| NFR-CMP-02 | انطباق | برچسب DEMO در نتایج AI محیط غیر Production | بازرسی UI | Must | [I] |
| NFR-MAINT-01 | نگهداشت‌پذیری | کد Typed/Modular/Testable؛ ممنوعیت God Object/Huge File/Duplicate Logic/Hardcoded Credentials/Magic Numbers | Lint + Review | Must | [I] |
| NFR-MAINT-02 | نگهداشت‌پذیری | API Versioned (`/api/v1`)؛ Breaking Change فقط با Version جدید | قرارداد API | Must | [I] |
| NFR-API-01 | API | قالب خطای استاندارد: code / message / details / request_id / timestamp | همه Endpointها | Must | [I] |
| NFR-DEV-01 | توسعه | اجرای یک‌فرمان (Docker Compose / dev.sh) + VSCode Config + Seed بدون داده واقعی | Developer جدید Clone→Run | Must | [I] |
| NFR-CICD-01 | CI/CD | Pipeline: Lint → TypeCheck → Unit → Integration → Security Scan → Build → Docker → Deploy → Health → Rollback | Fail = Stop Deploy | Must | [R] — فاز CI/CD |

---

## 7. کاتالوگ رخدادها و اعلان‌ها (Notification Catalog)

۳۱ رخداد اعلان داخلی محصول (پیاده‌سازی‌شده) + رخدادهای تکمیلی برنامه‌ریزی‌شده. کانال‌ها: **I** = In-app، **S** = SMS (ثبت در SMSLog)، **E** = Email (فاز بعد).

| کد رخداد | عنوان فارسی | دریافت‌کننده | کانال | Trigger | وضعیت |
|---|---|---|---|---|---|
| REGISTERED | خوش‌آمد + کد معرف | Patient | I,S | ثبت‌نام موفق | [I] |
| PROFILE_COMPLETED | پروفایل تکمیل شد | Patient | I,S | ذخیره مشخصات | [I] |
| QUESTIONNAIRE_DONE | نتیجه مزاج‌شناسی | Patient | I,S | اتمام پرسشنامه | [I] |
| IMAGE_RECEIVED | تصویر دریافت/پردازش شد | Patient | I,S | آپلود موفق + پذیرش کیفیت | [I] |
| IMAGE_REJECTED | رد کیفیت تصویر | Patient | I | Quality Gate رد — پیام علت + راهنما | [I] |
| CASE_IN_QUEUE | پرونده در صف کارشناسان | Patient | I,S | ایجاد Case | [I] |
| ASSIGNED_EXPERT | تخصیص به کارشناس | Expert 1 | I,S | Claim / تخصیص | [I] |
| AI_ANALYZED | تحلیل AI آماده بازبینی | Expert 1 | I | اتمام استنتاج | [I] |
| ASSESSMENT_READY | نتیجه ارزیابی اولیه | Patient | I,S | Submit Assessment | [I] |
| USER_APPROVAL_NEEDED | در انتظار تأیید بیمار | Patient | I,S | ارسال نتیجه به کاربر | [I] |
| TREATMENT_APPROVED | تأیید ادامه درمان | Expert 1 | I | تأیید کاربر | [I] |
| PRESCRIPTION_CREATED | نسخه ثبت شد | Patient/Expert2 | I,S | ثبت/ویرایش نسخه | [I] |
| PRESCRIPTION_REVISED | نسخه اصلاح شد (نسخه جدید) | نقش‌های مرتبط | I | Version جدید | [I] |
| SENT_TO_DOCTOR | ارسال به پزشک | Doctor | I,S | Expert 2 ارسال کرد | [I] |
| DOCTOR_APPROVED | تأیید پزشک | Patient + Experts | I,S | Approve | [I] |
| DOCTOR_COMMENTED | اظهارنظر پزشک | نقش‌های مرتبط | I | کامنت پزشک | [I] |
| PROFORMA_CREATED | پیش‌فاکتور صادر شد | Patient | I,S | صدور Proforma | [I] |
| PROFORMA_CONFIRMATION_NEEDED | در انتظار تأیید پیش‌فاکتور | Patient | I,S | ارسال Proforma | [I] |
| PAYMENT_PENDING | در انتظار پرداخت | Patient | I,S | تأیید Proforma | [I] |
| PAYMENT_CONFIRMED | پرداخت تأیید شد | Patient + Operator | I,S | تأیید پرداخت (هر دو کانال) | [I] |
| PAYMENT_REJECTED | پرداخت رد شد | Patient | I,S | رد رسید/تراکنش | [I] |
| ORDER_PREPARING | آماده‌سازی سفارش | Patient | I,S | پس از پرداخت | [I] |
| ORDER_SHIPPED | سفارش ارسال شد | Patient | I,S | ثبت ارسال | [I] |
| ORDER_DELIVERED | سفارش تحویل شد | Patient | I,S | ثبت تحویل | [I] |
| FOLLOWUP_DUE | زمان پیگیری درمان | Patient + Operator | I,S | سررسید Follow-up | [I] |
| REFERRED_AGAIN | ارجاع مجدد ثبت شد | Patient | I | شروع چرخه جدید | [I] |
| CASE_CLOSED | پرونده بسته شد | Patient | I | بستن/لغو | [I] |
| TICKET_UPDATED | به‌روزرسانی تیکت | شرکت‌کننده تیکت | I | پیام/تغییر وضعیت | [I] |
| RECEIPT_UPLOADED | رسید کارت‌به‌کارت | Operator | I | آپلود رسید | [I] |
| PRICE_CHANGED | تغییر قیمت محصولات | نقش‌های عملیاتی | I | Import/Bulk | [I] |
| NEW_ORDER | سفارش جدید ثبت شد | Operator | I | Checkout فروشگاهی/نسخه‌ای | [I] |
| SLA_ESCALATION | تجاوز SLA | نقش بالادست + Admin | I | زمان مرحله > حد | [R] |
| NO_ACTION_REMINDER | یادآور پرونده بدون اقدام | Operator | I | زمان بدون اقدام > حد | [R] |
| DATA_REQUEST_STATUS | وضعیت درخواست داده (Export/Delete) | Patient | I | تغییر وضعیت درخواست | [R] |

> رخدادهای [R] در فاز Notification Hardening فعال می‌شوند؛ زیرساخت Engine و ثبت Log از امروز آماده است (ED-17).

---

## 8. کاتالوگ تأییدها (Approval Catalog)

هر «Gate تأیید» محصول با رد رفتار مشخص. جزئیات وضعیت‌ها در `BUSINESS-RULES.md §3`.

| # | Gate | تأییدکننده | وضعیت قبل | در صورت تأیید | در صورت رد | الزامات |
|---|---|---|---|---|---|---|
| G1 | تأیید ادامه درمان (Initial Assessment) | Patient | WAITING_FOR_USER_APPROVAL | WAITING_FOR_EXPERT_1_PRESCRIPTION | CLOSED (با دلیل) | نمایش نتیجه + توضیح کارشناس قبل از تصمیم |
| G2 | بازبینی فنی نسخه | Expert 2 | WAITING_FOR_EXPERT_2 | WAITING_FOR_DOCTOR | بازگشت به Expert 1 (REVISION) | کامنت بازبینی |
| G3 | تأیید نهایی نسخه | Doctor | WAITING_FOR_DOCTOR | PRESCRIPTION_APPROVED | CLOSED یا بازگشت به Expert 2 | کامنت اجباری در Reject/Revision |
| G4 | تأیید پیش‌فاکتور | Patient | PROFORMA_CREATED | WAITING_FOR_PAYMENT | CANCELLED | نمایش اقلام + قیمت‌ها + هزینه ارسال |
| G5 | تأیید پرداخت Gateway | System (زرین‌پال) + Idempotency | WAITING_FOR_PAYMENT | PAYMENT_CONFIRMED | FAILED (Retry مجاز) | Callback Verify |
| G6 | تأیید پرداخت کارت‌به‌کارت | Operator | AWAITING_VERIFY | PAID | REJECTED یا Request Info | مشاهده رسید + ثبت مبلغ/شماره پیگیری |
| G7 | تأیید استقرار مدل AI | Admin (AI Governance) | رجیستری PENDING | DEPLOYED | رد با دلیل | ثبت metrics (ED-08/FR-AI-D-09) |
| G8 | تأیید Label برای Dataset | Admin/QC | REVIEW_PENDING | APPROVED به Dataset Version | رد | De-identification قبلی |
| G9 | تأیید درخواست Export/Delete داده | Admin | REQUESTED | اجرا + Audit | رد با دلیل حقوقی | ثبت در Data Access Log |
| G10 | تأیید تغییر قیمت (Import/Bulk) | Admin (پیش‌فرض) + Preview | — | Commit اتمیک + تاریخچه | Cancel بدون تغییر | نمایش Old→New |

---

## 9. مدل چرخه عمر بیمار (Patient Lifecycle)

مدل کامل ۱۸ مرحله‌ای چرخه بیمار (مطابق فرمان PHASE 01). نگاشت وضعیت‌های Case به هر مرحله در `USE-CASES.md §2` به‌تفصیل مدل شده است.

```text
Registration ─→ Questionnaire ─→ Image Upload ─→ AI Analysis ─→ Expert 1 Claim
     │                                            (Quality Gate)        │
     ▼                                                                  ▼
  Referral Code                                              Initial Assessment
                                                                    │
                                                    ┌──── G1: تأیید کاربر ────┐
                                                    ▼ (تأیید)                ▼ (رد)
                                              Prescription (E1)         CLOSED
                                                    │
                                                    ▼
                                        Expert 2 Review + Pricing
                                          + اقلام موجود/ناقص
                                                    │
                                                    ▼
                                              Doctor Decision
                                       (Approve/Reject/Revision)
                                                    │ (Approve)
                                                    ▼
                                              Order Preparation
                                                    │
                                                    ▼
                                        Proforma (پیش‌فاکتور) ── G4
                                                    │ (تأیید)
                                                    ▼
                              Invoice ─→ Payment (G5/G6) ─→ Shipment
                                                                │
                                                                ▼
                                      Delivery ─→ Follow-up ─→ Outcome
                                                                │
                                              ┌─────────────────┴──────────────┐
                                              ▼ Reassessment (ارجاع مجدد)      ▼ اتمام درمان
                                        REFERRED_AGAIN (چرخه جدید)        CLOSED
```

**قواعد حاکم بر چرخه** (ارجاع به BUSINESS-RULES):

- هر فلش فقط از طریق Transition مجاز State Machine (BR-WF-01).
- هر Gate تأیید (G1–G6) یک توقف اجباری است؛ عبور خودکار ممنوع.
- چرخه Reassessment پرونده جدید با Lineage به پرونده قبلی می‌سازد (ED-13) و تاریخچه درمان در دسترس ارزیابی جدید است.

---

## 10. شاخص‌های موفقیت محصول (KPI)

| دسته | شاخص | هدف v1 | روش اندازه‌گیری |
|---|---|---|---|
| بالینی | نرخ پاسخ‌دهی صف کارشناسان در SLA | ≥ ۹۰٪ موارد < ۲۴h | داشبورد Queue/SLA |
| بالینی | نسبت بازبینی انسانی روی خروجی AI | ۱۰۰٪ (هیچ نتیجه بدون بازبینی) | Audit Log |
| محصول | نرخ تکمیل قیف ثبت‌نام ← اولین تحویل | ≥ ۴۰٪ | Funnel گزارش |
| محصول | زمان Register → Delivered (میانه) | ≤ ۷ روز | Timeline |
| مالی | نرخ پرداخت موفق پس از تأیید Proforma | ≥ ۸۵٪ | گزارش پرداخت |
| مالی | نرخ Refund/رد پرداخت | ≤ ۵٪ | گزارش پرداخت |
| پشتیبانی | زمان میانگین پاسخ تیکت | ≤ ۸ ساعت کاری | SLA تیکت |
| داده | حجم رکوردهای Dataset قابل Label | رشد ماهانه (Baseline در گزارش Admin) | داشبورد Dataset |
| کیفیت | خطاهای بحرانی Production | ۰ | Monitoring |
| کاربری | پوشش دوزبانه UI | ۱۰۰٪ رشته‌ها i18n | تست خودکار |

---

## 11. ریسک‌های محصول و کاهش آن‌ها

| # | ریسک | احتمال | اثر | راهبرد کاهش |
|---|---|---|---|---|
| R1 | برداشت اشتباه خروجی AI به‌عنوان diagnoses قطعی | متوسط | بالا | BR-MED-01: نمایش همیشه با Confidence + Disclaimer + Gate انسانی؛ برچسب SIMULATED در غیر Production |
| R2 | عدم انطباق حقوقی با مقررات داده سلامت ایران | متوسط | بحرانی | Production Checklist حقوقی قبل از Go-Live (C1)؛ نرم‌افزار تا تأیید فقط DEMO |
| R3 | کیفیت پایین تصاویر کاربران موبایل → تحلیل بی‌ارزش | بالا | متوسط | Quality Gate + پیام قابل‌اقدام + Retry (FR-IMG-04) + Confidence Damping (FR-AI-05) |
| R4 | توقف چرخه در انتظار کاربر (تأیید/پرداخت) | بالا | متوسط | ED-08: SLA انتظار + Reminder خودکار + Auto-close با مسیر بازگشتی |
| R5 | اختلاف نظر کارشناسان بدون سازوکار داوری | متوسط | بالا | G2 + Disagreement Flag + داوری اجباری Doctor (ED-03) |
| R6 | خطای پرداخت تکراری/ساندویچ Callback | متوسط | بالا | Idempotency کامل (BR-FIN-01) + تست همزمانی |
| R7 | Bias/Leakage در داده و مدل | متوسط | بالا | Dataset Split بیمار-محور + ارزیابی چندمتری + Approval پیش از Deploy |
| R8 | رشد صف و افت SLA | متوسط | متوسط | Escalation + Reassign + گزارش عملکرد کارشناسان |
| R9 | نفوذ/افشای تصاویر پزشکی | کم | بحرانی | Signed URL + RBAC + Audit مشاهده + Scan فایل |
| R10 | از دست رفتن تاریخچه (قیمت/نسخه/پرسشنامه) | کم | بالا | Immutability تاریخچه (P4) + Backup/Restore تست‌شده |

---

## 12. نقشه انتشار (Release Roadmap)

نگاشت ۱۸ Milestone تعریف‌شده در Master Prompt §98 به فازهای برنامه:

| فاز | شامل Milestoneها | خروجی کلیدی |
|---|---|---|
| **Phase 00** (انجام‌شده) | M1 (بخش Infrastructure)، M2–M14 (پیاده‌سازی Functional v1)، برندینگ | اپلیکیشن یکپارچه v1 + Design System BabaHakim |
| **Phase 01** (انجام‌شده) | مستندسازی نیازمندی | PRD، User Stories، Business Rules، Use Cases، Acceptance Criteria، RTM |
| **Phase 02** (انجام‌شده — توالی واقعی جلوتر از نقشه) | M17 (بخش Workflow) + مقدمات M16 | موتور گردش کار اعلانی + ۸ ماشین وضعیت + ۵۱ تست واحد |
| **Phase 03** (همین فاز — M1 کامل) | M1 (Architecture) | ARCHITECTURE.md + ARCHITECTURE-DIAGRAM.md + ADR×12 + قواعد وابستگی و ضد-چرخه |
| **Phase 04** | M15 (Security + Audit) + فعال‌سازی Enforcement معماری (ADR-0010) | Hardening امنیتی، Rate Limiting کامل، Malware Scan، تست معماری CI |
| **Phase 05** | M16 (Testing) + مهاجرت SQLite→PostgreSQL (ADR-0004) | پوشش Unit/Integration/E2E + تست‌های Workflow ۱۸ مرحله‌ای |
| **Phase 06** | M17 (Deployment) + M18 (Hardening) | Docker Production، Nginx/SSL، CI/CD، Monitoring (ADR-0012)، Backup/DR |
| **Phase 07+** | توسعه محصول | Coupon مستقل، Email/Push، OTP، Export داده، MLOps واقعی، PWA |

> یادداشت توالی (فاز 03): شماره فازها در اجرای واقعی جلوتر از پیش‌بینی اولیه این نقشه حرکت کرده است (فاز ۰۲ = Workflow به‌جای M1). این جدول در پایان هر فاز با وضعیت واقعی هم‌تراز می‌شود؛ شماره Milestoneها (M1..M18) مرجع ثابت باقی می‌مانند.

---

## 13. واژه‌نامه دوزبانه

| اصطلاح | انگلیسی | شرح |
|---|---|---|
| مزاج | Temperament (Mizaj) | ساختار چهاربُعدی طب ایرانی: گرم/سرد × خشک/تر |
| پرونده | Case (Medical Case) | واحد گردش کار بالینی بیمار از صف تا بستن |
| نسخه | Prescription | تجویز اقلام دارویی با نسخه‌بندی |
| پیش‌فاکتور | Proforma (Pre-Invoice) | فاکتور پیش از پرداخت برای تأیید کاربر |
| فاکتور | Invoice | سند مالی نهایی پس از پرداخت |
| صف کارشناسان | Expert Queue | صف پرونده‌های در انتظار با SLA |
| داوری انسانی | Human Review | تأیید/اصلاح/رد خروجی AI توسط کارشناس/پزشک |
| پشتیبان تصمیم بالینی | CDS (Clinical Decision Support) | نقش AI به‌عنوان پیشنهاددهنده، نه تصمیم‌گیرنده |
| ارجاع مجدد | Re-refer / Reassessment | چرخه درمان جدید بر پایه پیگیری |
| کد معرف | Referral Code | کد بازاریابی ارجاع بیمار جدید |
| درگاه پرداخت | Payment Gateway (Zarinpal) | پرداخت آنلاین |
| کارت‌به‌کارت | Card-to-Card | پرداخت دستی با تأیید اپراتور |
| تقویم شمسی | Jalali Calendar | نمایش تاریخ فارسی |
| Signed URL | آدرس امضادار موقت | دسترسی موقتی امن به فایل پزشکی |
| Soft Delete | حذف نرم | غیرفعال‌سازی با `deleted_at` به‌جای حذف فیزیکی |
| Idempotency | توان‌ایی تکرارپذیر | اجرای دوباره عملیات، نتیجه تکراری ایجاد نمی‌کند |

---

## 14. ارجاعات و اسناد مرتبط

| سند | نقش | وضعیت |
|---|---|---|
| `docs/USER-STORIES.md` | استوری‌های کاربر با شناسه US | همین فاز |
| `docs/BUSINESS-RULES.md` | قوانین کسب‌وکار (BR) + Engineering Decisions (ED) + کاتالوگ وضعیت‌ها | همین فاز |
| `docs/USE-CASES.md` | سناریوهای استفاده، جریان‌های استثنا و Edge Caseها | همین فاز |
| `docs/ACCEPTANCE-CRITERIA.md` | معیارهای پذیرش Given/When/Then | همین فاز |
| `docs/REQUIREMENTS-TRACEABILITY-MATRIX.md` | ماتریس ردیابی Spec → FR → US → UC → BR → AC → Status | همین فاز |
| `docs/WORKFLOW.md` | موتور گردش کار + مشخصات ۸ ماشین وضعیت | فاز ۰۲ |
| `docs/BRANDING.md` | سیستم طراحی BabaHakim | فاز قبل |
| Master Prompt | منبع نیازمندی (۱۰۴ بخش) | `upload/` |

**پایان PRD — انشعاب فنی عمدی ندارد؛ این سند مبنای TRACING فازهای بعدی است.**
