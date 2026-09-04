# BabaHakim — قوانین کسب‌وکار و تصمیمات مهندسی

| فیلد | مقدار |
|---|---|
| نسخه | 1.0.0 |
| تاریخ | 1405/06/13 (2026-09-04) |
| فاز | PHASE 01 — Product Requirements & System Specification |
| ساختار | §1 قوانین (BR) · §2 ماتریس RBAC · §3 کاتالوگ وضعیت‌ها · §4 موتور Workflow (Transitions) · §5 تصمیمات مهندسی (ED) |

> **قاعده:** هر BR دارای شناسه، متن قانون، دلیل، نقطه اعمال (Layer) و مرجع Master Prompt است. هر ED یک ابهام محصول/فرآیند را به‌صورت قطعی حل و ثبت می‌کند (اصل §97: بهترین تصمیم مهندسی + ثبت + عدم توقف پروژه + پرهیز از پیچیدگی غیرضروری).

---

## §1 — قوانین کسب‌وکار (Business Rules)

### 1.0 هویت و نشست (`BR-AUTH`)

| ID | قانون | دلیل | نقطه اعمال | مرجع |
|---|---|---|---|---|
| BR-AUTH-01 | شماره موبایل شناسه یکتای حساب است؛ هر موبایل فقط یک حساب فعال دارد؛ نقش کاربر در ثبت‌نام PATIENT است و تخصیص نقش دیگر فقط توسط Admin | یکتایی هویت؛ جلوگیری از حساب موازی | Auth Service + Schema Unique | §6, §5 |
| BR-AUTH-02 | نشست با Access Token کوتاه‌عمر + Refresh Token چرخشی (Rotation) در کوکی httpOnly مدیریت می‌شود؛ Reuse یک Refresh Token = ابطال زنجیره | حداقل‌سازی اثر سرقت توکن | Session Middleware | §43 |
| BR-AUTH-03 | Logout فعال است: Refresh Token ابطال و رکورد Audit ثبت می‌کند؛ اعتبار توکن پس از ابطال فوری منتفی است | کنترل نشست در دستگاه اشتراکی | Auth Service | §42 |

### 1.1 حاکمیت بالینی و AI (`BR-MED`)

| ID | قانون | دلیل | نقطه اعمال | مرجع |
|---|---|---|---|---|
| BR-MED-01 | خروجی AI هرگز به‌عنوان «تشخیص قطعی» به بیمار نمایش داده نمی‌شود؛ همیشه همراه Confidence، برچسب «نیازمند بررسی انسانی» و Disclaimer | ایمنی بیمار؛ اصل P1 | UI + Service | §2, §62 |
| BR-MED-02 | زنجیره الزمی نسخه: Expert 1 → Expert 2 → Doctor. هیچ پرشی مجاز نیست | دو بازبینی + تأیید نهایی | Workflow Guard | §2, §17 |
| BR-MED-03 | محصولات «نیازمند تأیید متخصص» فقط از مسیر پرونده/نسخه تأییدشده قابل خرید/عرضه‌اند؛ افزودن آن‌ها به سبد آزاد ممنوع | ایمنی دارویی | Checkout Guard | §66 |
| BR-MED-04 | اختلاف نظر Expert 1 و Expert 2 → ثبت Disagreement Flag روی رکورد Dataset + داوری اجباری Doctor (در v1 داوری همیشه اجباری است — ED-03) | شفافیت اختلاف؛ کیفیت Label | Service + Dataset | §12 |
| BR-MED-05 | Reject و Request Revision پزشک بدون کامنت اجباری مجاز نیست | پاسخ‌گویی بالینی | API Validation | §22 |
| BR-MED-06 | هیچ نسخه‌ای «بازنویسی» نمی‌شود؛ هر تغییر = Prescription Version جدید + تاریخچه کامل | Preservation (P4) | Service | §16 |
| BR-MED-07 | در محیط غیر-Production، هر خروجی AI باید برچسب SIMULATED/DEMO/NOT MEDICAL RESULT داشته باشد | عدم جعل (P7) | UI | §100 |
| BR-MED-08 | Outcome پیگیری (Improved/…) هرگز خودکار «برچسب حقیقت» نمی‌شود؛ باید Reviewed/Validated/Labelled شود | جلوگیری از خودآموزی خطرناک | Dataset Pipeline | §83 |
| BR-MED-09 | استقرار مدل AI نیازمند approval_status مثبت + ثبت metrics در رجیستری است | حاکمیت مدل | Admin AI Panel | §11 |
| BR-MED-10 | هر Prediction رکورد کامل نگاشت مدل دارد (model_id/version/dataset_version/preprocessing_version/timestamp/confidence/threshold) | ردیابی‌پذیری | AI Service | §61 |
| BR-MED-11 | Consent رضایت کاربر (Privacy/Terms) با نسخه و timestamp در ثبت‌نام ثبت می‌شود | انطباق | Auth Service | §59 |
| BR-MED-12 | Dashboard/گزارش‌های بالینی فقط با دسترسی نقش مربوطه قابل مشاهده‌اند | RBAC | API Guard | §5 |

### 1.2 گردش کار و صف (`BR-WF`)

| ID | قانون | دلیل | نقطه اعمال | مرجع |
|---|---|---|---|---|
| BR-WF-01 | فقط Transitionهای تعریف‌شده در ماتریس §4 مجازند؛ هر درخواست غیرمجاز = خطای 403 + Audit | کنترل چرخه | caseService Guard | §17 |
| BR-WF-02 | هر Transition باید Actor/Timestamp/Previous/New/Reason/Comment ثبت کند (CaseEvent) | Traceability | Service + DB | §17, §41 |
| BR-WF-03 | Claim پرونده اتمیک است: فقط اولین Claim موفق؛ سایرین «قبلاً Claim شده» دریافت می‌کنند | جلوگیری از Double-Claim | Transaction/Unique | §18, §79 |
| BR-WF-04 | Reassign فقط توسط Admin/Operator و با Reason انجام می‌شود | جلوگیری از دور زدن صف | API Guard | §18 |
| BR-WF-05 | Doctor Revision پرونده را به WAITING_FOR_EXPERT_2 برمی‌گرداند (نه به کارشناس اول)؛ چرخه اصلاح از داوری دوم | کاهش رفت‌وبرگشت | Transition Matrix | §22 |
| BR-WF-06 | Timeline پرونده از CaseEventها ساخته می‌شود و تنها منچه نمایش تاریخچه است | یک منبع حقیقت | UI | §41 |
| BR-WF-07 | Cancellation فقط از وضعیت‌های مجاز (§4) و با Reason اجباری؛ پرونده‌های CLOSED/CANCELLED ترمینال‌اند (بازگشت فقط از طریق Reassessment — ED-13) | جریان منطقی | Guard | §17 |
| BR-WF-08 | ثبت تحویل = انتقال به DELIVERED + فعال‌سازی Follow-up زمان‌بندی‌شده | اتصال چرخه | Service | §1, §33 |
| BR-WF-09 | هر Gate تأیید (G1..G6 در PRD §8) توقف اجباری است؛ عبور خودکار ممنوع | رضایت صریح ذی‌نفعان | Workflow | §1 |
| BR-WF-10 | وضعیت‌های انتظارکاربر SLA دارند (ED-08): یادآوری در ۷۲ ساعت بی‌اقدامی؛ Auto-close در ۳۰ روز با مسیر Reassessment | جلوگیری از قیف رهاشده | Scheduler | ED-08 |

### 1.3 مالی و پرداخت (`BR-FIN`)

| ID | قانون | دلیل | نقطه اعمال | مرجع |
|---|---|---|---|---|
| BR-FIN-01 | هر عملیات پرداخت Idempotent است: Payment ID / Authority مرجع یکتا؛ Callback/Retry تکراری فقط Log می‌سازد نه تغییر وضعیت | جلوگیری از پرداخت/سفارش تکراری | Payment Service | §27, §56 |
| BR-FIN-02 | کارت‌به‌کارت فقط با تأیید Operator معتبر می‌شود (Approve/Reject/Request-Info با Audit) | کنترل تقلب | Payment Verify API | §28 |
| BR-FIN-03 | تاریخچه قیمت‌ها Immutable است؛ هر تغییر قیمت (واحد/گروهی/Import) رکورد PriceHistory با Old→New و Actor می‌سازد | Preservation (P4) | Service + DB | §15, §65 |
| BR-FIN-04 | Import قیمت فقط با مسیر Validate → Preview → Confirm (اتمیک) انجام می‌شود؛ خطای ردیف رکورد را رد می‌کند نه کل Batch را خراب | امنیت داده | Admin Import API | §15 |
| BR-FIN-05 | Refund نیازمند Reason اجباری + Audit؛ وضعیت Payment و Order به REFUNDED می‌رود | پاسخ‌گویی مالی | Service | §34, §35 |
| BR-FIN-06 | واحد پول تومان با عدد صحیح است؛ عملیات ریالی/اعشاری ممنوع | جلوگیری از خطای گرد‌کردن | Domain Type | ED-11 |
| BR-FIN-07 | Invoice بعد از Payment Confirm غیرقابل ویرایش است؛ اصلاح = صدور سند اصلاحی جدید مرتبط | صحت اسناد مالی | Service | §47 |
| BR-FIN-08 | Discount/Coupon فقط با ثبت Actor/Reason/Amount در فاکتور اعمال می‌شود و در Audit دیده می‌شود | شفافیت تخفیف | Checkout | §24, §65 |
| BR-FIN-09 | قیمت ملاک Proforma، قیمت لحظه صدور است؛ تغییرات بعدی Proforma را عوض نمی‌کند | ثبات انتظار بیمار | Service | ED-05 |
| BR-FIN-10 | هزینه ارسال خط جداگانه Proforma/Invoice است و از قیمت اقلام مستقل محاسبه می‌شود | صحت اسناد | Invoice Builder | §29 |
| BR-FIN-11 | همه رویدادهای مالی FinancialTransaction ثبت می‌کنند (In/Out) تا سود تقریبی قابل محاسبه باشد | گزارش دقیق | Service | §34, §47 |

### 1.4 داده، حریم خصوصی و امنیت (`BR-PRV`)

| ID | قانون | دلیل | نقطه اعمال | مرجع |
|---|---|---|---|---|
| BR-PRV-01 | Soft Delete فقط: `deleted_at` + وضعیت Active/Inactive؛ Hard Delete ممنوع (مگر قواعد Retention حقوقی) | Preservation | ORM Global Filter | §48 |
| BR-PRV-02 | فایل‌های پزشکی فقط با Signed URL منقضی‌شونده (پیش‌فرض ≤ ۱۰ دقیقه) سرو می‌شوند؛ URL دائمی/Public ممنوع؛ اطلاعات سلامت در URL ممنوع | حریم پزشکی | Storage Layer | §44 |
| BR-PRV-03 | اطلاعات حساس (رمز، توکن، محتوای سلامت خام) در Logهای معمولی ثبت نمی‌شوند | ضد نشت داده | Logger Filter | §42, §88 |
| BR-PRV-04 | Consent (Privacy/Terms) با نسخه متن + timestamp ثبت؛ تغییر متن‌ها = نسخه جدید + درخواست Consent مجدد | انطباق | Auth + Admin | §59 |
| BR-PRV-05 | درخواست Export/Delete داده کاربر گردش کار Admin دارد و نتیجه Audit می‌شود | حقوق داده | Privacy Workflow | §59 |
| BR-PRV-06 | ورود داده به Dataset فقط پس از De-identification مجاز است | ناشناس‌سازی | Data Pipeline | §11 |
| BR-PRV-07 | داده واقعی بیمار هرگز در Seed/Dev/Repo نیست | ضد افشا | Seed Policy | §73 |
| BR-PRV-08 | قفل حساب بعد از ۵ تلاش ناموفق ورود؛ ثبت زمان/IP؛ باز شدن با تماس Admin یا تأخیر | Brute-Force | Auth Service | §43 |
| BR-PRV-09 | Rate Limit طبق کاتالوگ: Login 10/min/IP · Upload 20/h/user · Payment 10/min/user · Ticket 20/day/user · API عمومی 100/min/token | پایداری | Middleware | §89 |
| BR-PRV-10 | مشاهده پرونده پزشکی (View Medical File) همیشه Audit می‌شود با User/IP/Device | ردیابی سوءاستفاده | API Middleware | §42 |
| BR-PRV-11 | Dataset Split بیمار-محور است؛ تصاویر یک بیمار هم‌زمان در Train و Test ممنوع | ضد Leakage | MLOps Pipeline | §63 |
| BR-PRV-12 | Retention Policy قابل تنظیم است ولی حذف خودکار داده پزشکی تا تأیید حقوقی غیرفعال می‌ماند | ممنوعیت حذف بی‌ضابطه | Admin Setting | §91 |

### 1.5 کاتالوگ و محتوا (`BR-CAT`)

| ID | قانون | دلیل | نقطه اعمال | مرجع |
|---|---|---|---|---|
| BR-CAT-01 | Disease و Product نام فارسی + انگلیسی + کد یکتا دارند؛ کد تکراری ممنوع | یکتایی مرجع | Schema Unique | §13, §14 |
| BR-CAT-02 | غیرفعال‌سازی Disease/Product فقط آن را از جستجو/نسخه جدید حذف می‌کند؛ تاریخچه سالم می‌ماند | Preservation | Soft Delete | §13 |
| BR-CAT-03 | پرسشنامه Versioning-دار؛ پاسخ‌ها به Questionnaire Version خود متصل‌اند؛ نتایج قدیمی هرگز حذف/بازنویسی نمی‌شوند | صحت داده طولی | Service | §7 |
| BR-CAT-04 | Excel/CSV Import قیمت: اعتبارسنجی فایل + ستون‌ها + مقادیر؛ گزارش خطای ردیفی؛ Preview؛ Commit اتمیک؛ ثبت PriceHistory | امنیت داده گروهی | Admin Import | §15 |
| BR-CAT-05 | قیمت صفر یا منفی قابل ثبت نیست؛ Bulk ±X% محدوده مجاز ۹۹٪- دارد | سلامت داده | Validation | §15 |
| BR-CAT-06 | موجودی صفر = غیرقابل افزودن به سبد/نسخه (قابل نمایش) | انتظار درست | Checkout/Prescription | §14 |
| BR-CAT-07 | محصولات OTC با فلگ جدا تعریف می‌شوند؛ فلگ فقط توسط Admin تغییر می‌کند | ایمنی خرید آزاد | Admin | §66 |

### 1.6 جستجو، زبان و تقویم (`BR-I18N`)

| ID | قانون | دلیل | نقطه اعمال | مرجع |
|---|---|---|---|---|
| BR-I18N-01 | جستجوی فارسی قبل از تطبیق Normalize می‌شود: ی/ي، ک/ك، اعداد فارسی↔انگلیسی، ZWNJ، توکن‌سازی | تجربه جستجوی واقعی | Search Service | §25 |
| BR-I18N-02 | UI فارسی = RTL + تقویم شمسی؛ UI انگلیسی = LTR + میلادی؛ ذخیره‌سازی UTC timezone-aware | دوزبانگی صحیح | i18n + Jalali | §39, §69 |
| BR-I18N-03 | هیچ متن UI Hardcode نیست؛ همه رشته‌ها از منابع i18n | قابلیت توسعه زبان | Lint/Review | §69 |

### 1.7 اعلان و ارتباطات (`BR-NTF`)

| ID | قانون | دلیل | نقطه اعمال | مرجع |
|---|---|---|---|---|
| BR-NTF-01 | هر رخداد کاتالوگ PRD §7 باید حداقل اعلان In-app بسازد؛ SMS طبق Criticality | اطمینان از رسیدن پیام | Notify Engine | §31 |
| BR-NTF-02 | همه پیامک‌ها در SMSLog با وضعیت/خطا ثبت می‌شوند؛ شکست SMS جریان اصلی را نمی‌شکند | مشاهده‌پذیری | Notify Engine | §32, §56 |
| BR-NTF-03 | Reminder Follow-up در روز سررسید به Patient و Operator ارسال می‌شود | پیوستگی درمان | Scheduler | §33 |
| BR-NTF-04 | اعلان‌های بالینی (نتیجه/نسخه/رد پرداخت) دوزبانه ثبت می‌شوند تا کاربر با زبان خود بخواند | تجربه | Template | §31 |

### 1.8 تصویر پزشکی و کیفیت (`BR-IMG`)

| ID | قانون | دلیل | نقطه اعمال | مرجع |
|---|---|---|---|---|
| BR-IMG-01 | هر تصویر پیش از تحلیل AI باید Quality Gate بگذرد (Blur/Brightness/Exposure/Resolution/Orientation)؛ رد = پیام علت فارسی + راهنما + امکان Retry | کیفیت ورودی مدل؛ تجربه کاربر | Image Pipeline | §8 |

### 1.9 حسابرسی و تاریخچه (`BR-AUD`, `BR-HIST`)

| ID | قانون | دلیل | نقطه اعمال | مرجع |
|---|---|---|---|---|
| BR-AUD-01 | هر عمل حساس (لیست §42 Master Prompt) باید Audit کامل ثبت کند: User، IP، Device، Timestamp، Action، Entity، Old Value، New Value | پاسخ‌گویی کامل | API Middleware + Service | §42 |
| BR-HIST-01 | هیچ تاریخچه داده مهم (نسخه، نتیجه پرسشنامه، قیمت، تراکنش، تشخیص) حذف یا بازنویسی نمی‌شود؛ تغییر همیشه رکورد جدید است | Preservation (P4) | Service Layer | §7, §15, §16 |

---

## §2 — ماتریس RBAC (نقش × دسترسی)

قواعد شماره‌دار حاکم بر ماتریس:

| ID | قانون | مرجع |
|---|---|---|
| BR-RBAC-01 | اعمال واقعی Permission همیشه سمت Server است؛ Frontend فقط برای نمایش/مخفی‌سازی استفاده می‌شود (ممنوعیت Permission Hardcoded در Frontend) | §5 |
| BR-RBAC-02 | Admin مجموعه کامل دسترسی‌ها را دارد (Super-set) اما عملیات حساسش مشمول Audit است | §5, §42 |
| BR-RBAC-03 | Patient مالک داده خود است: همه کوئری‌های بیمار با مالکیت فیلتر می‌شوند؛ دسترسی به پرونده دیگران = 403 + Audit | §6, §44 |
| BR-RBAC-04 | تخصیص/تغییر نقش فقط توسط Admin با Audit؛ هر کاربر یک نقش فعال دارد (ED-26) | §5, ED-26 |

سیستم **Role-Based + Permission-Based** است؛ نقش‌ها مجموعه‌ای از Permissionها دارند (قابل ویرایش توسط Admin). Patient دسترسی سازمانی ندارد؛ مالکیت داده‌اش ملاک است (Ownership Guard — BR-RBAC-03).

۳۱ Permission تعریف‌شده:

`view_patients` · `edit_patients` · `view_images` · `view_medical_files` · `view_queue` · `claim_cases` · `expert1_assessment` · `create_prescription` · `edit_prescription` · `expert2_review` · `send_to_doctor` · `approve_prescription` · `create_invoice` · `view_financials` · `verify_payment` · `manage_prices` · `manage_products` · `manage_diseases` · `manage_users` · `manage_questionnaire` · `view_reports` · `manage_tickets` · `manage_orders` · `manage_shipments` · `view_audit_logs` · `view_ai_analyses` · `manage_ai_models` · `view_all_cases` · `manage_followups` · `view_dashboard_stats` · `view_sms_log`

| Permission | ADMIN | EXPERT_1 | EXPERT_2 | DOCTOR | OPERATOR | PATIENT |
|---|---|---|---|---|---|---|
| view_patients | ✅ | ✅ | ✅ | ✅ | ✅ | — (فقط خود) |
| edit_patients | ✅ | — | — | — | — | — (خود: فرم محدود) |
| view_images | ✅ | ✅ | ✅ | ✅ | — | — (فقط خود) |
| view_medical_files | ✅ | ✅ | ✅ | ✅ | ✅ | — (فقط خود) |
| view_queue | ✅ | ✅ | ✅ | ✅ | — | — |
| claim_cases | ✅ | ✅ | ✅ | — | ✅ | — |
| expert1_assessment | ✅ | ✅ | — | — | — | — |
| create_prescription | ✅ | ✅ | — | — | — | — |
| edit_prescription | ✅ | ✅ | ✅ | — | — | — |
| expert2_review | ✅ | — | ✅ | — | — | — |
| send_to_doctor | ✅ | — | ✅ | — | — | — |
| approve_prescription | ✅ | — | — | ✅ | — | — |
| create_invoice | ✅ | — | ✅ | — | ✅ | — |
| view_financials | ✅ | — | ✅ | — | ✅ | — |
| verify_payment | ✅ | — | — | — | ✅ | — |
| manage_prices | ✅ | — | — | — | ✅ | — |
| manage_products | ✅ | — | — | — | ✅ | — |
| manage_diseases | ✅ | — | — | — | — | — |
| manage_users | ✅ | — | — | — | — | — |
| manage_questionnaire | ✅ | — | — | — | — | — |
| view_reports | ✅ | ✅ | ✅ | — | ✅ | — |
| manage_tickets | ✅ | — | — | — | ✅ | — (تیکت خود) |
| manage_orders | ✅ | — | ✅ | — | ✅ | — (سفارش خود) |
| manage_shipments | ✅ | — | ✅ | — | ✅ | — (مشاهده خود) |
| view_audit_logs | ✅ | — | — | — | — | — |
| view_ai_analyses | ✅ | ✅ | ✅ | ✅ | — | — (خروجی پرونده خود) |
| manage_ai_models | ✅ | — | — | — | — | — |
| view_all_cases | ✅ | ✅ | ✅ | ✅ | ✅ | — (فقط پرونده خود) |
| manage_followups | ✅ | ✅ | — | — | ✅ | — |
| view_dashboard_stats | ✅ | — | — | — | ✅ | — (داشبورد خود) |
| view_sms_log | ✅ | — | — | — | ✅ | — |

**قواعد مکمل RBAC:**

1. Admin تمام دسترسی‌ها را دارد (Super-set) اما عملیات حساسش همچنان Audit می‌شود.
2. Permission در Frontend فقط برای «نمایش/مخفی‌سازی» استفاده می‌شود؛ **اعمال واقعی همیشه سمت Server** است (قانون «بدون Permission Hardcoded در Frontend» — §5).
3. مالکیت Patient: همه کوئری‌های بیمار با `userId = session.user` فیلتر می‌شوند؛ دسترسی به پرونده دیگران = 403 + Audit.
4. نقش یکتا: هر کاربر یک Role فعال دارد (ED-26).

---

## §3 — کاتالوگ وضعیت‌ها (State Catalog)

### 3.1 وضعیت پرونده (MedicalCase) — ۲۱ وضعیت

| وضعیت | شرح فارسی | نقطه ورود | خروجی‌های مجاز |
|---|---|---|---|
| NEW | پرونده جدید | ایجاد Case | → WAITING_FOR_EXPERT_1 |
| WAITING_FOR_EXPERT_1 | در صف کارشناس اول | پس از NEW | → EXPERT_1_REVIEW (Claim) |
| EXPERT_1_REVIEW | بررسی کارشناس اول | Claim موفق | → WAITING_FOR_USER_APPROVAL |
| WAITING_FOR_USER_APPROVAL | در انتظار تأیید بیمار (G1) | ارسال ارزیابی | → WAITING_FOR_EXPERT_1_PRESCRIPTION / CLOSED |
| WAITING_FOR_EXPERT_1_PRESCRIPTION | در انتظار نسخه E1 | تأیید بیمار | → WAITING_FOR_EXPERT_2 |
| WAITING_FOR_EXPERT_2 | در صف کارشناس دوم | ثبت نسخه E1 | → WAITING_FOR_DOCTOR |
| REVISION_REQUESTED | اصلاح درخواست‌شده (از Doctor) | Doctor Revision | → WAITING_FOR_EXPERT_2 (نسخه جدید) |
| WAITING_FOR_DOCTOR | در انتظار پزشک (G3) | ارسال E2 | → PRESCRIPTION_APPROVED / CLOSED / REVISION |
| PRESCRIPTION_APPROVED | نسخه تأیید شد | Approve پزشک | → PROFORMA_CREATED |
| PREPARING_ORDER | آماده‌سازی سفارش | پس از Approve | → PROFORMA_CREATED |
| PROFORMA_CREATED | پیش‌فاکتور صادر شد (G4) | صدور Proforma | → WAITING_FOR_PAYMENT / CANCELLED |
| WAITING_FOR_USER_CONFIRMATION | تأیید پیش‌فاکتور | ارسال به بیمار | → WAITING_FOR_PAYMENT / CANCELLED |
| WAITING_FOR_PAYMENT | در انتظار پرداخت (G5/G6) | تأیید Proforma | → PAYMENT_CONFIRMED / FAILED→Retry |
| PAYMENT_CONFIRMED | پرداخت تأیید شد | Verify موفق | → PREPARING_SHIPMENT |
| PREPARING_SHIPMENT | آماده‌سازی ارسال | شروع ارسال | → SHIPPED |
| SHIPPED | ارسال شد | ثبت ارسال | → DELIVERED |
| DELIVERED | تحویل شد | ثبت تحویل | → FOLLOW_UP |
| FOLLOW_UP | پیگیری درمان | فعال‌سازی FUP | → REFERRED_AGAIN / CLOSED |
| REFERRED_AGAIN | ارجاع مجدد | شروع چرخه جدید | → NEW (پرونده جدید Lineage-دار) |
| CLOSED | بسته (ترمینال) | رد G1 / Doctor / اتمام | — (بازگشت فقط Reassessment) |
| CANCELLED | لغو (ترمینال) | رد Proforma/انصراف | — (بازگشت فقط پرونده جدید) |

### 3.2 وضعیت سفارش (Order) — ۱۱ وضعیت

`CART → PENDING_CONFIRMATION → CONFIRMED → PAYMENT_PENDING → PAID → PREPARING → READY_TO_SHIP → SHIPPED → DELIVERED` + ترمینال‌های `CANCELLED`, `REFUNDED`

### 3.3 وضعیت پرداخت (Payment) — ۶ وضعیت

`PENDING` (آغاز/درگاه) · `AWAITING_VERIFY` (کارت‌به‌کارت در انتظار اپراتور) · `PAID` · `FAILED` (درگاه/خطا) · `REJECTED` (رد رسید) · `REFUNDED`

### 3.4 وضعیت تیکت (Ticket) — ۶ وضعیت

`OPEN → IN_PROGRESS → (WAITING_USER ↔ WAITING_EXPERT) → RESOLVED → CLOSED`

### 3.5 سایر موجودیت‌های وضعیت‌دار

| موجودیت | وضعیت‌ها |
|---|---|
| User | ACTIVE · INACTIVE · LOCKED (قفل Brute-Force) |
| Disease | ACTIVE · INACTIVE (Soft) |
| Product | ACTIVE · INACTIVE (Soft) + موجودی عددی + فلگ OTC |
| Questionnaire | ACTIVE · ARCHIVED + Version ordinal |
| AIModel | REGISTERED · PENDING_APPROVAL · DEPLOYED · RETIRED + metrics JSON |
| DatasetEntry (Label) | UNREVIEWED · REVIEW_PENDING · APPROVED · REJECTED + Disagreement Flag |
| Shipment | PREPARING · SHIPPED · DELIVERED (+ علت خطا/بازگشت) |
| FollowUp | SCHEDULED · DUE · OVERDUE · COMPLETED (+ Outcome) |
| Referral | ACTIVE · SETTLED (تسویه) |
| Prescription | DRAFT · ACTIVE (تأیید نهایی) · SUPERSEDED (نسخه جدید جایگزین کرد) — هر نسخه با عدد Version |
| Invoice | ISSUED (Proforma) · CONFIRMED · PAID · CANCELLED · REFUNDED |
| FinancialTransaction | INCOME · EXPENSE · REFUND · COMMISSION |

---

## §4 — موتور Workflow: جدول انتقال‌های مجاز (۱۹ Transition)

| # | Action | From | To | نقش مجاز | Permission | Side-Effects |
|---|---|---|---|---|---|---|
| T1 | CLAIM | WAITING_FOR_EXPERT_1 | EXPERT_1_REVIEW | EXPERT_1 | claim_cases | Assign اتمیک + Notify |
| T2 | SUBMIT_ASSESSMENT | EXPERT_1_REVIEW | WAITING_FOR_USER_APPROVAL | EXPERT_1 | expert1_assessment | ثبت Diagnosis + Notify Patient (G1) |
| T3 | USER_APPROVE | WAITING_FOR_USER_APPROVAL | WAITING_FOR_EXPERT_1_PRESCRIPTION | PATIENT | — | Notify Expert 1 |
| T4 | USER_DECLINE | WAITING_FOR_USER_APPROVAL | CLOSED | PATIENT | — | Reason اجباری + Notify |
| T5 | SUBMIT_PRESCRIPTION | WAITING_FOR_EXPERT_1_PRESCRIPTION / REVISION_REQUESTED | WAITING_FOR_EXPERT_2 | EXPERT_1 | create_prescription | نسخه جدید + Notify E2 |
| T6 | EXPERT2_REVIEW | WAITING_FOR_EXPERT_2 | WAITING_FOR_DOCTOR | EXPERT_2 | expert2_review | قیمت/اقلام + Notify Doctor (G3) |
| T7 | DOCTOR_APPROVE | WAITING_FOR_DOCTOR | PRESCRIPTION_APPROVED | DOCTOR | approve_prescription | نسخه ACTIVE + Follow-up پیشنهادی |
| T8 | DOCTOR_REJECT | WAITING_FOR_DOCTOR | CLOSED | DOCTOR | approve_prescription | کامنت اجباری + Notify |
| T9 | DOCTOR_REVISION | WAITING_FOR_DOCTOR | WAITING_FOR_EXPERT_2 (REVISION) | DOCTOR | approve_prescription | کامنت اجباری + Notify E2 |
| T10 | CREATE_PROFORMA | PRESCRIPTION_APPROVED / PREPARING_ORDER | PROFORMA_CREATED | EXPERT_2 / OPERATOR | create_invoice | Invoice ISSUED + Notify Patient (G4) |
| T11 | CONFIRM_PROFORMA | PROFORMA_CREATED / WAITING_FOR_USER_CONFIRMATION | WAITING_FOR_PAYMENT | PATIENT | — | Notify Operator |
| T12 | REJECT_PROFORMA | PROFORMA_CREATED / WAITING_FOR_USER_CONFIRMATION | CANCELLED | PATIENT | — | Reason + Notify |
| T13 | MARK_PAID (Gateway) | WAITING_FOR_PAYMENT | PAYMENT_CONFIRMED | SYSTEM (زرین‌پال Verify) | — | Idempotent + Invoice PAID + Notify |
| T14 | VERIFY_RECEIPT (Manual) | WAITING_FOR_PAYMENT (AWAITING_VERIFY) | PAYMENT_CONFIRMED | OPERATOR | verify_payment | Audit + Notify |
| T15 | START_SHIPPING | PAYMENT_CONFIRMED | PREPARING_SHIPMENT → SHIPPED | OPERATOR | manage_shipments | ثبت Shipment + Tracking + Notify |
| T16 | MARK_DELIVERED | SHIPPED | DELIVERED | OPERATOR | manage_shipments | مدرک تحویل + Notify + فعال‌سازی FUP |
| T17 | SCHEDULE_FOLLOWUP | DELIVERED | FOLLOW_UP | DOCTOR / EXPERT_1 | — | FollowUp SCHEDULED |
| T18 | COMPLETE_FOLLOWUP | FOLLOW_UP | CLOSED | OPERATOR | manage_followups | ثبت Outcome + Notify |
| T19 | REFER_AGAIN | FOLLOW_UP / CLOSED | REFERRED_AGAIN → پرونده جدید NEW | PATIENT / OPERATOR | — | Lineage پرونده + Notify |

> هر Transition مطابق BR-WF-02 رکورد CaseEvent با Actor/Time/Old/New/Reason/Comment ثبت می‌کند. وضعیت NEW → WAITING_FOR_EXPERT_1 هنگام ایجاد پرونده خودکار است (T0 ضمنی).

---

## §5 — تصمیمات مهندسی (Engineering Decisions)

هر ED یک ابهام واقعی در Master Prompt را حل می‌کند. فرمت: ابهام → تصمیم → دلیل → پیامدها. این تصمیمات **قطعی و الزامی برای فازهای بعدی** هستند؛ بازنگری فقط با ثبت ED جدید.

| ID | ابهام | تصمیم | دلیل | مرجع |
|---|---|---|---|---|
| ED-01 | نقش دقیق AI در تصمیم؟ | AI صرفاً CDS است: پیشنهاد + Confidence + Explainability؛ نتیجه نهایی فقط با زنجیره انسانی | §2 صریح است؛ ایمنی بیمار | §2 |
| ED-02 | آیا بازبینی Expert 2 همیشه لازم است؟ | **بله — همیشه.** قاعده «دو کارشناس» برای هر نسخه | کاهش خطا؛ ساده و ایمن برای v1 | §1, §21 |
| ED-03 | پزشک چه زمانی وارد می‌شود («در موارد تعیین‌شده» §2)؟ | v1: **همه پرونده‌ها** به پزشک می‌روند (محافظه‌کارانه). معماری امکان Routing سیاست‌محور (Controlled items / Confidence پایین / Disagreement) را در آینده حفظ می‌کند | ابهام «موارد تعیین‌شده» با ساده‌ترین قاعده ایمن حل شد | §2, §22 |
| ED-04 | چه کسی Proforma می‌سازد؟ (§21 Expert 2، §20 Operator) | هر دو: Permission `create_invoice` به EXPERT_2 و OPERATOR؛ Audit مشخص می‌کند چه کسی | سازگار با هر دو بخش | §20, §21 |
| ED-05 | قیمت کدام لحظه ملاک است؟ | قیمت لحظه صدور Proforma؛ تغییرات بعدی اثر ندارد؛ تاریخچه قیمت برای شفافیت | ثبات انتظار بیمار | §15 |
| ED-06 | تهیه «ناقص» داروها یعنی چه؟ | E2 اقلام را موجود/ناقص علامت می‌زند؛ Proforma فقط اقلام موجود؛ اقلام ناقص با پیشنهاد جایگزین به بیمار اطلاع داده می‌شود؛ ادامه منوط به تأیید Proforma است | §1 مبهم؛ این تصمیم انتظار بیمار را روشن می‌کند | §1, §21 |
| ED-07 | داروهای نسخه‌ای چگونه خریداری می‌شوند؟ | فقط Case-attached (از Proforma پرونده)؛ OTC در فروشگاه آزاد | §66 و ایمنی دارویی | §66 |
| ED-08 | اگر بیمار Gate تأیید/پرداخت را رها کند؟ | SLA انتظار: یادآوری خودکار ۷۲h؛ اعلان تکراری ۷ روز؛ Auto-close/Cancel در ۳۰ روز با Reason سیستمی؛ بیمار می‌تواند با Reassessment چرخه جدید شروع کند | قیف رهاشده نباید صف را مسدود کند | §18 |
| ED-09 | مدل امتیازدهی مزاج؟ | امتیاز تجمعی چهار بُعد (گرم/سرد/خشک/تر)؛ غلبه بُعد = برچسب آن بُعد؛ اختلاف کم از آستانه = BALANCED؛ جزئیات امتیاز ذخیره می‌شود | §7 الگو می‌دهد ولی مدل را نمی‌دهد | §7 |
| ED-10 | قواعد کمیسیون معرف؟ | v1: ردیابی کامل درآمد/سفارش هر معرف؛ نرخ کمیسیون قابل تنظیم Admin، پیش‌فرض غیرفعال (۰٪)؛ پرداخت = ثبت Expense نوع COMMISSION | §36 نرخ را تعیین نکرده | §36 |
| ED-11 | واحد پول و تقویم؟ | تومان (عدد صحیح)؛ ذخیره UTC timezone-aware؛ نمایش شمسی در FA | §39 + بازار ایران | §39 |
| ED-12 | شناسه کاربر؟ | شماره موبایل ایرانی (منحصربه‌فرد) + رمز؛ ایمیل اختیاری؛ OTP آینده | A1 | §6 |
| ED-13 | بازگشت بیمار پس از بستن پرونده؟ | Reassessment = پرونده NEW جدید با Lineage (ارجاع به پرونده قبلی)؛ تاریخچه کامل در دسترس است | حالت REFERRED_AGAIN معنای واقعی پیدا می‌کند | §1, §17 |
| ED-14 | دسترسی تصاویر؟ | فقط Signed URL با انقضا ≤ ۱۰ دقیقه + Authorization + Audit هر مشاهده | §44 | §44 |
| ED-15 | نمایش نتایج در Demo؟ | برچسب SIMULATED/DEMO در همه خروجی AI محیط غیر-Production | §100 | §100 |
| ED-16 | حل اختلاف کارشناسان؟ | Disagreement Flag خودکار + داوری اجباری Doctor (در v1 همیشه Doctor می‌بیند) | ساده و ایمن | §12 |
| ED-17 | کانال اعلان و شکست آن؟ | In-app منبع رکورد است؛ SMS تلاش می‌شود و در SMSLog ثبت؛ شکست = Retry با Backoff؛ Email فاز بعد؛ Push معماری‌پذیر | تضمین ثبت پیام مستقل از موفقیت ارسال | §31, §32 |
| ED-18 | مسیر تیکت‌ها؟ | پیش‌فرض: تیکت‌های عملیاتی → Operator؛ دسته بالینی → ارجاع به Expert/Doctor توسط Operator | ساده؛ قابل تنظیم | §30 |
| ED-19 | دستورالعمل صوتی کارشناس؟ | v1: متن کامل + ساختار؛ صوت = قابلیت Phase 06 (پیوست فایل صوتی از همان خط لوله فایل) — **Mock نمی‌شود** (اصل §96) | §19 آن را اختیاری می‌خواهد | §19 |
| ED-20 | Refund؟ | عملیات مالی مستقل از وضعیت بالینی؛ Reason اجباری؛ Payment+Order → REFUNDED؛ FinancialTransaction REFUND ثبت می‌کند | تفکیک پول از بالین | §34 |
| ED-21 | سن و کد ملی؟ | سن = محاسبه از تاریخ تولد (ذخیره نمی‌شود)؛ کد ملی اختیاری، فقط با سیاست امنیتی (رمزنگاری در سکون + دسترسی محدود) | حداقل‌سازی داده (Privacy by Design) | §6 |
| ED-22 | Multi-Tenant؟ | v1 تک‌سازمانی؛ Schema طوری طراحی می‌شود که افزودن `orgId` بعدی Refactor اساسی نخواهد (آمادگی، نه پیاده‌سازی) | §68 | §68 |
| ED-23 | موتور جستجو؟ | v1: جستجوی Normalized روی DB؛ PostgreSQL FTS/ES فقط وقتی Scale ایجاب کند (دلیل فنی ثبت شود) | «پیچیدگی غیرضروری نه» | §67 |
| ED-24 | ویرایش هم‌زمان نسخه؟ | Optimistic: هر Save = Version جدید؛ نسخه‌های قبلی Immutable؛ تضاد عملی وجود ندارد | §16 + §79 | §16, §79 |
| ED-25 | استک فنی؟ | مرجع Master Prompt §3: FastAPI+React+PostgreSQL+Celery. **وضعیت فعلی:** پیاده‌سازی v1 با Next.js یکپارچه (App Router + API Routes + Prisma) با رعایت لایه‌بندی Service + Interfaceهای تعویض‌پذیر (AIModelProvider، PaymentProvider، Storage). **تصمیم:** نیازمندی‌های این PRD عمداً Stack-agnostic نوشته شدند؛ تصمیم نهایی معماری Production (ادامه Unified در برابر مهاجرت به استک مرجع) در فاز 02 ARCHITECTURE.md با تحلیل Load/Team ثبت می‌شود | اصل §97: تصمیم + ثبت + عدم توقف | §3 |
| ED-26 | چند نقش برای یک کاربر؟ | یک نقش فعال؛ نیازمندی چندنقشی ثبت نشد — افزودن آن تغییر Schema + ماتریس است | سادگی v1 | §5 |
| ED-27 | شماره‌گذاری اسناد؟ | Case: `BH-` (پسوند قدیمی TC- در داده Seed توسعه تلورانس دارد — پاکسازی فاز 02) · Order: `ORD-` · Invoice: `INV-` · Tracking: `TRK-` + طول ثابت | خوانایی و ردیابی | — |
| ED-28 | ترتیب کانال پرداخت؟ | پیش‌فرض: درگاه (زرین‌پال)؛ کارت‌به‌کارت مسیر جایگزین است (نه برعکس)؛ انتخاب با بیمار | اطلاع‌رسانی و آسانی | §27, §28 |
| ED-29 | ادامه مسیر وقتی AI شکست بخورد؟ | ثبت Error + Retry محدود؛ پرونده بدون تحلیل AI هم می‌تواند توسط کارشناس ادامه یابد (AI پیشنهاد است نه پیش‌نیاز) | Resilience | §56 |
| ED-30 | اعتبار Proforma؟ | ۷ روز (قابل تنظیم)؛ انقضا = اطلاع بیمار + نیاز صدور مجدد (قیمت جدید طبق ED-05) | جلوگیری از قیمت کهنه | §15 |
| ED-31 | معماری Workflow؟ | موتور عمومی + ماشین‌های اعلانی داده‌محور در `src/lib/workflow/`؛ افزودن ماشین = فایل + ثبت در Registry بدون تغییر موتور | الزام «Hardcode نکن» فاز ۰۲ | §17 |
| ED-32 | Event Log ماشین‌ها؟ | AuditLog با الگوی `WORKFLOW_<ENTITY>_<ACTION>` (اتمیک با Transition) برای همه؛ CaseEvent فقط برای تایم‌لاین CASE | بدون Migration جدول جدید؛ یک منبع رخداد | §17, §42 |
| ED-33 | Cascade چند-موجودیتی؟ | «نویسنده واحد»: پرداخت Cascade اتمیک کامل در تراکنش خودش؛ SHIPMENT فقط ORDER؛ پیشرفت CASE فقط توسط ماشین CASE | حذف Double-Transition و هم‌نویسی | §17, §27 |
| ED-34 | وضعیت NEW و تعداد Transition؟ | NEW مجازی است (ایجاد مستقیم در WAITING_FOR_EXPERT_1؛ ۱۸ Transition واقعی — اصلاح شمارش فاز ۰۱)؛ MARK_DELIVERED از PAYMENT_CONFIRMED/PREPARING_SHIPMENT هم مجاز (مسیر تحویل مستقیم) | تطبیق با رفتار واقعی کد | §17 |
| ED-35 | سبک معماری کل؟ | **Modular Monolith** (ارزیابی ۱۰-معیاری، ۸ به نفع MM)؛ Microservices «افق معیارمحور» + ۵ قاعده Extraction-Readiness (ER1..ER5) | تیم کوچک C1؛ Cascade اتمیک C2؛ Ops ساده | ADR-0001 |
| ED-36 | مرزبندی دامنه؟ | ۱۵ Bounded Context در `src/modules/` با ساختار api/domain/infra/events + مدل Tier وابستگی K→T0..T5 + قواعد D1..D8 ⇒ گراف DAG و چرخه ناممکن | مرز آماده Extraction؛ مالکیت داده صریح | ADR-0002 |
| ED-37 | Frontend/Backend یکجا یا جدا؟ | یک Deployable `web` (Next.js App Router: SPA + Route Handlers نازک) + Process جدا `worker` (یک Codebase، دو Entry Point) | یک Build/CI؛ اشتراک typeها؛ سازگار با Stage موجود | ADR-0003 |
| ED-38 | دیتابیس Production؟ | PostgreSQL 16 + Prisma + یک DB Schema به ازای Context؛ FK بین‌Schema ممنوع (Soft Reference)؛ SQLite فعلی = استثنای موقت با مسیر مهاجرت ۴-گامی | ACID برای Cascade؛ مرز فیزیکی مالکیت | ADR-0004 |
| ED-39 | Cache و Queue؟ | Redis 7 برای هر دو نقش؛ BullMQ؛ صف‌های ai/notify/sla/reporting + DLQ (N=5)؛ Delayed Jobs برای ED-08/ED-30؛ At-least-once + Idempotency | یک زیرساخت دو کاربرد (C1) | ADR-0005 |
| ED-40 | نگهداری فایلهای پزشکی؟ | Object Storage سازگار S3 (MinIO dev) + Bucket خصوصی `bh-medical` + Presigned URL کوتاه‌عمر + Audit صدور؛ Port `ObjectStorage` با Adapter local-fs/s3 | Replica-safe (Scale افقی)؛ P5 | ADR-0006 |
| ED-41 | جایگاه AI؟ | Service مستقل (Python/FastAPI) پشت Port `AIModelProvider` (موجود) با Adapterهای in-process/http؛ کاندیدای اول Extraction؛ تحلیل فقط از صف توسط worker | قید C3 (Scale GPU مستقل) | ADR-0007 |
| ED-42 | ارتباط بین Contextها؟ | Hybrid: **Sync Facade** برای ذات سیگنال (Cascade مالی) + **Domain Event** برای اثرات جانبی؛ نام‌گذاری `context.entity.verb-past`؛ Event-Carried Payload | سازگاری جایی که باید + جدایی جایی که می‌شود | ADR-0008 |
| ED-43 | تعویض Providerهای خارجی؟ | Ports & Adapters: PaymentGateway (زرین‌پال/کارت‌به‌کارت)، ShippingProvider (داخلی/پست/تیپاکس)، SmsProvider، ObjectStorage، AIModelProvider؛ انتخاب از Env؛ SDK فقط در infra | تعویض بدون جراحی دامنه؛ Mock/Log در dev با برچسب P7 | ADR-0009 |
| ED-44 | تضمین قواعد معماری؟ | چهار لایه Enforcement: ESLint no-restricted-imports → dependency-cruiser → architecture.test.ts (Tier+مالکیت مدل) → بازبینی PR؛ نقض = خطای Build؛ استثنا فقط با ثبت در فهرست بدهی | معماری خود-حفظ‌شونده (ریسک R1) | ADR-0010 |
| ED-45 | توپولوژی استقرار؟ | docker-compose: web/worker/postgres/redis/minio/ai/caddy؛ یک Image دو Entry Point؛ prod: Scale افقی Stateless (JWT)؛ Migration قبل از Deploy (Expand-Contract) | قید C4 (VSCode+Docker) | ADR-0011 |
| ED-46 | Observability؟ | JSON logging (pino) با requestId/jobId/correlationId (بدون داده سلامتی) + Prometheus metrics در web/worker/ai + آستانه‌های DLQ/Callback/Backlog؛ OTel-ready | اشکال‌زدایی صف/پرداخت/AI؛ پایه فاز Deployment | ADR-0012 |

| ED-47 | ابزار DDL در PostgreSQL؟ | Alembic (SQLAlchemy) مرجع یکتای Schema؛ Prisma فقط Introspection (db pull) در فاز بعد | فرمان صریح PHASE 04 + ADR-0013 | ADR-0013 |
| ED-48 | نوع PK؟ | BIGINT IDENTITY (نه UUID) — درج ترتیبی/ایندکس فشرده؛ Multi-Tenant آینده با tenant_id + RLS | §68 + Performance | DATABASE.md §2 |
| ED-49 | Soft-Delete فراگیر؟ | دامنه‌ای‌ها ✓؛ رکوردهای مالی/حقوقی (payments/invoices/expenses/ai_analyses) هیچ حذفی ندارند — فقط status | قوی‌تر از §48 | DATABASE.md §7 |
| ED-50 | اصلاح رکورد مالی؟ | قلم معکوس ADJUSTMENT در Ledger Append-Only — هرگز UPDATE | استاندارد حسابداری | DATABASE.md §8 |
| ED-51 | ENUM پستگرس؟ | نه — VARCHAR + CHECK؛ افزودن مقدار = Migration عادی قابل Rollback | تجربه ALTER TYPE غیرتراکنشی | DATABASE.md §2 |
| ED-52 | ContactLog کجا؟ | Context patients؛ کانال/جهت/نتیجه + Soft-Ref تیکت/پرونده | §47 بدون تعیین جایگاه | DATABASE.md §3 |
| ED-53 | بازبینی کارشناس/پزشک؟ | expert_reviews و doctor_reviews مستقل از Prescription — سابقه تصمیم حفظ می‌شود | فرمان Entity مستقل | DATABASE.md §3 |
| ED-54 | Inventory؟ | جدول 1:1 + inventory_movements دفتر خبری (علامت + balance_after)؛ منبع حقیقت Ledger | فرمان PHASE 04 + §14 | DATABASE.md §5 |
| ED-55 | پاسخ پرسشنامه نرمال؟ | جدول answers به‌جای JSON + UNIQUE(response, question) | §47 «Normalize» | DATABASE.md §3 |
| ED-56 | FK بین-Context؟ | ممنوع فیزیکی — Soft-Ref ایندکس‌دار + تست کاتالوگ | ADR-0004/D4 | DATABASE.md §4 |
| ED-57 | جستجوی فارسی؟ | GIN-trgm روی متن نرمال‌شده — نه FTS کامل تا نیاز واقعی | §67 | DATABASE.md §9 |
| ED-58 | جداول بزرگ Append-Only؟ | BRIN الان؛ Partitions هنگام >10M ردیف | قاعده ۱۵ مقیاس‌پذیری | DATABASE.md §12 |

| ED-59 | مدیریت Secret؟ | فقط Env: JWT_SECRET≥32 + FIELD_ENC_KEY 32B؛ Production fail-fast (بدون fallback هاردکد)؛ dev با Secret مشتق‌شده هشدار‌دار | قاعده ۶ منشور؛ بسته شدن fallback هاردکد | ADR-0014 |
| ED-60 | Rate Limit؟ | اسلایدینگ-ویندو درون-پروسه با presets (login 5/5m + IP 15/5m، OTP 3/10m، upload 20/m، export 1/day، register 5/h) + اینترفیس Redis برای Scale | ضد Brute-force/Spray/DoS لایه ۷ | ADR-0014 |
| ED-61 | CSRF؟ | Double-submit سراسری در Middleware (کوکی==هدر) + Origin/CORS allowlist؛ معاف واحد: callback درگاه (امضای درگاه) | Cookie-Auth SPA؛ پوشش بدون بازنویسی مسیرها | ADR-0014 |
| ED-62 | هدرهای امنیتی؟ | CSP (self + اجزای لازم) + XFO/nosniff/Referrer/Permissions/COOP + HSTS در prod؛ بدهی: مهاجرت nonce | دفاع لبه اپ | ADR-0014 |
| ED-63 | OTP/MFA؟ | ۶ رقم CSPRNG، ذخیره sha256(salt:code)، TTL 2m، ۵ تلاش، یک‌بارمصرف، RL ارسال 3/10m، Port SMS؛ مقاصد LOGIN_MFA/PASSWORD_RESET/PHONE_VERIFY | معماری MFA آماده + جریان فعال | ADR-0014 |
| ED-64 | سرقت Refresh Token؟ | چرخش اتمیک + زنجیره replacedBy + کشف Replay → ابطال کل خانواده + رویداد REFRESH_REUSE_DETECTED | استاندارد OAuth token-family | SECURITY.md §1.3 |
| ED-65 | رمزنگاری فیلد؟ | AES-256-GCM (پاکت v1:iv:tag:ct) برای ستون‌های حساس؛ تست دستکاری AuthTag | Data-at-Rest در سطح ستون | SECURITY.md §6.2 |
| ED-66 | دسترسی تصویر staff؟ | Permission صریح (view_images ∨ view_medical_files) سروری — بسته شدن «هر نقش staff»؛ Audit همه دسترسی‌ها + رویداد ACCESS_DENIED | بستن T-INF-01/T-EOP-03 | SECURITY.md §8 |
| ED-67 | Consent؟ | ConsentRecord نسخه‌دار (TERMS/PRIVACY/DATA_PROCESSING/MEDICAL_IMAGE_AI/MARKETING)؛ فقط MARKETING قابل لغو؛ اعطا در ثبت‌نام + اندپوینت | الزامات Privacy محصول | ADR-0015 |
| ED-68 | خروجی داده؟ | Export JSON خودکار همه داده کاربر، ۱بار/24h، Audit حساس | Data Portability | ADR-0015 |
| ED-69 | حذف داده؟ | DeletionRequest → ANONYMIZATION (PII→جاگذار + ابطال نشست + تصاویر REJECTED/RIGHT_TO_ERASURE)؛ تجمیع مالی/بالینی حفظ | سازگاری با ED-49 (حسابداری) | ADR-0015 |
| ED-70 | De-identification؟ | pseudonymize (شبه‌نام قطعی per-dataset) + redactText (موبایل/ایمیل/کد) برای دیتاست/گزارش | §11/§63 مشخصات؛ ضد Leakage | ADR-0015 |
| ED-71 | مرجع واحد ساخت UI؟ | Screen Inventory با SC-ID — ۷۳ صفحه با ۹ فیلد اجباری (هدف/کاربر/اطلاعات/Actions/دسترسی/Empty/Loading/Error/Success)؛ هر کامپوننت/Issue/Test فاز UI با SC-ID مرجع | فرمان PHASE 06 · §40 | UX.md §10 · SCREEN-MAP.md |
| ED-72 | Layout پرونده کارشناسی؟ | سه‌ستونه طبق §80: خلاصه بیمار ۲۴٪ / تصویر+AI ۴۰٪ / تشخیص+نسخه+اقدام ۳۶٪ + Timeline پایین؛ RTL آینه‌ای؛ موبایل تب‌عمودی | §80 Master Prompt | UX.md §8.2 |
| ED-73 | صفحات Diagnosis/Prescription/Proforma/Payment بیمار؟ | v1 سکشن‌های Case Workspace؛ v2 صفحه هدف با Deep-link (SC-PT-08..11) — تفکیک بدون شکستن UX فعلی | §23 | SCREEN-MAP §4 |
| ED-74 | حداقل حالت هر صفحه؟ | ۴ حالت اجباری (Empty/Loading/Error/Success) + هشت الگوی استاندارد SP-1..SP-8؛ QA فاز UI با چک‌لیست ۴ حالت می‌پذیرد | §40 | UX.md §7 |
| ED-75 | سرعت صف کارشناس؟ | جدول مجازی + Claim بی‌درنگ (Optimistic + رفع Race با پیام) + Badge «منتظر اقدام من»؛ polling 30s در v2، push در v3 | §18 · §80 | UX.md §2/§8.1 |
| ED-76 | اینترفیس داوری AI؟ | Accept/Modify/Reject + کامنت اجباری → نگاشت مستقیم به ماشین AI_REVIEW (reviewStatus)؛ تصویر اصلی+پردازش‌شده و Confidence همیشه کنار هم | §81 | UX.md §6 F-05 · SC-E1-04 |
| ED-77 | مدل دسترسی بیمار در UI؟ | PATIENT مالکیت‌محور (کاتالوگ Permission برای بیمار خالی)؛ UI بیمار از session، سرور مالکیت را Enforce می‌کند — UI منبع مجاز نیست | §5 · SECURITY.md | SCREEN-MAP §12 |
| ED-78 | Settings مدیر؟ | صفحه هدف v2 (SC-AD-13) برای پیکربندی Runtime (SMS/درگاه/ارسال/SLA)؛ v1 این مقادیر Code-level اند — صفحه نیمه‌تمام ساخته نمی‌شود | §64 | SC-AD-13 |
| ED-79 | مدل Routing؟ | v1: تک-SPA با view-state حفظ؛ v2: مسیرهای RESTful Area-first — مهاجرت صفحه‌به‌صفحه در فاز UI rebuild بدون تغییر رفتار/Shell | §40 | UX.md §5.2 |
| ED-80 | الگوی اعلان‌ها؟ | زنگ سراسری + صفحه SH-05 برای همه نقش‌ها؛ Badge خوانده‌نشده؛ Mark-All-Read؛ هر اعلان Deep-link به صفحه هدف مربوط | §31 | SC-SH-05 |
| ED-81 | منبع توکن طراحی؟ | دو-منبعی: globals.css (runtime) + design-system/tokens.ts (JS/Charts)؛ همگام‌سازی با گیت E6 ممیزی `audit:ui` | §3 · §27 | DESIGN-SYSTEM §1 |
| ED-82 | رنگ وضعیت‌ها؟ | ۸ توکن معنایی §9 (info/progress/success/warning/danger/neutral/navy/revision)؛ چیپ mode-invariant؛ درجه متنی mode-aware؛ STATUS_METAها فقط statusClass ارجاع می‌دهند | §9 | DESIGN-SYSTEM §3 |
| ED-83 | کانفیگ Tailwind؟ | v4 CSS-first مرجع است؛ tailwind.config.ts زائد v3 (مسیرها hsl غلط) حذف شد | — | DESIGN-SYSTEM §1 |
| ED-84 | RTL در کلاس‌ها؟ | ابزار فیزیکی (ml/mr/pl/pr/left/right/text-left/right) در سطح اپ ممنوع = خطای E5 ممیزی؛ فقط منطقی (ms/me/ps/pe/start/end) | §24 | DESIGN-SYSTEM §15 |
| ED-85 | Style Guide کجا؟ | نمای درون-برنامه‌ای designSystem (قید تک-مسیر /) با لینک فوتر Landing+AppShell؛ مرجع زنده §37/§38 | §37 | DESIGN-SYSTEM §18 |
| ED-86 | muted-foreground نارس AA؟ | تیره‌تر شد: #64799A (4.43:1) → #5B6F91 (5.09:1) — اصلاح واقعی دسترس‌پذیری §34 | §34 | DESIGN-SYSTEM §16 |
| ED-87 | دکمه Accent؟ | #57AFE2/#173F76 = 4.31:1 → فقط لیبل درشت/بولد و اجزای UI (≥3:1)؛ متن بدنه از Primary | §8 · §34 | DESIGN-SYSTEM §16 |
| ED-88 | رنگ نمودارها؟ | فقط --chart-1..5 از طریق chartVars/chartTheme؛ hex خام فقط Canvas؛ hsl(var()) ممنوع (E4 — باگ گرید AdminReports رفع شد) | §22 | DESIGN-SYSTEM §13 |
| ED-89 | سیستم Toast؟ | sonner = مرجع (AppToaster جهت‌آگاه داخل AppProvider)؛ radix use-toast فریز legacy | §26 | DESIGN-SYSTEM §15 |
| ED-90 | تضمین یکپارچگی UI؟ | scripts/ui-audit.mjs (E1..E7 + W1/W2) با exit code؛ npm audit:ui — خط پایه ۱۳۳ تخلف → ۰ | §27 · §39 | DESIGN-SYSTEM §17 |
| ED-91 | States چهارگانه؟ | کامپوننت‌های استاندارد atoms.tsx: EmptyState/LoadingRows/LoadingCard/LoadingSpinner/ErrorState/SuccessState/PageState + ConfirmDialog (SP-1..8) | §31 · §32 | DESIGN-SYSTEM §10 |
| ED-92 | کلاس‌های تکراری؟ | idiomهای مشترک تک‌منبع در @layer components: page-title/meta-inline/footer-link/tile-row (رفع W1) | §27 | DESIGN-SYSTEM §8 |

---

## تغییرات آتی این سند

- هر BR/ED جدید فقط با Append و شماره جدید؛ حذف ممنوع (هم‌راستا با P4).
- بازنگری ED فقط با ED جدید که به ED قبلی ارجاع می‌دهد.
- نگاشت‌های اجرایی این قوانین در REQUIREMENTS-TRACEABILITY-MATRIX.md قابل ردیابی است.
