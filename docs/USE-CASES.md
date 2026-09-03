# BabaHakim — Use Cases و سناریوها

| فیلد | مقدار |
|---|---|
| نسخه | 1.0.0 |
| تاریخ | 1405/06/13 (2026-09-04) |
| فاز | PHASE 01 — Product Requirements & System Specification |
| ساختار | §1 بازیگران و اهداف · §2 مدل کامل چرخه بیمار · §3 Use Caseها · §4 سناریوهای Golden Path · §5 کاتالوگ Edge Case و Exception · §6 کاتالوگ Exception سیستمی |

---

## §1 — بازیگران و اهداف (Actor-Goal List)

| بازیگر | نوع | اهداف کلیدی |
|---|---|---|
| Patient (بیمار) | Primary | ثبت‌نام، تکمیل پرونده، مزاج‌شناسی، ارسال تصویر، دریافت ارزیابی، تأیید درمان، خرید، پرداخت، دریافت مرسوله، پیگیری |
| Expert 1 | Primary | Claim پرونده، ارزیابی اولیه، تشخیص، نسخه اولیه، ارجاع مجدد |
| Expert 2 | Primary | داوری نسخه، قیمت‌گذاری، اقلام، ارسال به پزشک، پیش‌فاکتور |
| Doctor | Primary | تأیید/رد/اصلاح نسخه، تعیین Follow-up |
| Operator | Primary | تأیید پرداخت، ارسال/تحویل، تیکت، پیگیری بیماران، قیمت/محصول |
| Admin | Primary | حاکمیت کاربران/نقش‌ها، کاتالوگ، پرسشنامه، AI، مالی، گزارش، Audit |
| System (BabaHakim) | Supporting | Queue، Notification، SMS، AI Inference، Idempotency، Reminder |
| Zarinpal Gateway | Supporting | ایجاد تراکنش، Callback، Verify |
| SMS Provider | Supporting | ارسال پیامک + Delivery Report |

---

## §2 — مدل کامل چرخه بیمار (Patient Lifecycle Model)

نگاشت ۱۸ مرحله فرمان PHASE 01 به وضعیت‌های Workflow، بازیگر، ورودی/خروجی و Gateها:

| # | مرحله | بازیگر فعال | وضعیت Case | شرح | Gate |
|---|---|---|---|---|---|
| 1 | Registration | Patient | — | ثبت‌نام با موبایل؛ صدور کد معرف؛ Consent | — |
| 2 | Questionnaire | Patient | — | پرسشنامه مزاج Version-دار؛ نتیجه + امتیاز ابعاد ذخیره | — |
| 3 | Image Upload | Patient | — | آپلود + Quality Gate + ۴ نسخه تصویر | Quality (رد→Retry) |
| 4 | AI Analysis | System | NEW | استنتاج TongueModelV1 + Explainability + ثبت کامل نگاشت مدل | — |
| 5 | Expert 1 (Claim) | Expert 1 | WAITING_FOR_EXPERT_1 → EXPERT_1_REVIEW | Claim اتمیک؛ مشاهده سه‌ستونی | — |
| 6 | Initial Assessment | Expert 1 | EXPERT_1_REVIEW | تشخیص اولیه + بیماری‌ها + توضیح؛ ارسال به بیمار | — |
| 7 | User Approval | Patient | WAITING_FOR_USER_APPROVAL | G1: تأیید/رد ادامه درمان | **G1** |
| 8 | Prescription (E1) | Expert 1 | WAITING_FOR_EXPERT_1_PRESCRIPTION | نسخه Version 1 + دستور + تدابیر | — |
| 9 | Expert 2 | Expert 2 | WAITING_FOR_EXPERT_2 | داوری + اصلاح نسخه + اقلام موجود/ناقص + قیمت | G2 |
| 10 | Doctor | Doctor | WAITING_FOR_DOCTOR | G3: Approve/Reject/Revision + Follow-up پیشنهادی | **G3** |
| 11 | Order | System+Operator | PRESCRIPTION_APPROVED → PREPARING_ORDER | سفارش اقلام نسخه‌ای | — |
| 12 | Invoice (Proforma) | Expert 2/Operator | PROFORMA_CREATED | پیش‌فاکتور: اقلام + قیمت + هزینه ارسال + اعتبار | — |
| 13 | User Confirmation | Patient | WAITING_FOR_USER_CONFIRMATION | G4: تأیید/رد پیش‌فاکتور | **G4** |
| 14 | Payment | Patient+System | WAITING_FOR_PAYMENT → PAYMENT_CONFIRMED | G5: زرین‌پال یا G6: کارت‌به‌کارت + تأیید اپراتور | **G5/G6** |
| 15 | Shipment | Operator | PREPARING_SHIPMENT → SHIPPED | پیک/خودرو/پست + Tracking + راننده | — |
| 16 | Delivery | Operator | DELIVERED | ثبت تحویل + مدرک + فعال‌سازی Follow-up | — |
| 17 | Follow-up | Patient+Operator | FOLLOW_UP | Reminder سررسید؛ ثبت Outcome (Improved/…) | — |
| 18 | Reassessment | Patient/Operator | REFERRED_AGAIN → پرونده جدید NEW | ارجاع مجدد با Lineage؛ چرخه جدید با تاریخچه | — |

**نمودار ترتیبی (Sequence) — Golden Path کامل:**

```text
Patient        System          E1            E2           Doctor      Operator   Zarinpal
  │  Register    │              │             │              │            │          │
  ├─────────────►│ (code)       │             │              │            │          │
  ├─ Questionnaire              │             │              │            │          │
  ├─────────────►│ result       │             │              │            │          │
  ├─ Upload Image│              │             │              │            │          │
  ├─────────────►│ QC+Variants+AI Analysis    │              │            │          │
  │              ├── Queue ────►│ CLAIM       │              │            │          │
  │              │              ├ Assessment ─┼────────────► │            │          │
  │  ◄─ G1: نتیجه + تأیید ──────┤             │              │            │          │
  ├─────────────►│              │             │              │            │          │
  │              │              ├ Prescription v1             │            │          │
  │              │              └────────────►│ Review+Price │            │          │
  │              │                            ├─────────────►│ Approve    │          │
  │              │                            │              └─ Proforma │          │
  │  ◄─ G4: پیش‌فاکتور + تأیید ───────────────────────────────┼────────────┤          │
  ├─────────────►│──────────────────────────────────────────────────────────────────► │
  │  ◄─ G5: Callback/Verify (Idempotent) ◄───────────────────────────────────────────┤ │
  │              │ PAYMENT_CONFIRMED          │              │ Shipment+Delivery     │
  │              │ FOLLOW_UP ─► Reminder ─► Outcome ─► (Reassessment → چرخه جدید)    │
```

---

## §3 — Use Caseها (UC-01..UC-30)

فرمت هر UC: بازیگران · پیش‌شرط · پس‌شرط · جریان اصلی · جریان‌های جایگزین (A) · جریان‌های استثنا (E) · قوانین مرتبط.

### UC-01 — ثبت‌نام بیمار

- **بازیگران:** Patient، System
- **پیش‌شرط:** موبایل یکتا و قبلاً ثبت‌نشده؛ قوانین/حریم پذیرفته شود
- **پس‌شرط:** حساب ACTIVE + PatientProfile + کد معرف + Consent رکورد + اعلان REGISTERED
- **جریان اصلی:** 1) ورود موبایل/نام/جنسیت/تولد/رمز (+کد معرف اختیاری) 2) اعتبارسنجی 3) Hash رمز 4) ایجاد User+Profile+Referral 5) ثبت Consent 6) اعلان خوش‌آمد
- **A1:** کد معرف نامعتبر → ثبت‌نام بدون رابطه ارجاعی ادامه می‌یابد (هشدار غیرمسدودکننده)
- **E1:** موبایل تکراری → خطای یکتایی، مسیر بازیابی
- **E2:** رمز ضعیف → پیام سیاست
- **BR:** BR-AUTH-02، BR-PRV-08، BR-NTF-01 · **AC:** AC-AUTH-01

### UC-02 — ورود و مدیریت نشست

- **بازیگران:** همه نقش‌ها
- **پیش‌شرط:** حساب ACTIVE (نه LOCKED/INACTIVE)
- **پس‌شرط:** Access+Refresh توکن صادر؛ Login Audit
- **جریان اصلی:** 1) موبایل+رمز 2) بررسی قفل 3) Verify 4) توکن‌ها در کوکی httpOnly 5) ریدایرکت به داشبورد نقش
- **A1:** توکن منقضی وسط کار → Auto-Refresh بی‌وقفه (EC-15)
- **E1:** ۵ خطا → LOCKED + اعلان (BR-PRV-08)
- **E2:** حساب INACTIVE → پیام تماس
- **BR:** BR-AUTH-02، BR-PRV-08 · **AC:** AC-AUTH-03/05

### UC-03 — تکمیل پروفایل

- **بازیگران:** Patient (خود) / Staff مجاز (Audit)
- **پس‌شرط:** پروفایل کامل؛ اعلان PROFILE_COMPLETED
- **جریان:** فرم مشخصات (§6 Master Prompt) → ذخیره → سن محاسبه‌شده (ED-21)
- **E1:** کد ملی نامعتبر الگوریتمی → رد فیلد (اختیاری است)
- **BR:** BR-PRV-01، ED-21 · **AC:** AC-PROF-01

### UC-04 — تکمیل پرسشنامه مزاج

- **بازیگران:** Patient
- **پیش‌شرط:** نسخه ACTIVE پرسشنامه
- **پس‌شرط:** QuestionnaireResponse + نتیجه مزاج در پرونده؛ اعلان QUESTIONNAIRE_DONE
- **جریان:** 1) Wizard سؤال‌به‌سؤال 2) ثبت پاسخ‌ها به نسخه مربوطه 3) امتیازدهی ۴بُعدی (ED-09) 4) نمایش نتیجه + ذخیره
- **A1:** مشاهده تاریخچه نتایج قبلی (هرگز حذف نمی‌شود — BR-CAT-03)
- **E1:** ناقص رها شود → ذخیره نسخه Draft؛ ادامه بعدی
- **AC:** AC-MIZAJ-01/02

### UC-05 — آپلود تصویر زبان

- **بازیگران:** Patient (یا کارشناس UC-05b)
- **پس‌شرط:** تصویر ACCEPTED با ۴ واریانت + Hash/Metadata؛ اعلان IMAGE_RECEIVED یا IMAGE_REJECTED
- **جریان اصلی:** 1) انتخاب/گرفتن عکس 2) اعتبارسنجی فرمت/MIME/حجم/decode (FR-IMG-07) 3) خط لوله پردازش (FR-IMG-02) 4) Quality Assessment (FR-IMG-03) 5) تولید ۴ نسخه + متادیتا 6) ثبت مالکیت
- **A1 (Quality Rejection):** پیام فارسی علت (Blur/Exposure/…) + راهنمای عکس مجدد → کاربر Retry (US-EC-10)
- **E1:** فایل خراب/جعلی → رد امن + Log
- **E2:** خطای ذخیره‌سازی → Rollback کامل، پیام کاربر (US-EC-09)
- **BR:** BR-IMG-01، BR-PRV-02 · **AC:** AC-IMG-01..04

### UC-06 — تحلیل AI

- **بازیگران:** System (فاکت مرجع: Model Provider)
- **پیش‌شرط:** تصویر ACCEPTED؛ مدل DEPLOYED در رجیستری
- **پس‌شرط:** AIAnalysis با Prediction/Confidence/Explainability/ModelVersion؛ اعلان AI_ANALYZED (به کارشناس)
- **جریان:** 1) انتخاب نسخه AI-Optimized 2) استنتاج با Threshold 3) Damping Confidence با Quality 4) ثبت رکورد کامل نگاشت (BR-MED-10)
- **E1:** خطا/Timeout → ثبت Error + Retry محدود (ED-29)؛ پرونده بدون AI هم ادامه می‌یابد
- **BR:** BR-MED-01/10، ED-29 · **AC:** AC-AI-01/02/06

### UC-07 — Claim و بررسی پرونده توسط Expert 1

- **بازیگران:** Expert 1
- **پیش‌شرط:** پرونده WAITING_FOR_EXPERT_1؛ دسترسی claim_cases
- **پس‌شرط:** EXPERT_1_REVIEW با Assign یکتا
- **جریان:** 1) انتخاب از صف (رنگ SLA) 2) Claim اتمیک (Lock) 3) صفحه سه‌ستونی: Patient Summary / تصاویر+AI Card / اقدامات + Timeline
- **E1:** Claim هم‌زمان (EC-CASE-01) → برنده یک؛ بازنده پیام «قبلاً گرفته شد» + بازگشت به صف
- **BR:** BR-WF-03 · **AC:** AC-CASE-04/09

### UC-08 — ثبت ارزیابی اولیه و ارسال به بیمار (G1)

- **بازیگران:** Expert 1
- **جریان:** 1) مشاهده AI (Accept/Modify/Reject+Comment — FR-AI-06) 2) ویرایش شرح حال (Audit) 3) ثبت بیماری‌ها + شرح تشخیص 4) Submit → WAITING_FOR_USER_APPROVAL 5) اعلان ASSESSMENT_READY/USER_APPROVAL_NEEDED
- **E1:** اعتبارسنجی شکست → خطا بدون تغییر وضعیت
- **BR:** BR-MED-01/02، BR-WF-02 · **AC:** AC-EXP1-02

### UC-09 — تصمیم بیمار (G1)

- **بازیگران:** Patient
- **جریان:** 1) اعلان 2) مشاهده نتیجه + توضیح کارشناس + AI Card با Disclaimer 3) Approve → WAITING_FOR_EXPERT_1_PRESCRIPTION / Decline (با دلیل) → CLOSED
- **A1:** بی‌اقدامی → SLA ED-08 (یادآوری ۷۲h؛ Auto-close ۳۰d)
- **BR:** BR-WF-09/10 · **AC:** AC-EXP1-02 / AC-CASE-03

### UC-10 — تجویز نسخه توسط Expert 1

- **بازیگران:** Expert 1
- **جریان:** 1) افزودن اقلام از کاتالوگ/بیماری 2) Dosage/Frequency/Duration/Instructions/Warnings 3) تدابیر غذایی + دستور متن 4) تعیین بازه ارجاع مجدد 5) ثبت → Prescription v1 → WAITING_FOR_EXPERT_2 + اعلان
- **E1:** قلم بدون موجودی → هشدار؛ قابل ثبت اما در Proforma فقط اقلام موجود (ED-06)
- **BR:** BR-MED-03/06، ED-06 · **AC:** AC-EXP1-03/04

### UC-11 — بازبینی و قیمت‌گذاری Expert 2 (G2)

- **بازیگران:** Expert 2
- **جریان:** 1) مشاهده نسخه E1 + AI + تاریخچه 2) اصلاح (نسخه جدید — ED-24) 3) علامت‌گذاری اقلام موجود/ناقص 4) قیمت‌گذاری 5) ارسال به Doctor (G3) + اعلان SENT_TO_DOCTOR
- **A1:** اختلاف با E1 → Disagreement Flag (BR-MED-04)
- **BR:** BR-MED-04، ED-06/24 · **AC:** AC-EXP2-01..04

### UC-12 — تصمیم پزشک (G3)

- **بازیگران:** Doctor
- **جریان:** 1) صف درخواست‌ها 2) مطالعه پرونده کامل 3) تأیید (تعیین Follow-up) / رد (کامنت اجباری) / اصلاح (کامنت اجباری → REVISION به E2)
- **E1:** Reject → CLOSED + اعلان به بیمار و کارشناسان
- **BR:** BR-MED-05، BR-WF-05 · **AC:** AC-DR-01..05

### UC-13 — ایجاد سفارش و پیش‌فاکتور (G4)

- **بازیگران:** Expert 2 / Operator؛ System
- **جریان:** 1) پس از PRESCRIPTION_APPROVED 2) جمع‌آوری اقلام نسخه (فقط موجود) 3) قیمت لحظه (ED-05) + هزینه ارسال 4) Invoice ISSUED 5) اعلان PROFORMA به بیمار
- **A1:** اقلام ناقص → نمایش به بیمار + پیشنهاد جایگزین (ED-06)
- **BR:** BR-FIN-09/10 · **AC:** AC-ORD-01/02

### UC-14 — تأیید پیش‌فاکتور توسط بیمار (G4)

- **جریان:** 1) اعلان/پنل 2) مشاهده اقلام/قیمت/ارسال/اعتبار 7 روز (ED-30) 3) Confirm → WAITING_FOR_PAYMENT / Reject → CANCELLED
- **A1:** انقضای اعتبار → صدور مجدد با قیمت جدید
- **BR:** ED-30 · **AC:** AC-ORD-02

### UC-15 — پرداخت درگاهی (G5)

- **بازیگران:** Patient، Zarinpal، System
- **جریان:** 1) شروع پرداخت → Authority 2) redirect درگاه 3) Callback + Server-to-Server Verify 4) ثبت Payment PAID (Idempotent) 5) Order PAID + Case PAYMENT_CONFIRMED 6) اعلان‌ها
- **E1:** انصراف در درگاه → PENDING باقی می‌ماند؛ Retry آزاد
- **E2:** Verify Fail → FAILED + Error + اعلان + Retry
- **E3:** Callback تکراری → Idempotent رد (US-EC-03)
- **BR:** BR-FIN-01 · **AC:** AC-PAY-01/02/06

### UC-16 — پرداخت کارت‌به‌کارت (G6)

- **بازیگران:** Patient، Operator
- **جریان:** 1) بیمار: آپلود رسید + مبلغ + تاریخ + شماره پیگیری 2) AWAITING_VERIFY + اعلان RECEIPT_UPLOADED به اپراتور 3) اپراتور مشاهده رسید 4) Approve → PAID / Reject → REJECTED+پیام / Request-Info → درخواست مدرک مجدد
- **BR:** BR-FIN-02 · **AC:** AC-PAY-03/04/08

### UC-17 — ارسال (Shipment)

- **بازیگران:** Operator
- **جریان:** 1) انتخاب سفارش پرداخت‌شده 2) روش (موتور/خودرو/پست) + راننده/گیرنده/کد رهگیری/هزینه 3) SHIPPED + اعلان به بیمار (کد رهگیری)
- **E1:** گیرنده پاسخ نمی‌دهد → ثبت تماس + Follow-up تیکت
- **BR:** BR-WF-08 (در تحویل) · **AC:** AC-SHIP-01..03

### UC-18 — ثبت تحویل

- **بازیگران:** Operator
- **جریان:** 1) ثبت تحویل (+مدرک اختیاری) 2) Case → DELIVERED 3) فعال‌سازی FollowUp SCHEDULED 4) اعلان ORDER_DELIVERED
- **BR:** BR-WF-08 · **AC:** AC-SHIP-05

### UC-19 — پیگیری درمان و Outcome

- **بازیگران:** Patient، Operator، (Doctor)
- **جریان:** 1) Reminder سررسید (دو طرف) 2) تماس/تعامل 3) ثبت Outcome (Improved/No Change/Worsened/Unknown) 4) COMPLETE → CLOSED (یا تصمیم Reassessment)
- **A1:** Overdue → اولویت داشبورد + رنگ هشدار
- **BR:** BR-MED-08، BR-NTF-03 · **AC:** AC-FUP-01..05

### UC-20 — ارجاع مجدد (Reassessment)

- **بازیگران:** Patient / Operator (پیشنهاد از Doctor)
- **جریان:** 1) REFER_AGAIN 2) پرونده جدید NEW با Lineage 3) دسترسی کامل تاریخچه 4) چرخه از مرحله ۴ (AI) با تصویر جدید
- **BR:** ED-13 · **AC:** AC-CASE-03 (Timeline Lineage)

### UC-21 — خرید OTC از فروشگاه

- **بازیگران:** Patient
- **جریان:** 1) جستجوی Normalized + فیلتر 2) افزودن OTC به سبد 3) Checkout → Order PENDING_CONFIRMATION 4) تأیید 5) پرداخت (UC-15/16) 6) ارسال/تحویل (UC-17/18)
- **E1:** تلاش افزودن قلم نسخه‌ای → مسدود + پیام «از مسیر پرونده» (BR-MED-03)
- **E2:** موجودی صفر → دکمه غیرفعال (BR-CAT-06)
- **BR:** BR-MED-03، BR-CAT-06/07، BR-I18N-01 · **AC:** AC-SHOP-01..04

### UC-22 — Checkout و جلوگیری از سفارش تکراری

- **بازیگران:** Patient، System
- **جریان:** 1) Checkout با Idempotency-Key 2) ساخت Order یک‌بار 3) حتی با کلیک چندباره (US-EC-01)
- **E1:** خطای شبکه → سفارش در وضعیت امن؛ کاربر وضعیت را می‌بیند نه دوباره ثبت می‌کند
- **BR:** BR-FIN-01 · **AC:** AC-ORD-05

### UC-23 — تیکت پشتیبانی

- **بازیگران:** Patient، Operator/Staff، (ارجاع به Expert/Doctor)
- **جریان:** 1) بیمار: Subject/Category/Priority + پیام/پیوست 2) OPEN → IN_PROGRESS (تخصیص ED-18) 3) گفتگو 4) RESOLVED → CLOSED 5) اعلان‌های TICKET_UPDATED
- **A1:** یادداشت داخلی کارکنان (جدا از پیام بیمار)
- **BR:** ED-18، BR-NTF-01 · **AC:** AC-TKT-01..04

### UC-24 — مدیریت کاربران و RBAC

- **بازیگران:** Admin
- **جریان:** 1) جستجو 2) فعال/غیرفعال 3) تغییر نقش (Audit) 4) ماتریس نقش×دسترسی 5) ذخیره با Audit
- **BR:** BR-RBAC (§2 قواعد 2..4) · **AC:** AC-ADM-01/02

### UC-25 — Import قیمت Excel/CSV

- **بازیگران:** Admin
- **جریان:** 1) Upload فایل 2) اعتبارسنجی ساختار/ستون‌ها/مقادیر 3) نمایش خطاهای ردیفی 4) Preview (Old→New) 5) Confirm اتمیک 6) PriceHistory + اعلان PRICE_CHANGED
- **E1:** فرمت نامعتبر → رد کل فایل با گزارش
- **E2:** ردیف خطادار → گزارش ردیف؛ کاربر اصلاح و دوباره
- **BR:** BR-CAT-04/05، BR-FIN-03/04 · **AC:** AC-ADM-05/06

### UC-26 — Bulk تغییر قیمت ±X%

- **بازیگران:** Admin
- **جریان:** 1) انتخاب دامنه (همه/دسته/برند) 2) درصد ± 3) Preview 4) Commit اتمیک + PriceHistory + Audit + اعلان
- **BR:** BR-FIN-03، BR-CAT-05 · **AC:** AC-ADM-06

### UC-27 — ویرایش پرسشنامه و نسخه‌بندی

- **بازیگران:** Admin
- **جریان:** 1) ویرایش سؤال/گزینه/امتیاز/ترتیب 2) Publish → نسخه جدید ACTIVE؛ قبلی ARCHIVED 3) پاسخ‌های قدیمی به نسخه خود متصل می‌مانند
- **BR:** BR-CAT-03 · **AC:** AC-ADM-07

### UC-28 — گزارش‌ها و داشبورد مالی

- **بازیگران:** Admin (Operator محدود)
- **جریان:** 1) فیلترهای ۱۶گانه 2) تجمیع (روز/محصول/معرف/استان) 3) نمودار 4) Export (CSV/Excel/PDF)
- **BR:** BR-FIN-11 · **AC:** AC-FIN-01..07

### UC-29 — حاکمیت مدل AI و Dataset

- **بازیگران:** Admin
- **جریان:** 1) رجیستری مدل‌ها + metrics 2) Approval استقرار (G7) 3) آمار Dataset + Disagreement 4) مسیر De-identify/Label (G8) 5) Versioning Dataset
- **BR:** BR-MED-09/10، BR-PRV-06/11 · **AC:** AC-ADM-08، AC-AI-07

### UC-30 — Audit و Data Access Review

- **بازیگران:** Admin
- **جریان:** 1) اکسپلورر Audit با فیلتر (کاربر/عمل/موجودیت/تاریخ/حساسیت) 2) مشاهده Old→New 3) بررسی الگوی دسترسی پزشکی (View Medical File)
- **BR:** BR-AUD/BR-PRV-10 · **AC:** AC-ADM-09، AC-PRV-03

---

## §4 — سناریوهای Golden Path (End-to-End)

### GP-1 — مسیر کامل بالینی (تست §55 Master Prompt)

1. Register → 2. Questionnaire → 3. Upload (QC Pass) → 4. AI Analysis → 5. E1 Claim → 6. Assessment → 7. Patient Approve → 8. Prescription v1 → 9. E2 Review + Price → 10. Doctor Approve (+Follow-up 21d) → 11. Proforma → 12. Patient Confirm → 13. Zarinpal Pay (Verify) → 14. Shipment → 15. Delivered → 16. Follow-up Due → Outcome Improved → CLOSED

### GP-2 — مسیر با کارت‌به‌کارت

همان GP-1 تا مرحله ۱۲؛ سپس: Upload رسید → Operator Reject (ناخوانا) → Request-Info → رسید جدید → Approve → ادامه از ۱۴

### GP-3 — مسیر اصلاح پزشک

… → 9. E2 ارسال → 10. Doctor Revision (کامنت) → REVISION → E2 اصلاح نسخه (v2) → Doctor Approve → ادامه از ۱۱

### GP-4 — مسیر خرید OTC

Search فارسی (ی/ک ناهمگون) → Add OTC ×2 → Checkout (کلیک دوبار؛ فقط یک Order) → Gateway Pay → Shipment → Delivered

### GP-5 — مسیر ارجاع مجدد

پرونده اول CLOSED پس از Outcome → REFER_AGAIN → پرونده جدید با Lineage → AI جدید → E1 با تاریخچه کامل → …

### GP-6 — مسیر نا‌موفق‌های کنترل‌شده

تصویر تار → REJECT + راهنما → تصویر خوب → ادامه / پرداخت FAILED → پیام + Retry → موفق / بیمار G1 رد → CLOSED با دلیل

---

## §5 — کاتالوگ Edge Caseها (EC)

| ID | سناریو | رفتار مورد انتظار | پیوند |
|---|---|---|---|
| EC-IMG-01 | فرمت غیرمجاز/تقلبی MIME | رد پیش از ذخیره؛ Log امنیتی؛ نام فایل هرگز وارد filesystem نمی‌شود | FR-IMG-07, AC-IMG-02 |
| EC-IMG-02 | حجم > سقف | رد سریع + پیام حد | FR-IMG-02 |
| EC-IMG-03 | فایل corrupted (decode fail) | رد + پیام | FR-IMG-02 |
| EC-IMG-04 | تصویر بی‌کیفیت (Blur/Exposure/Resolution) | Quality Gate رد + راهنمای فارسی + Retry | FR-IMG-03/04 |
| EC-IMG-05 | EXIF/JPEG Orientation غلط | Auto-rotate قبل از تحلیل | FR-IMG-10 |
| EC-AI-01 | خطا/Timeout استنتاج | ثبت Error، Retry محدود، ادامه مسیر انسانی | ED-29 |
| EC-AI-02 | Confidence پایین (تصویر ضعیف) | Damping + نمایش هشدار «کم‌اعتماد» | FR-AI-05 |
| EC-CASE-01 | Claim هم‌زمان دو کارشناس | Lock اتمیک؛ اولین برنده | BR-WF-03 |
| EC-CASE-02 | SLA مرحله گذشته | رنگ Overdue + Escalation اعلان | FR-QUEUE-04 |
| EC-CASE-03 | Transition غیرمجاز | 403 + Audit | BR-WF-01 |
| EC-CASE-04 | بیمار Gate را رها کرد | یادآوری → Auto-close با مسیر بازگشت | ED-08 |
| EC-RX-01 | ویرایش هم‌زمان نسخه | هر ذخیره Version جدید؛ عدم از دست رفتن تاریخچه | ED-24 |
| EC-EXP-01 | اختلاف E1/E2 | Disagreement Flag + داوری Doctor | BR-MED-04 |
| EC-SHOP-01 | افزودن قلم نسخه‌ای به سبد | مسدود + مسیر پرونده | BR-MED-03 |
| EC-SHOP-02 | تغییر قیمت حین خرید | قیمت لحظه Checkout ملاک؛ تاریخچه شفاف | ED-05 |
| EC-ORD-01 | کلیک چندباره Checkout/Confirm | Idempotency؛ یک Order | BR-FIN-01 |
| EC-PAY-01 | Callback تکراری درگاه | رد Idempotent + Log | BR-FIN-01 |
| EC-PAY-02 | Verify موفق اما Callback گم | Reconciliation از گزارش درگاه (UC-28) | FR-PAY-06 |
| EC-PAY-03 | رسید کارت‌به‌کارت ناخوانا/مبلغ ناهمخوان | Operator Reject/Request-Info با دلیل | BR-FIN-02 |
| EC-PAY-04 | پرداخت هم‌زمان با لغو | Transaction/Lock؛ یک نتیجه نهایی (پرداخت یا لغو؛ در تضاد: Refund مسیر اصلاح) | BR-FIN-01/05 |
| EC-SHIP-01 | گیرنده در دسترس نیست | ثبت تماس + تیکت + تعلیق تحویل (نه لغو خودکار) | UC-17 E1 |
| EC-FUP-01 | سررسید پیگیری گذشته (Overdue) | اولویت + رنگ + Reminder تکراری | FR-FUP-03 |
| EC-NTF-01 | قطع SMS Provider | In-app رکورد؛ SMS Retry/Backoff + Log خطا | ED-17 |
| EC-NTF-02 | شماره موبایل نامعتبر | Log خطا؛ اعلان In-app سالم | BR-NTF-02 |
| EC-AUTH-01 | قفل Brute-Force | LOCKED + اطلاع؛ مسیر بازیابی Admin | BR-PRV-08 |
| EC-AUTH-02 | Refresh Token reuse (سرقت) | ابطال زنجیره توکن؛ ورود مجدد اجباری | NFR-SEC-01 |
| EC-STG-01 | خطای ذخیره‌سازی حین آپلود | Rollback؛ بدون رکورد نیمه‌کاره | US-EC-09 |
| EC-DB-01 | خطای DB حین Transition | Rollback تراکنش؛ وضعیت قبلی سالم؛ Log | NFR-REL-02 |
| EC-ADM-01 | Import قیمت با فایل/ستون/ردیف نامعتبر | رد کل فایل با گزارش ساختار؛ ردیف‌های خطادار گزارش ردیفی؛ Commit اتمیک بدون نیمه‌کاره | BR-CAT-04, BR-FIN-04 |
| EC-SRCH-01 | جستجو با ي/ك عربی و اعداد فارسی | Normalize + نتایج صحیح | BR-I18N-01 |
| EC-I18N-01 | تغییر زبان وسط جریان | بدون از دست رفتن فرم/صفحه؛ RTL/LTR و تقویم سوییچ | NFR-I18N-01 |
| EC-PRV-01 | درخواست حذف داده با تعهدات مالی/حقوقی باز | انجام بعد از تسویه/تأیید حقوقی؛ ثبت علت تعلیق | BR-PRV-05/12 |

---

## §6 — کاتالوگ Exceptionهای سیستمی (Failure Handling)

مطابق §56 Master Prompt: برای هر خطای زیر، استراتژی «Idempotency / Locking / Retry / Dead Letter / Error Recovery» تعریف شده است:

| رخداد | اثر | Retry | Dead Letter / Escalation | بازیابی |
|---|---|---|---|---|
| AI Failure | پرونده بدون AI ادامه می‌یابد | ۳ بار با Backoff | ثبت خطا + اعلان Admin | اجرای مجدد تحلیل از پنل Admin |
| Payment Gateway Failure | Payment FAILED | کاربر Retry آزاد | Log + گزارش اختلاف | Verify دستی/Reconciliation |
| SMS Failure | اعلان In-auth سالم | ۳ بار Exponential | SMSLog error + آیتم پایش | ارسال مجدد دستی |
| Image Upload Failure | Rollback کامل | کاربر مجدد | Log امنیتی | — |
| Storage Failure | آپلود رد می‌شود | ۲ بار | Health Monitoring | Snapshot/Backup |
| Database Failure | تراکنش Rollback | Connection Retry | Health/Readiness Probes | HA/Backup Restore |
| Worker/Queue Failure | Jobs عقب می‌افتد | خودکار | Dead Letter Queue | پردازش مجدد DLQ |
| Network Failure (Client) | UX امن بدون ثبت تکراری | Idempotency-Key | — | وضعیت واقعی از سرور |
| Duplicate Payment/Callback | فقط اولین مؤثر | — | Log تکرار | — |
| Concurrent Price Change | آخرین Commit برنده + تاریخچه کامل | — | Audit ردیابی | PriceHistory |
| Concurrent Prescription Edit | نسخه جدید از هر ذخیره | — | History | Versioning |

> همه Exceptionها باید در تست‌های Integration/Chaos فاز 04 پوشش داده شوند (نگاشت در RTM).
