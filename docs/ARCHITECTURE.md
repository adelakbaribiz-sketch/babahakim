# BabaHakim — سند معماری سیستم (System Architecture)

| فیلد | مقدار |
|---|---|
| نام پروژه | BabaHakim (باباحکیم) |
| شناسه فنی | `babahakim` |
| نسخه سند | 1.0.0 |
| تاریخ | 1405/06/14 (2026-09-04) |
| فاز | PHASE 03 — System Architecture |
| مالک سند | Senior Software Architect & Lead Engineer |
| وضعیت | Approved — مبنای فازهای پیاده‌سازی بعدی |
| اسناد مرتبط | `PRD.md` (نیازمندی‌ها) · `WORKFLOW.md` (موتور گردش کار) · `ARCHITECTURE-DIAGRAM.md` (نمودارها) · `ADR/` (تصمیمات معماری) |
| تصمیمات ثبت‌شده | ED-35 .. ED-46 (معادل ADR-0001 .. ADR-0012، در `BUSINESS-RULES.md` فهرست شده‌اند) |

> **قاعده حاکم بر این سند:** معماری BabaHakim یک **Modular Monolith** با مرزهای صریح Bounded Context است که از روز اول برای **Extraction تدریجی به Microservice** در آینده طراحی شده است. هر تصمیم معماری در این سند دارای یک ADR با شماره یکتا در `/docs/ADR/` است و هر قاعده وابستگی، **قابل Test و قابل Enforce در CI** است (قاعده شماره ۱ و ۲ منشور پروژه: هیچ قاعده‌ای صرفاً «روی کاغذ» نمی‌ماند).

---

## فهرست

1. [درایورهای معماری و ویژگی‌های کیفی](#1-درایورهای-معماری-و-ویژگی‌های-کیفی)
2. [تصمیم بنیادین: Modular Monolith در برابر Microservices](#2-تصمیم-بنیادین-modular-monolith-در-برابر-microservices)
3. [نمای کلان سیستم و اجزای معماری](#3-نمای-کلان-سیستم-و-اجزای-معماری)
4. [Bounded Contextها](#4-bounded-contextها)
5. [قواعد وابستگی (Dependency Rules)](#5-قواعد-وابستگی-dependency-rules)
6. [جلوگیری از Circular Dependency](#6-جلوگیری-از-circular-dependency)
7. [کاتالوگ Domain Events و ارتباط بین Contextها](#7-کاتالوگ-domain-events-و-ارتباط-بین-contextها)
8. [معماری داده](#8-معماری-داده)
9. [معماری امنیت](#9-معماری-امنیت)
10. [استقرار (Deployment)](#10-استقرار-deployment)
11. [Observability](#11-observability)
12. [مسیر Extraction به Microservices](#12-مسیر-extraction-به-microservices)
13. [نگاشت وضعیت فعلی کد به معماری هدف](#13-نگاشت-وضعیت-فعلی-کد-به-معماری-هدف)
14. [ریسک‌های معماری و کاهش آن‌ها](#14-ریسک‌های-معماری-و-کاهش-آن‌ها)
15. [ارجاعات](#15-ارجاعات)

---

## 1. درایورهای معماری و ویژگی‌های کیفی

معماری BabaHakim توسط نیازمندی‌های غیرعملکردی PRD (§6، NFR-01..NFR-25) هدایت می‌شود، نه توسط ترجیح فنی. جدول زیر نشان می‌دهد هر درایور کیفی چه پاسخ معماری‌ای گرفته است:

| درایور کیفی | ارجاع PRD | پاسخ معماری |
|---|---|---|
| ایمنی داده پزشکی (PHI) و Privacy by Design | P5, NFR-SEC | Object Storage خصوصی + Signed URL منقضی‌شونده، RBAC در لایه Application، Audit فراگیر، تفکیک Contextهای بالینی (§9) |
| یکپارچگی تراکنشی گردش بالینی-مالی | BR-FIN, ED-33 | Monolith واحد با Transaction محلی + الگوی Single-Writer Cascade (هیچ Saga توزیع‌شده در v1 — ریسک ناسازگاری بالینی حذف می‌شود) |
| Audit-First | P3, BR-AUD | AuditLog به‌عنوان Event Stream فرا-Context در Kernel، نوشتن اتمیک با هر Transition (ED-32) |
| Explainability و بازبینی انسانی AI | P1, P2, FR-AI | جداسازی AI در Context و Service مستقل؛ خروجی AI صرفاً «پیشنهاد» است و هیچ شاخه پردازشی به آن وابستگی قطعی ندارد (ED-29) |
| دوزبانه واقعی (fa/en، RTL/LTR) | P6 | i18n در Shared Kernel؛ هیچ Contextای متن Hardcode ندارد |
| توسعه‌پذیری و رشد آینده | P8, Roadmap §12 | مرزهای Module + Port/Adapter + Domain Events ⇒ آمادگی Extraction (ADR-0001) |
| Testability | Rule 2 منشور | منطق دامنه در Moduleها (خالص و بدون وابستگی به HTTP)؛ Routeها نازک؛ تست واحد مثل Phase 02 (۵۱ تست) |
| Operability با تیم کوچک | قید تیم | یک Deployable واحد (web) + یک Worker؛ زیرساخت کم‌قطعه (Postgres + Redis + S3 + AI Service) |

**قیدهای صریح (Constraints):**
- **C1:** تیم توسعه کوچک (۱-۳ نفر) است؛ ظرفیت Ops برای ده‌ها Microservice وجود ندارد.
- **C2:** ترتیب پرداخت→فاکتور→سفارش باید در یک Transaction واقعی اتمیک بماند (ED-33).
- **C3:** تحلیل AI باید بتواند مستقل از اپلیکیشن اصلی Scale شود (GPU) بدون Deploy مجدد کل سیستم.
- **C4:** استقرار باید هم در VSCode (dev) و هم Docker (prod) کار کند (قاعده ۱۰ منشور).
- **C5:** هیچ داده پزشکی واقعی در محیط Development (قاعده ۷ منشور).

---

## 2. تصمیم بنیادین: Modular Monolith در برابر Microservices

### 2.1 معیارهای ارزیابی

| # | معیار | Modular Monolith | Microservices | برنده |
|---|---|---|---|---|
| 1 | اندازه تیم و Conway's Law | یک تیم واحد روی یک Codebase مشترک؛ مالکیت ساده | نیازمند مالکیت تیم به ازای Service؛ با تیم ۱-۳ نفره عملاً ناممکن | **MM** |
| 2 | یکپارچگی تراکنشی (Payment Cascade: Payment→Invoice→Order→Case) | یک Transaction دیتابیسی ACID محلی (الگوی فعلی `paymentPaidCascade`) | Saga/Two-Phase با Compensation؛ پیچیدگی و ریسک بالا برای داده مالی-بالینی | **MM** |
| 3 | Latency داخلی | فراخوانی در-پروسه (µs) | Network Hop به ازای هر فراخوانی بین-Service (ms) | **MM** |
| 4 | هزینه زیرساخت و Ops | یک اپ + Postgres + Redis + S3 + AI | ۱۰+ Deployable، Service Mesh/API Gateway، Distributed Tracing اجباری | **MM** |
| 5 | مقیاس‌پذیری AI (قید C3) | با جدا کردن AI Service و Queue حل می‌شود — نیازی به شکستن کل سیستم نیست | بله اما با هزینه‌ای چند برابر | **MM** (با راهکار میانه) |
| 6 | سرعت Iteration محصول (فاز فعلی: افزودن قابلیت‌های فاز 07+) | Refactor درون یک Codebase، یک Deploy | Cross-Service Contract Change + همگام‌سازی Release | **MM** |
| 7 | استقرار مستقل واحدها | فقط web و worker و ai (کافی برای قید C3) | هر Context یک Deployable | MS (ولی نیاز فعلی ندارد) |
| 8 | Resilience و Fault Isolation | خرابی یک واحد می‌تواند کل Process را تحت تأثیر قرار دهد (کاهش با Worker جدا و Queue) | Fault Domainهای کوچک | MS (نیاز فعلی متوسط) |
| 9 | Observability | لاگ/ متریک متمرکز؛ Tracing ساده | Tracing توزیع‌شده اجباری، هزینه بالا | **MM** |
| 10 | بلوغ CI/CD و Testing فعلی | با lint + unit + smoke فعلی سازگار | نیازمند Contract Testing و Pipeline به ازای Service | **MM** |

**نتیجه: ۸ از ۱۰ معیار به نفع Modular Monolith است.** تنها دو مزیت واقعی Microservices (استقرار مستقل و Fault Isolation کامل) در وضعیت فعلی BabaHakim «نیاز فعال» نیستند و مزیت مقیاس AI با جداسازی AI Service و Worker پاسخ داده می‌شود.

### 2.2 تصمیم (ADR-0001 / ED-35)

**BabaHakim v1 به‌صورت Modular Monolith ساخته می‌شود؛ Microservices در افق زمانی معیارمحور (نه تقویم‌محور) باقی می‌ماند.** سیستم «برای شکستن آماده» طراحی می‌شود با پنج قاعده Extraction-Readiness:

| # | قاعده آمادگی Extraction | پیامد عملی |
|---|---|---|
| ER1 | **هر Bounded Context فقط از طریق Public API خودش import می‌شود** | استخراج یک Context = جایگزینی import با فراخوانی شبکه؛ هیچ فراخوانی داخلی (domain/infra) وجود ندارد |
| ER2 | **هر Context Schema داده خودش را مالک می‌شود** | استخراج = جداسازی Schema دیتابیس بدون مذاکره مالکیت جدول |
| ER3 | **ارتباط Cross-Context یا Sync Facade است یا Async Event** | مسیرهای ارتباطی از قبل «شبکه‌پسند» هستند |
| ER4 | **وابستگی‌های خارجی فقط از طریق Port/Adapter** (AI, Payment, Shipping, Storage, SMS) | تغییر Provider یا انتقال به Service خارجی، بدون تغییر منطق دامنه |
| ER5 | **قواعد وابستگی با Tool در CI Enforce می‌شوند** | هیچ وابستگی «غیرقانونی»ای نمی‌تواند به‌صورت خاموش رشد کند و Extraction آینده را مسدود کند |

### 2.3 معیارهای بازنگری (چه زمانی Microservices؟)

Microservices تنها زمانی بازنگری می‌شود که **حداقل سه** شرط زیر هم‌زمان برقرار باشد:
1. بیش از یک تیم مستقل (≥۲ تیم، هر تیم ≥۳ نفر) با مالکیت Contextهای مجزا.
2. بار AI به حدی برسد که Scale مستقل (خودکار، GPU-pool) اقتصادی شود — که در آن حالت ابتدا فقط AI Service جدا می‌شود (کاندیدای اول، §12).
3. نیاز به Deploy Frequency متفاوت بین حوزه بالینی و تجاری (>۱۰ deploy/روز تفاوت).
4. مجموعه داده یک Context (مثلاً Medical Records) نیازمند Data Store با ماهیت متفاوت شود.

---

## 3. نمای کلان سیستم و اجزای معماری

### 3.1 اجزای معماری (Components)

معماری BabaHakim از اجزای زیر تشکیل شده است (مطابق الزامات فاز ۰۳). جدول، وضعیت فعلی (Phase 00-02) و وضعیت هدف را صادقانه تفکیک می‌کند:

| جزء | نقش | انتخاب فناوری (هدف) | وضعیت فعلی کد | ADR |
|---|---|---|---|---|
| **Frontend** | SPA دوزبانه fa/en با RTL/LTR، تعامل بیمار/کارکنان/ادمین | Next.js 16 App Router (React 19، یک route واحد `/` + Server Componentها در فازهای بعد) | ✅ پیاده‌سازی کامل (AppShell، ۶ پنل نقش، Dark Mode، Jalali) | ADR-0003 |
| **Backend (App/API)** | API لایه‌بندی‌شده `/api/v1`، اعمال RBAC، فراخوانی Moduleها | Next.js Route Handlers نازک → Module Facades | ⚠️ منطق بخشی هنوز در Routeها؛ refactor به Module در §13 | ADR-0003 |
| **Worker** | پردازش Async: تحلیل AI، ارسال اعلان، تایمرهای SLA، تجمیع گزارش | Process جدا (Bun/Node) + BullMQ Consumers | ❌ وجود ندارد (AI الان inline اجرا می‌شود) — فاز بعدی | ADR-0005, ADR-0011 |
| **Database** | ذخیره‌سازی OLTP با Schema به ازای Context | PostgreSQL 16 + Prisma (schema-per-context) | ⚠️ SQLite (`db/custom.db`) در dev — مسیر Migrate در §8.4 | ADR-0004 |
| **Cache** | Cache داده پرخوانش + شمارنده Rate Limit | Redis 7 (RBAC matrix، تنظیمات، Catalog، rate-limit) | ❌ وجود ندارد | ADR-0005 |
| **Queue** | Job Queue + Delayed Jobs + Event Bus | Redis + BullMQ (ai، notify، sla، reporting، retry/DLQ) | ❌ وجود ندارد — جایگزین فراخوانی هم‌زمان | ADR-0005, ADR-0008 |
| **Object Storage** | نگهداری تصاویر زبان (۴ واریانت) و رسیدها، خصوصی + Signed URL | S3-compatible (MinIO در dev، S3/اروان کلود در prod) | ⚠️ فایل‌سیستم محلی `storage/uploads` + HMAC Signed URL | ADR-0006 |
| **AI Service** | استنتاج مدل تحلیل زبان، جدای از اپ اصلی | Service مستقل (Python/FastAPI + Torch) پشت Port `AIModelProvider` | ⚠️ TongueModelV1 در-پروسه (Node) — کاندیدای اول Extraction | ADR-0007 |
| **Notification Service** | ارسال اعلان multichannel (In-App، SMS، Email، Push) | Module + Worker Consumer + Adapterهای SMS/Email | ⚠️ In-App + SMSLog ثبت‌شده (Gateway واقعی فاز 07+) | ADR-0008, ADR-0009 |
| **Payment Adapter** | اتصال به PSP (زرین‌پال) و مسیر کارت‌به‌کارت | Port `PaymentGateway` + Adapter زرین‌پال (+ Sandbox) | ⚠️ زرین‌پال Mock با Idempotency واقعی | ADR-0009 |
| **Shipping Adapter** | اتصال به Courier (پیک داخلی/خودرو/پست) | Port `ShippingProvider` + Adapterها (داخلی + خارجی) | ⚠️ ارسال داخلی ثبت دستی (بدون API خارجی) | ADR-0009 |

> **اصل صداقت مستند (منشور، قاعده ۱۱):** جدول بالا وضعیت واقعی را نشان می‌دهد. معماری «هدف» است و §13 مسیر رسیدن به آن را مشخص می‌کند؛ هیچ جزئیاتی از وضعیت فعلی برای «تلمیح به کامل بودن» بزرگ‌نمایی نمی‌شود.

### 3.2 اصول حاکم بر اجزا

1. **Single Source of Truth:** هر داده دقیقاً یک مالک Context دارد (§4). مثلاً وضعیت سفارش فقط توسط ماشین ORDER تغییر می‌کند (ED-33).
2. **Thin Delivery Layer:** Frontend و Routeها هیچ منطق دامنه‌ای ندارند؛ همه چیز از Module API می‌گذرد (ادامه الگوی Phase 02 که Transitionها را از Route به Engine منتقل کرد).
3. **Async-by-Default برای اثرات جانبی:** اعلان، تحلیل AI، تجمیع گزارش — Sync فقط جایی که پاسخ کاربر به آن وابسته است (مثلاً ثبت آپلود تصویر).
4. **Fault Containment با Worker و DLQ:** شکست AI یا SMS هرگز چرخه بالینی را متوقف نمی‌کند (ED-29: AI پیشنهاد است، نه پیش‌نیاز).

---

## 4. Bounded Contextها

### 4.1 نقشه کلان و تخصیص مدل‌های داده (۳۶ مدل Prisma فعلی)

۱۵ Bounded Context تعریف شده است. هر مدل داده دقیقاً به **یک** Context تخصیص دارد (تک‌مالکیتی — بدون مالکیت مشترک):

| Context | مسؤولیت | مدل‌های مالک‌شده (Prisma فعلی) | کد ماژول (هدف) |
|---|---|---|---|
| **Identity** | احراز هویت، کاربران، نقش‌ها، دسترسی‌ها، Session/RefreshToken | `User`, `Role`, `Permission`, `RolePermission`, `RefreshToken` | `src/modules/identity` |
| **Patients** | پروفایل بیمار، پرسشنامه‌های نسخه‌دار، معرف (Referral) | `PatientProfile`, `Questionnaire`, `Question`, `QuestionOption`, `QuestionnaireResponse`, `Referral` | `src/modules/patients` |
| **Medical Records** | تصاویر پزشکی (۴ واریانت + Quality)، Consent، پرونده خام | `MedicalImage` | `src/modules/medical-records` |
| **AI** | رجیستری مدل، Job تحلیل، نتایج + Explainability | `AIModel`, `AIAnalysis` | `src/modules/ai` |
| **Clinical Review** | پرونده بیمار و گردش بالینی، تشخیص، Disease Catalog، تایم‌لاین | `MedicalCase`, `CaseEvent`, `Disease`, `Diagnosis` | `src/modules/clinical-review` |
| **Products** | کاتالوگ محصول، تاریخچه قیمت (غیرقابل حذف)، نگاشت Disease↔Product | `Product`, `ProductPriceHistory`, `DiseaseProduct` | `src/modules/products` |
| **Prescriptions** | نسخه‌ها (Versioning + Supersede)، اقلام، دستور مصرف | `Prescription`, `PrescriptionItem` | `src/modules/prescriptions` |
| **Commerce** | سبد خرید، سفارش، اقلام سفارش، پیش‌فاکتور | `CartItem`, `Order`, `OrderItem`, `Invoice` | `src/modules/commerce` |
| **Payments** | تراکنش پرداخت (درگاه + کارت‌به‌کارت)، Idempotency، Verify | `Payment` | `src/modules/payments` |
| **Shipping** | مرسوله، نحوه ارسال، Tracking، تأیید تحویل | `Shipment` | `src/modules/shipping` |
| **Notifications** | اعلان In-App، صف ارسال، SMS Log، قالب‌ها | `Notification`, `SMSLog` | `src/modules/notifications` |
| **Tickets** | تیکت پشتیبانی و پیام‌ها | `Ticket`, `TicketMessage` | `src/modules/tickets` |
| **Reporting** | گزارش‌ها و داشبوردها (فقط Read Model — بدون مالکیت OLTP) | — (Projectionها) | `src/modules/reporting` |
| **Finance** | تراکنش‌های مالی، حسابداری، Reconciliation | `FinancialTransaction` | `src/modules/finance` |
| **Administration** | تنظیمات سیستم، AuditLog (Event Stream فرا-Context)، مدیریت RBAC | `AuditLog`, `SystemSetting` (آینده) | `src/modules/administration` |

### 4.2 مشخصات هر Context

هر Context با قرارداد یکسانی مستند می‌شود: **مسؤولیت · Public API · رویدادهای منتشرشده · وابستگی‌های مجاز**.

**1) Identity (T0)** — احراز هویت (JWT access 12h + refresh چرخشی 30d)، مدیریت User/Role/Permission، قفل Brute-force.
- Public API: `authenticate()`, `verifySession()`, `getUserPermissions()`, `createUser()`, `assignRole()`
- Events: `identity.user.registered`, `identity.user.locked`, `identity.role.changed`
- وابستگی مجاز: فقط Kernel. **هیچ Contextای به جز Kernel بالای آن قرار نمی‌گیرد.**

**2) Patients (T1)** — پروفایل بیمار (شهر، تاریخ تولد، کد معرف)، پاسخ پرسشنامه مزاج، نسخه‌بندی پرسشنامه توسط Admin.
- Public API: `getPatientProfile()`, `submitQuestionnaire()`, `getMizajResult()`, `applyReferral()`
- Events: `patients.questionnaire.submitted`, `patients.profile.updated`
- وابستگی: Identity (فقط خواندن User از طریق Facade)، تنظیمات Administration از طریق ConfigService کش‌شده.

**3) Medical Records (T2)** — آپلود تصویر، Pipeline چهار-واریانتی (original/compressed/ai/thumb با sharp)، ارزیابی کیفیت، HMAC Signed URL.
- Public API: `uploadImage()`, `getSignedUrl()`, `getImageQuality()`
- Events: `medicalrecords.image.stored`, `medicalrecords.image.rejected`
- وابستگی: Patients (مالکیت پرونده بیمار)، Identity (Audit بازیگر).

**4) AI (T3)** — صف تحلیل، اجرای Provider، ذخیره پیش‌بینی + Confidence × Quality-damping + Explainability، بازبینی انسانی (ماشین AI_REVIEW فاز 02).
- Public API: `requestAnalysis()`, `getAnalysis()`, `getDeployedModel()`, `submitReview()`
- Events: `ai.analysis.completed`, `ai.analysis.failed`, `ai.review.recorded`
- وابستگی: Medical Records (خواندن تصویر از طریق Signed Access)، Identity، Notifications. **منطق دامنه AI به هیچ Context دیگری وابستگی قطعی ندارد (ED-29).**

**5) Clinical Review (T4 — Orchestrator بالینی)** — ماشین CASE (۲۱ وضعیت/۱۸ Transition)، صف کارشناسان، Claim، تشخیص، تصمیم پزشک، تایم‌لاین (CaseEvent).
- Public API: `createCase()`, `applyCaseAction()`, `claimCase()`, `getCaseTimeline()`
- Events: `clinicalreview.case.created`, `clinicalreview.case.stage.changed`, `clinicalreview.diagnosis.recorded`
- وابستگی: Patients, Medical Records, AI (خواندن تحلیل), Prescriptions, Commerce (صدور Order/Invoice از طریق Facade — پایین‌تر), Identity, Notifications. **تنها Context مجاز به ارکستراسیون Sync چند-Contextی است.**

**6) Products (T2)** — کاتالوگ، قیمت‌گذاری با تاریخچه غیرقابل تخریب (P4)، جستجوی فارسی-نرمال‌شده، Import CSV.
- Public API: `searchProducts()`, `getProduct()`, `getEffectivePrice()`, `applyPriceChange()`
- Events: `products.price.changed`, `products.catalog.imported`
- وابستگی: فقط Kernel + ConfigService.

**7) Prescriptions (T3)** — نسخه با Versioning (Supersede بدون حذف قدیمی)، اقلام + موجودی، دستور مصرف.
- Public API: `createPrescription()`, `supersedePrescription()`, `finalizePrescription()`
- Events: `prescriptions.prescription.created`, `prescriptions.prescription.finalized`
- وابستگی: Products (بررسی اقلام/قیمت), Patients, Identity, Notifications.

**8) Commerce (T3)** — سبد، Checkout، سفارش (ماشین ORDER ۱۱ وضعیت/۹ Transition)، پیش‌فاکتور با انقضای ۷روزه (ED-30).
- Public API: `addToCart()`, `checkout()`, `confirmOrder()`, `issueInvoice()`
- Events: `commerce.order.created`, `commerce.order.confirmed`, `commerce.invoice.issued`, `commerce.invoice.expired`
- وابستگی: Products, Patients, Identity, Notifications. ارجاع به Prescription صرفاً Soft Reference (ID) است — بدون Import.

**9) Payments (T4)** — درگاه زرین‌پال (Port `PaymentGateway`)، کارت‌به‌کارت با رسید، Verify اپراتور، Idempotency (ماشین PAYMENT + `paymentPaidCascade` اتمیک).
- Public API: `initiatePayment()`, `verifyGatewayCallback()`, `submitCardReceipt()`, `operatorApprovePayment()`
- Events: `payments.payment.initiated`, `payments.payment.confirmed`, `payments.payment.failed`
- وابستگی: Commerce (فاکتور/سفارش — Cascade تک‌نویسنده)، Identity, Notifications, Port PaymentGateway.

**10) Shipping (T4)** — مرسوله (ماشین SHIPMENT)، نحوه ارسال، ثبت Tracking، تأیید تحویل.
- Public API: `createShipment()`, `updateTracking()`, `confirmDelivery()`
- Events: `shipping.shipment.dispatched`, `shipping.shipment.delivered`
- وابستگی: Commerce (ORDER — تنها Cascade مجاز طبق ED-33)، Notifications، Port ShippingProvider.

**11) Notifications (T1)** — قالب ۳۴ رویدادی موجود، In-App + SMS Log، در هدف: Consumer صف با Adapterهای SMS/Email/Push و تایمبند و Retry.
- Public API: `dispatch()`, `listUserNotifications()`, `markRead()`
- Events: — (مصرف‌کننده نهایی است؛ رویداد منتشر نمی‌کند)
- وابستگی: Identity (حل شماره/ایمیل مخاطب از Facade). **بقیه Contextها به Notifications وابسته‌اند، نه برعکس — چرخه با ارسال `recipientId` در دستور Dispatch شکسته می‌شود.**

**12) Tickets (T2)** — تیکت پشتیبانی (ماشین TICKET)، پیام‌ها، یادداشت داخلی، Reopen توسط بیمار.
- Public API: `createTicket()`, `replyTicket()`, `reopenTicket()`
- Events: `tickets.ticket.created`, `tickets.ticket.replied`
- وابستگی: Identity, Notifications, Patients. ارجاع به Order/Case صرفاً Soft Reference.

**13) Reporting (T5 — فقط خواندن)** — داشبوردهای نقش‌محور، گزارش فروش/درآمد/معرف/استان، تجمیع روزانه.
- Public API: `getDashboard()`, `getRevenueReport()`, `getTopProducts()`
- وابستگی: **هیچ Import کد از Contextهای دیگر** — تغذیه از Domain Events + Read Model (§8.3). در v1 فعلی که Event Bus نیست، از Queryهای فقط-خواندنی روی Replica منطقی استفاده می‌کند (محدود و مستثنی موقت — §13).

**14) Finance (T5)** — ثبت تراکنش مالی هم‌زمان با Cascade پرداخت، Reconciliation درگاه، گزارش هزینه/درآمد.
- Public API: `recordTransaction()`, `reconcileGateway()`, `getFinancialSummary()`
- Events: `finance.transaction.recorded`
- وابستگی: Commerce, Payments (Read Model + Facade فقط-خواندنی).

**15) Administration (T0 — Cross-Cutting)** — تنظیمات سیستمی (SystemSetting آینده: انقضای Proforma، SLA، آستانه کیفیت تصویر)، AuditLog به‌عنوان Event Stream فرا-Context، مدیریت RBAC، ورودی‌های Admin.
- Public API: `getSetting()`, `updateSetting()`, `writeAudit()`, `queryAuditLogs()`
- Events: `administration.setting.changed`
- وابستگی: Kernel. **بقیه Contextها تنظیمات را از طریق ConfigService (Kernel، کش‌شده) می‌خوانند — نه با Import مستقیم از Administration.** پنل‌های Admin از Facadeهای Contextهای دیگر Compose می‌شوند.

---

## 5. قواعد وابستگی (Dependency Rules)

### 5.1 مدل Tier (لایه‌ای، یک‌طرفه)

وابستگی‌ها **فقط به سمت پایین** مجازند. Tier با شماره کوچک‌تر «زیرین» است و هرگز از Context زیرین به Context بالاتر import انجام نمی‌شود:

| Tier | Contextها | مجاز به وابستگی به |
|---|---|---|
| **Kernel (K)** | `src/shared/` — db, auth primitives, i18n, Result types, ConfigService, AuditPort | هیچ (پایه فنی) |
| **T0** | Identity, Administration | Kernel |
| **T1** | Notifications, Patients | T0, K |
| **T2** | Medical Records, Products, Tickets | T1, T0, K |
| **T3** | AI, Prescriptions, Commerce | T2, T1, T0, K |
| **T4** | Clinical Review, Payments, Shipping | T3, T2, T1, T0, K |
| **T5** | Finance, Reporting | T4, T3, T2, T1, T0, K (Reporting: فقط رویداد/Read Model — §4.2) |

نمودار کامل در `ARCHITECTURE-DIAGRAM.md §3` آمده است.

### 5.2 هشت قاعده وابستگی (ناقض‌شدنی)

| # | قاعده | مثال مجاز | مثال غیرمجاز |
|---|---|---|---|
| **D1** | وابستگی فقط به Tier پایین‌تر است؛ وابستگی هم‌Tier ممنوع | AI (T3) → Medical Records (T2) | Products (T2) → Commerce (T3)؛ Tickets (T2) → Products (T2) |
| **D2** | هر Context فقط از `modules/<ctx>/api/index.ts` (Public Facade) قابل import است | `import { requestAnalysis } from '@/modules/ai'` | `import { predict } from '@/modules/ai/domain/model'` |
| **D3** | هر Context فقط مدل‌های Prisma خودش را Query می‌کند (تک‌مالکیتی) | Commerce → `Order`, `Invoice` | Commerce → `Prisma.PatientProfile` (باید از Facade بگیرد) |
| **D4** | ارجاع بین-Contextی فقط با **Soft Reference** (ID بدون FK) و Lookup از طریق Facade/Event | `Ticket.orderId: string` + `commerce.getOrder(id)` | FK دیتابیسی از `Ticket` به `Order` |
| **D5** | نیاز به نتیجه فوری = Facade Sync؛ نیاز به اطلاع‌رسانی = Domain Event Async | Clinical Review → `commerce.issueInvoice()` Sync (اتمیک) | Payments → مستقیم UPDATE جدول Order |
| **D6** | Reporting و Finance از Contextهای OLTP Import نمی‌کنند؛ تغذیه از Event + Read Model | Reporting مصرف‌کننده `payments.payment.confirmed` | Reporting → `@/modules/commerce` (Query مستقیم — فقط استثنای موقت §13) |
| **D7** | Kernel (shared) از هیچ Moduleای import نمی‌کند (بدون چرخه به بالا) | — | `src/shared/logger.ts` → `@/modules/identity` |
| **D8** | Circular Import در هر سطحی (فایل، ماژول، Context) ممنوع؛ شکار با CI (§6) | — | Identity ↔ Administration |

### 5.3 الگوهای ارتباطی مجاز

```text
Sync Facade (strong consistency)      Async Domain Event (eventual)
┌──────────────────────┐              ┌──────────────┐   publish    ┌─────────┐
│ Clinical Review (T4) │──call──────▶ │  Payments    │──event────▶ │  Queue  │
│  (orchestrator)      │              │  (T4)        │              └────┬────┘
└──────────────────────┘              └──────────────┘                   │ consume
                                      ┌──────────────┐◀──────────────────┘
                                      │ Notifications │  (recipientId در Event)
                                      └──────────────┘
```

- **Sync Facade:** فقط برای عملیات داخل یک Transaction منطقی (مثل Cascade پرداخت) که پاسخ آنی به کاربر می‌دهد.
- **Async Event:** برای اثرات جانبی (اعلان، تحلیل AI، تجمیع، تأییدهای SLA) — شکست Consumer اپ را آلوده نمی‌کند (Retry + DLQ).
- **نام‌گذاری Event:** `<context>.<entity>.<verb-past>` (مثلاً `payments.payment.confirmed`) — کاتالوگ کامل در §7.

---

## 6. جلوگیری از Circular Dependency

### 6.1 مکانیزم‌های طراحی (پیشگیری)

| # | مکانیزم | شرح |
|---|---|---|
| 1 | **مدل Tier صریح (D1)** | چون وابستگی فقط به پایین است و هر Context دقیقاً یک Tier دارد، چرخه در گراف وابستگی **ریاضیاتاً غیرممکن** می‌شود (گراف DAG). |
| 2 | **ConfigService در Kernel** | Administration تنظیمات را می‌نویسد؛ بقیه از Kernel می‌خوانند — یعنی Contextها هرگز به Administration import نمی‌کنند و Administration نیز به آن‌ها import ندارد (پنل Admin از API عمومی Contextها Compose می‌شود). |
| 3 | **Event-Carried Payload** | در رویدادها، داده موردنیاز Consumer حمل می‌شود (`recipientId`, `orderId`, مبلغ) — Consumer مجبور به Lookup معکوس به سمت ناشر نیست. |
| 4 | **فرمان مقدم بر پرسش (Command over Query)** | Notifications با `recipientId` کار می‌کند و شماره مخاطب را فقط از Identity (زیرین) می‌گیرد؛ بیمار/سفارش/پرونده چیزی از Notifications نمی‌خواهند. |
| 5 | **ارجاع نرم (Soft Reference)** | ارجاع ID بدون FK و بدون import — مثل `Ticket.orderId` — مسیر وابستگی کامپایل‌زمان ایجاد نمی‌کند. |
| 6 | **Orchestrator واحد هر جریان** | هر Cascade چند-موجودیتی یک نویسنده دارد (ED-33)؛ Clinical Review تنها ارکستراتور بالینی است و Payments تنها ارکستراتور مالی — دو ارکستراتور هرگز یکدیگر را فراخوانی نمی‌کنند. |

### 6.2 مکانیزم‌های اجرایی (Enforcement — قاعده ۲ منشور: هر قاعده باید قابل Test باشد)

سه لایه Enforce، به‌ترتیب سرعت بازخورد:

**لایه ۱ — ESLint (محلی، لحظه‌ای):** قواعد `no-restricted-imports` در `eslint.config.mjs` با patternهای `modules/*/domain`, `modules/*/infra`, `modules/*/events` (به‌جز import داخل همان ماژول).

**لایه ۲ — dependency-cruiser (CI):** فایل `.dependency-cruiser.cjs` با قاعده فرا-Contextی و بررسی Tier. نمونه قاعده (اجرای مستقیم در CI):

```js
// .dependency-cruiser.cjs — اجرا: npx depcruise src --validate
const TIER = { identity: 0, administration: 0, notifications: 1, patients: 1,
  'medical-records': 2, products: 2, tickets: 2, ai: 3, prescriptions: 3, commerce: 3,
  'clinical-review': 4, payments: 4, shipping: 4, finance: 5, reporting: 5 };

const ctx = '([^/]+)';
module.exports = {
  forbidden: [
    { // D2: فقط سطح api عمومی import می‌شود
      name: 'context-internal-import',
      severity: 'error',
      from: { path: `^src/modules/${ctx}/` },
      to: { path: `^src/modules/${ctx}/(domain|infra|events)/` },
    },
    { // D1: وابستگی فقط به Tier پایین‌تر (reaching into another context)
      name: 'context-tier-violation',
      severity: 'error',
      from: { path: (p) => p.startsWith('src/modules/') },
      to: { path: (p) => p.startsWith('src/modules/') },
    },
  ],
};
// بررسی دقیق مقایسه Tier[from] >= Tier[to] در لایه ۳ (unit test) انجام می‌شود
// چون depcruiser pattern خالص است و تابع مقایسه عددی را پشتیبانی نمی‌کند.
```

**لایه ۳ — Unit Test معماری (bun test):** تست `src/modules/__tests__/architecture.test.ts` فایل‌های `src/modules/*/` را پیمایش می‌کند، هر `import '@/modules/x/...'` را استخراج می‌کند و تضمین می‌کند: (الف) فقط `api` سطح عمومی import شده، (ب) `TIER[from] >= TIER[to]`، (ج) Kernel هیچ importی از `modules/` ندارد. **این تست همان جایی اجرا می‌شود که ۵۱ تست Workflow اجرا می‌شوند — بدون ابزار اضافه.**

**لایه ۴ — بازبینی در PR:** Checklist PR شامل «آیا import جدیدی بین Contextها اضافه شده؟ آیا Public Facade رعایت شده؟» است.

### 6.3 واکنش به کشف چرخه (Runbook)

اگر CI چرخه/نقض Tier گزارش کرد، ترتیب اصلاح (قاعده ۱۳ منشور — ریشه‌یابی قبل از fix):
1. نوع چرخه را مشخص کن: **کامپایل‌زمان** (import) یا **منطقی** (فراخوانی متقابل در اجرا).
2. اگر کامپایل‌زمان: داده مشترک را به Context زیرین‌تر منتقل کن، یا Event Async جایگزین کن، یا در بدترین حالت یک Context جدید پایین‌تر بساز (Extract Shared Sub-domain).
3. اگر منطقی: ارکستراتور را مشخص کن و فراخوانی معکوس را به Event تبدیل کن.
4. قاعده جدید را به‌عنوان تست architecture اضافه کن تا تکرار نشود (قاعده ۱۲ منشور).

---

## 7. کاتالوگ Domain Events و ارتباط بین Contextها

### 7.1 Event Bus

- **حامل:** BullMQ (Redis) — یک Queue استاندارد به ازای Consumer + Queue تخصصی (`events.dlq`) برای پیام‌های شکست‌خورده پس از N Retry.
- **قرارداد پیام:** `{ id, name, occurredAt, context, payload, correlationId }` — `correlationId` برای پیوند رخدادها با یک Case/Order واحد (پایه Tracing آینده).
- **تحویل:** At-least-once؛ مصرف‌کننده‌ها باید Idempotent باشند (کلید `eventId`).

### 7.2 کاتالوگ رویدادهای هسته (v1)

| Event | ناشر | Consumerهای اصلی | اثر |
|---|---|---|---|
| `identity.user.registered` | Identity | Notifications (خوش‌آمد)، Patients (ایجاد Profile) | ثبت‌نام بیمار |
| `patients.questionnaire.submitted` | Patients | Clinical Review (شرایط Case) | داده ورودی Case |
| `medicalrecords.image.stored` / `.rejected` | Medical Records | Notifications (بیمار)، AI (تحلیل در صورت Case فعال) | نتیجه دروازه کیفیت |
| `ai.analysis.completed` / `.failed` | AI | Clinical Review (نمایش پیشنهاد)، Reporting (آمار) | پیشنهاد AI آماده بازبینی |
| `clinicalreview.case.stage.changed` | Clinical Review | Notifications (۳۴ قالب فعلی)، Reporting (SLA/Wait-time) | هر ۱۸ Transition |
| `prescriptions.prescription.finalized` | Prescriptions | Commerce (صدور Proforma) | نسخه قطعی |
| `commerce.invoice.issued` / `.expired` | Commerce | Notifications، Finance | چرخه پیش‌فاکتور (ED-30) |
| `payments.payment.confirmed` / `.failed` | Payments | Commerce (Cascade — مسیر Sync اجباری)، Finance، Notifications | Cascade اتمیک (ED-33) |
| `shipping.shipment.dispatched` / `.delivered` | Shipping | Notifications، Clinical Review (پیگیری درمان)، Reporting | وضعیت مرسوله |
| `tickets.ticket.created` / `.replied` | Tickets | Notifications | پشتیبانی |
| `administration.setting.changed` | Administration | ConfigService ( Invalidate Cache) | تنظیم زنده |

> **نکته مهم:** رویداد `payments.payment.confirmed` دو مسیر دارد — Cascade مالی **Sync/اتمیک** باقی می‌ماند (ED-33) و فقط اثرات جانبی (اعلان، Finance، Reporting) از مسیر Async منتقل می‌شوند. این تفکیک «ذات سیگنال» از «اثر جانبی» ستون فقرات طراحی ارتباطی BabaHakim است.

---

## 8. معماری داده

### 8.1 اصول

1. **تک‌مالکیتی:** هر جدول دقیقاً متعلق به یک Context است (جدول §4.1) و فقط از همان Context نوشته/خوانده می‌شود (D3).
2. **Schema-per-Context:** در PostgreSQL هدف، هر Context یک DB Schema مستقل دارد (`identity`, `patients`, `medical_records`, `ai`, …). FK بین‌Schemaای مجاز نیست — ارتباط با Soft Reference + Lookup (D4). در SQLite فعلی (بدون پشتیبانی Schema) همین تفکیک با قرارداد prefix + تست معماری حفظ می‌شود.
3. **حفظ تاریخچه (P4):** قیمت (`ProductPriceHistory`)، نسخه (`Prescription` نسخه‌های Superseded)، پاسخ پرسشنامه (نسخه‌دار) هرگز Hard-delete نمی‌شوند.
4. **Soft-Delete فراگیر:** تمام موجودیت‌ها `deletedAt` دارند؛ حذف فیزیکی فقط در Policy نگهداری داده (آینده — فاز Compliance).
5. **Migration-only (قاعده ۸ منشور):** تغییر Schema فقط با `prisma migrate` — الگوی جاری فاز 02 (baseline + migration).

### 8.2 مدل‌های مهم و قواعد داده

- **پرتفوی تصویر:** `MedicalImage` چهار واریانت (original/compressed/ai/thumb) + SHA-256 + Quality JSON در DB؛ فایل‌ها فقط در Object Storage (هیچ فایل پزشکی روی Disk اپ نوشته نمی‌شود — هدف ADR-0006).
- **AuditLog:** Event Stream فرا-Context با الگوی `WORKFLOW_<ENTITY>_<ACTION>` (ED-32) — Append-only، بدون Update/Delete.
- **Idempotency:** `Payment` با کلید یکتای Authority/RefNumber؛ Callback درگاه با کلید Idempotency.

### 8.3 Read Model برای Reporting/Finance (CQRS-lite)

- Reporting و Finance روی OLTP اصلی Query نمی‌زنند؛ در هدف، Projectionهای ساده (جداول تجمیعی مثل `reporting_daily_revenue`) توسط Worker از Event Bus پر می‌شوند.
- **استثنای مستند v1:** تا زمان راه‌اندازی Event Bus، Reporting از Queryهای فقط-خواندنی مستقیم (بدون Join نوشتاری، بدون قفل) استفاده می‌کند؛ بدهی فنی ثبت‌شده در §13 و RTM.

### 8.4 مسیر SQLite → PostgreSQL

| گام | شرح |
|---|---|
| 1 | فعال‌سازی Postgres در `docker-compose` (dev) — نیازمندی ADR-0004 |
| 2 | `datasource` Prisma → `postgresql`؛ اعمال Migrationهای موجود روی دیتابیس خالی (اعتبارسنجی forward-only) |
| 3 | اسکریپت یک‌بار مصرف ETL برای انتقال داده Seed dev (بدون داده پزشکی واقعی — قید C5) |
| 4 | اجرای سوئیت تست + Smoke (همان الگوی Phase 02) روی Postgres |

---

## 9. معماری امنیت

جزئیات کامل فصل امنیت در فاز Hardening (فاز ۰۴ طبق نقشه §12 PRD) مستند می‌شود؛ معماری این‌ها را از الان قطعی می‌کند:

| لایه | تصمیم معماری |
|---|---|
| Authentication | JWT (jose) — access 12h + refresh چرخشی 30d در Cookie امن httpOnly؛ قفل Brute-force در Identity |
| Authorization | RBAC مبتنی بر Permission (۳۱ Permission فعلی) — اعمال در Facade هر Context، نه در UI |
| Data-at-Rest | تصاویر پزشکی در Bucket خصوصی Object Storage؛ دسترسی فقط Signed URL منقضی‌شونده (HMAC فعلی → S3 Presign هدف) با Audit `VIEW_MEDICAL_FILE` |
| Data-in-Transit | TLS در لبه (Caddy/Nginx)؛ ارتباط داخلی شبکه Docker ایزوله |
| Secrets | فقط از Env/Docker Secrets — هیچ Secretای در Git (قاعده ۶)؛ اعتبارسنجی با تست اسکن Secret |
| Audit | همه عملیات حساس با AuditLog اتمیک (ED-32) + Audit Port در Kernel برای همه Contextها |
| Isolation | شبکه Docker داخلی؛ فقط Frontend/Backend و درگاه‌های Payment Callback بیرون‌در معرض قرار دارند |
| Privacy | هیچ داده سلامتی در URL/Log؛ نرمال‌سازی متن فارسی فقط برای جستجو (نه ذخیره) |

---

## 10. استقرار (Deployment)

### 10.1 توپولوژی Dev (docker-compose — قید C4)

| Container | نقش |
|---|---|
| `web` | Next.js (SSR + API) — standalone build |
| `worker` | همان Image با entrypoint متفاوت (`bun src/workers/index.ts`) — Consumerهای BullMQ |
| `postgres` | PostgreSQL 16 (OLTP) |
| `redis` | Redis 7 (Cache + Queue) |
| `minio` | Object Storage S3-compatible (Bucket خصوصی `bh-medical`) |
| `ai` | AI Service (FastAPI + مدل) — پشت شبکه داخلی، فقط از web/worker قابل دسترسی |
| `caddy` | Reverse Proxy + TLS خودکار (prod) — در dev اختیاری |

### 10.2 توپولوژی Prod (هدف)

- `web` به‌صورت Horizontal Scale (۲+ Replica) پشت LB؛ Sessionها Stateless (JWT) ⇒ Scale بی‌دردسر.
- `worker` با Concurrency مستقل (صف AI سنگین‌تر از صف Notify)؛ Scale جداگانه.
- `ai` روی Node مجزا/GPU در صورت نیاز — بدون هیچ تغییری در بقیه سیستم (ADR-0007).
- Backup روزانه Postgres + نسخه‌بندی Object Storage + تست Restore فصلی.

### 10.3 قواعد استقرار

- Config فقط از Env (۱۲-Factor)؛ هیچ Environment-specific hardcoded نمی‌شود (قاعده ۱۴ منشور).
- Health-checkها: `/api/health` (web — عمق: DB + Redis + Storage)، `/health` (worker — heartbeat صف)، `/health` (ai).
- استراتژی Release: Rolling با Readiness Probe؛ Migrationها قبل از Deploy اتمیک اجرا می‌شوند (Expand-Contract برای تغییرات Breaking).

---

## 11. Observability

| محور | v1 (فعلی) | هدف |
|---|---|---|
| Logging | `console` + dev.log | JSON ساخت‌یافته (pino) با `requestId/correlationId` |
| Metrics | — | Prometheus endpoint (web/worker/ai): latency صف، نرخ خطا، SLA انتظار کارشناسان |
| Tracing | `correlationId` در Eventها | OpenTelemetry-ready (نقاط instrument از الان تعریف شده) |
| Alerting | — | آستانه‌های: DLQ غیر-خالی، نرخ شکست Callback پرداخت > X%، Queue Backlog > Y |
| Audit | ✅ کامل (AuditLog) | همان + نگهداری بلندمدت (فاز Compliance) |

---

## 12. مسیر Extraction به Microservices

### 12.1 کاندیداها به‌ترتیب اولویت

| اولویت | کاندیدای Extraction | دلیل | مهاجرت |
|---|---|---|---|
| 1 | **AI Service** | قید C3 (Scale مستقل GPU)؛ جدایی چرخه Release مدل؛ Port از پیش موجود (`AIModelProvider`) | فقط Port→HTTP/gRPC؛ کد Consumer بدون تغییر |
| 2 | **Notification Service** | I/O-bound با SLA متفاوت؛ پرریسک‌ترین نقطه برای Rate-limit اپ | Queue Consumer مستقل؛ ناشران تغییری نمی‌کنند (رویداد Async از الان) |
| 3 | **Payments** | ایزوله بودن PCI-scope آینده؛ PSP مستقل | Facade → API Gateway؛ داده همان Schema جدا |
| 4 | **Reporting** | بار تحلیلی سنگین روی Read Model | جداسازی دیتابیس Analytical + Event Feed |

Clinical Review، Patients و Identity **دیرترین** کاندیداها هستند (بیشترین Transaction بین‌Contextای و هسته یکپارچگی بالینی).

### 12.2 استراتژی Strangler (برای هر کاندیدا)

1. Contract Facade موجود را Freeze کن (تست طلایی روی Public API).
2. Adapter شبکه‌ای بنویس (همان Interface، پیاده‌سازی HTTP/RPC).
3. ترافیک را مرحله‌ای منتقل کن (Feature Flag).
4. داده را با Dual-Write موقت و سپس Cut-over جدا کن.
5. Facade در-پروسه را حذف کن.

هر Extraction فقط با تأیید **معیارهای §2.3** انجام می‌شود — نه بر اساس تقویم.

---

## 13. نگاشت وضعیت فعلی کد به معماری هدف

فازهای 00-02 با ساختار `src/lib/*` ساخت یافته‌اند. جدول زیر نقشه انتقال (Refactor مرحله بعدی — بدون تغییر رفتار، با پشتوانه تست‌های موجود) را نشان می‌دهد:

| فایل/پوشه فعلی | Context هدف | نکته |
|---|---|---|
| `src/lib/auth.ts` | Identity + Kernel (توکن در Kernel) | تقسیم: JWT verify در `shared/auth`؛ User/Role در `modules/identity` |
| `src/lib/db.ts` | Kernel | Prisma client تکی (اتصال چندگانگی مدیریت‌شده) |
| `src/lib/storage.ts` | Kernel Port `ObjectStorage` → Adapter (Local→S3) | Interface از الان استخراج می‌شود (ADR-0006) |
| `src/lib/ai/provider.ts`, `run.ts` | AI | `AIModelProvider` = Port رسمی (ADR-0007) |
| `src/lib/notify.ts` | Notifications | قالب‌ها دامنه Notifications؛ dispatch به Queue |
| `src/lib/caseService.ts` | Clinical Review | Adapter نازک روی Workflow Engine (ادامه ED-31) |
| `src/lib/workflow/` | Kernel(Engine) + machines توزیع به Contextها | Engine در Kernel می‌ماند؛ `machines/case.ts`→Clinical Review، `order.ts`→Commerce و… |
| `src/lib/constants.ts` | تفکیک به Contextها | RBAC→Identity؛ Statusها→ماشین هر Context |
| `src/lib/i18n.ts`, `jalali.ts`, `utils.ts` | Kernel | بدون تغییر |
| API routes (`src/app/api/v1/**`) | نازک‌سازی | بدنه منطق → Module Facade (الگوی موفق Phase 02) |

**بدهی فنی ثبت‌شده (صادقانه):**
1. AI و اعلان‌ها Sync اجرا می‌شوند (Worker/Queue هنوز نیست) — فاز 03.5.
2. Reporting مستقیم Query می‌زند (بدون Read Model) — با راه‌اندازی Event Bus حل می‌شود.
3. SQLite → PostgreSQL (§8.4).
4. Prefix قدیمی `TC-` در داده Seed (پاکسازی داده‌ای — ثبت‌شده از فاز 01).

---

## 14. ریسک‌های معماری و کاهش آن‌ها

| # | ریسک | احتمال | اثر | کاهش |
|---|---|---|---|---|
| R1 | رشد تدریجی وابستگی‌های غیرمجاز (معماری روی کاغذ بماند) | متوسط | بالا | لایه‌های Enforce §6.2 (ESLint + depcruiser + architecture.test) از **اولین PR بعد از این فاز** فعال می‌شوند |
| R2 | تأخیر در راه‌اندازی Worker/Queue و انباشت منطق Sync | متوسط | متوسط | بدهی §13 شفاف ثبت شد؛ مرحله بعدی مشخص (فاز 03.5) |
| R3 | دشواری Migration SQLite→Postgres | کم | متوسط | مسیر ۴-گامی §8.4 + بدون داده پزشکی واقعی در dev (C5) |
| R4 | Single Point of Failure (یک Process web) | متوسط | متوسط | Scale افقی (Stateless JWT) + Health-check + Restart Policy؛ هدف HA در فاز 06 |
| R5 | Event Idempotency نادیده گرفته شود | کم | بالا | قرارداد `eventId` + تست Idempotency در سوئیت هر Consumer |
| R6 | AI Service در v1 در-پروسه است و Scale نمی‌شود | قطعی (مستند) | متوسط | Port `AIModelProvider` از الان جداست؛ Extraction فقط Deploy است نه Redesign (ADR-0007) |

---

## 15. ارجاعات

| سند | موضوع |
|---|---|
| `docs/PRD.md` | نیازمندی‌های FR/NFR و نقشه انتشار |
| `docs/BUSINESS-RULES.md` | قواعد کسب‌وکار + ED-01..46 (ED-35..46 این فاز) |
| `docs/USE-CASES.md` | سناریوهای طلایی و Edge Caseها |
| `docs/WORKFLOW.md` | موتور گردش کار و ۸ ماشین وضعیت (فاز 02) |
| `docs/ARCHITECTURE-DIAGRAM.md` | نمودارهای C4، Context Map، Dependency، استقرار |
| `docs/ADR/README.md` | فهرست و وضعیت ۱۲ تصمیم معماری ثبت‌شده |
| `docs/REQUIREMENTS-TRACEABILITY-MATRIX.md` | ماتریس ردیابی (به‌روزرسانی فاز 03) |

