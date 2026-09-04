# BabaHakim — معیارهای پذیرش (Acceptance Criteria)

| فیلد | مقدار |
|---|---|
| نسخه | 1.0.0 |
| تاریخ | 1405/06/13 (2026-09-04) |
| فاز | PHASE 01 — Product Requirements & System Specification |
| فرمت | هر AC به‌صورت **Given / When / Then** + نوع تست پیشنهادی |
| انواع تست | **U**=Unit · **I**=Integration · **API**=API Test · **E2E**=End-to-End · **SEC**=Security · **UI**=Visual/UX |

> این معیارها مرجع Test Plan فاز 04 هستند؛ هر AC باید بتواند به یک تست خودکار/دستی نگاشت شود (نگاشت کامل در REQUIREMENTS-TRACEABILITY-MATRIX.md).

---

## AC — هویت و دسترسی

| ID | Given | When | Then | تست |
|---|---|---|---|---|
| AC-AUTH-01 | موبایل ثبت‌نشده | ثبت‌نام معتبر با پذیرش قوانین | حساب ACTIVE + PatientProfile + کد معرف یکتا + رکورد Consent با timestamp + اعلان REGISTERED | API, E2E |
| AC-AUTH-02 | کاربر در فرم ثبت‌نام است | مشاهده/پذیرش Privacy و Terms | متن‌ها با شماره نسخه نمایش؛ Consent با نسخه ثبت می‌شود | UI, API |
| AC-AUTH-03 | حساب ACTIVE | ورود با اطلاعات صحیح | توکن صادر (کوکی httpOnly) + ریدایرکت داشبورد نقش + Audit Login | API, SEC |
| AC-AUTH-04 | نشست فعال | Logout | Refresh ابطال + دسترسی بعدی 401 + Audit | API, SEC |
| AC-AUTH-05 | ۵ تلاش ناموفق پیاپی | تلاش ششم | ورود مسدود (LOCKED) + ثبت زمان/IP + اعلان | SEC, API |
| AC-AUTH-06 | Access منقضی، Refresh معتبر | درخواست API | Auto-Refresh شفاف؛ عملیات کاربر بی‌وقفه | API |
| AC-AUTH-07 | کاربر با نقش X | درخواست Endpoint نیازمند Permission نداشته | 403 استاندارد + Audit؛ UI دکمه را مخفی می‌کند | API, SEC, UI |
| AC-AUTH-08 | درخواست‌های متوالی بیش از حد | عبور از Rate Limit | 429 + Retry-After؛ Log | SEC, API |

## AC — پروفایل و پرونده

| ID | Given | When | Then | تست |
|---|---|---|---|---|
| AC-PROF-01 | بیمار وارد شده | ذخیره فرم مشخصات کامل | فیلدها §6 ذخیره + اعلان + Audit در ویرایش Staff | API |
| AC-PROF-02 | تاریخ تولد ثبت شده | مشاهده پروفایل | سن محاسبه‌شده صحیح (شمسی در FA) | U, API |
| AC-PROF-03 | کاربر کد ملی وارد می‌کند | ذخیره | اعتبارسنجی الگوریتمی؛ ذخیره با سیاست امنیتی؛ نمایش ماسک‌شده | API, SEC |
| AC-PROF-04 | Staff مجاز بیمار را ویرایش می‌کند | ثبت تغییر | Audit با Old/New/Actor/IP | API, I |
| AC-PROF-05 | بیمار چند پرونده/رخداد دارد | بازکردن پرونده سلامت | همه بخش‌ها (تصاویر/تشخیص/نسخه/کامنت/پیگیری) یکجا | UI, E2E |
| AC-PROF-06 | CaseEventهای متعدد | مشاهده Timeline | مرتب زمانی + Actor + شرح + Status هر Event | UI, I |
| AC-PROF-07 | بیمار لوگین است | آپلود تصویر چهره | همان خط لوله QC + متادیتا | API |

## AC — مزاج‌شناسی

| ID | Given | When | Then | تست |
|---|---|---|---|---|
| AC-MIZAJ-01 | پرسشنامه ACTIVE | پاسخ مرحله‌ای کامل | Wizard بدون خطا؛ پاسخ‌ها به نسخه متصل | UI, E2E |
| AC-MIZAJ-02 | پاسخ‌ها ثبت شد | محاسبه نتیجه | برچسب یکی از ۵ حالت + امتیاز ۴ بُعد ذخیره + نمایش | U, API |
| AC-MIZAJ-03 | Admin ویرایش می‌کند | Publish | نسخه جدید ACTIVE؛ قدیمی ARCHIVED؛ پاسخ‌های قبلی به نسخه قدیم باقی | API, I |
| AC-MIZAJ-04 | نتایج تاریخی موجود | مشاهده تاریخچه | همه نتایج با تاریخ؛ هیچ حذف/بازنویسی | API |
| AC-MIZAJ-05 | کارشناس پرونده را باز می‌کند | نمایش مزاج | برچسب + امتیاز در Patient Summary | UI |

## AC — تصویر پزشکی

| ID | Given | When | Then | تست |
|---|---|---|---|---|
| AC-IMG-01 | بیمار وارد | آپلود تصویر صحیح از موبایل/دسکتاپ | موفق؛ ۴ واریانت + Hash + Owner + Timestamp | API, E2E |
| AC-IMG-02 | فایل نامعتبر (فرمت/MIME/حجم/خرابی) | آپلود | رد با پیام علت مشخص؛ NOTHING ذخیره؛ Log | API, SEC |
| AC-IMG-03 | تصویر تار/نور ناکافی/Over-exposed/رزولوشن کم | Quality Assessment | REJECT با علت + راهنمای فارسی قابل‌اقدام | U, API, E2E |
| AC-IMG-04 | تصویر ACCEPTED | تولید واریانت‌ها | Original/Compressed/AI-Opt/Thumb + متادیتا کامل + حجم در حدود هدف | U, I |
| AC-IMG-05 | لینک تصویر > ۱۰ دقیقه | درخواست دسترسی | 403/404؛ بدون دسترسی | SEC, API |
| AC-IMG-06 | Staff تصویر را مشاهده می‌کند | بارگذاری Signed URL | مشاهده موفق + Audit «View Medical File» با IP/Device | API, SEC, I |
| AC-IMG-07 | فایل آپلودی | بررسی ذخیره‌سازی | نام Random؛ Metadata اضافی حذف؛ نام کاربر در Path نیست | SEC, U |
| AC-IMG-08 | کارشناس در Workspace | افزودن تصویر پزشکی | همان QC؛ متعلق به همان پرونده | API |

## AC — تحلیل AI

| ID | Given | When | Then | تست |
|---|---|---|---|---|
| AC-AI-01 | مدل V1 DEPLOYED | تحلیل | خروجی از Provider ثبت‌شده؛ قابل تعویض بدون تغییر هسته (تست با Provider دوم) | I, U |
| AC-AI-02 | بیمار AI Card را می‌بیند | نمایش | Confidence + برچسب «نیازمند بررسی انسانی» + Disclaimer؛ در Dev برچسب SIMULATED | UI, SEC |
| AC-AI-03 | کارشناس بازبینی | Accept/Modify/Reject + Comment | ثبت نظر + تاریخچه + در Timeline | API, E2E |
| AC-AI-04 | تصویر Quality=60 | تحلیل | Confidence < حالت Quality=90 (Damping فعال) | U |
| AC-AI-05 | چند Prediction ثبت | کوئری نگاشت | model_version/dataset_version/threshold/timestamp همیشه موجود | API, I |
| AC-AI-06 | Provider خطا می‌دهد | تحلیل | خطا ثبت + Retry محدود + پرونده ادامه مسیر انسانی | I |
| AC-AI-07 | مدل PENDING | تلاش استقرار | استقرار مسدود تا Approval + metrics | API, SEC |

## AC — پرونده و Workflow

| ID | Given | When | Then | تست |
|---|---|---|---|---|
| AC-CASE-01 | تصویر ACCEPTED + مزاج موجود | ایجاد پرونده | Case NEW → در صف؛ اعلان CASE_IN_QUEUE | API, E2E |
| AC-CASE-02 | کاربر نقش غیرمجاز | درخواست Transition | 403 + Audit؛ وضعیت بدون تغییر | API, SEC |
| AC-CASE-03 | پرونده با تاریخچه | مشاهده | CaseEventها کامل (Actor/Time/Old/New/Reason/Comment) | I, UI |
| AC-CASE-04 | دو کارشناس هم‌زمان Claim | هر دو Submit | فقط یک موفق؛ دیگری پیام «قبلاً Claim شد» | I (همزمانی) |
| AC-CASE-05 | Admin/Operator | Reassign با دلیل | تغییر Assignee + Audit + اعلان | API |
| AC-CASE-06 | بیمار در وضعیت مجاز | انصراف با دلیل | CLOSED/CANCELLED + Reason + اعلان | API |
| AC-CASE-07 | صف با موارد متنوع | بازکردن داشبورد Queue | زمان انتظار + رنگ SLA (سبز/کهربایی/قرمز) | UI |
| AC-CASE-08 | مورد Overdue | گذر SLA | رنگ قرمز + اعلان Escalation به Admin | I, UI |
| AC-CASE-09 | کارشناس Workspace | بازکردن پرونده | سه‌ستون (Summary/تصاویر+AI/اقدامات) + Timeline پایین؛ P95 < 1.5s | UI, PERF |

## AC — کارشناس اول

| ID | Given | When | Then | تست |
|---|---|---|---|---|
| AC-EXP1-01 | E1 Claim کرده | ویرایش شرح حال | ذخیره + Audit Old/New | API |
| AC-EXP1-02 | E1 در EXPERT_1_REVIEW | Submit Assessment | Diagnosis ثبت + وضعیت → WAITING_FOR_USER_APPROVAL + اعلان دوطرفه | API, E2E |
| AC-EXP1-03 | بیمار تأیید کرده | ثبت نسخه کامل | اقلام با Dose/Freq/Duration/Instr/Warning + تدابیر + Status نسخه DRAFT | API, E2E |
| AC-EXP1-04 | نسخه v1 موجود | ویرایش و ذخیره | نسخه v2 جدید؛ v1 سالم و قابل مشاهده (SUPERSEDED) | I |
| AC-EXP1-05 | بیمار سابقه دارد | مشاهده | نسخه‌ها/داروهای قبلی + تاریخچه درمان قابل دسترسی | UI |
| AC-EXP1-06 | E1 تعیین بازه ارجاع | ذخیره | ثبت Reassessment Interval در پرونده | API |
| AC-EXP1-07 | فعالیت ثبت‌شده | گزارش روزانه/هفتگی/ماهانه | آمار صحیح با بازه شمسی/میلادی | API, I |

## AC — کارشناس دوم

| ID | Given | When | Then | تست |
|---|---|---|---|---|
| AC-EXP2-01 | پرونده در WAITING_FOR_EXPERT_2 | بازکردن | نسخه E1 + AI Card + تاریخچه کنار هم | UI |
| AC-EXP2-02 | E2 اصلاح می‌کند | Save | نسخه جدید + ارسال به Doctor: وضعیت WAITING_FOR_DOCTOR + اعلان | API, E2E |
| AC-EXP2-03 | اقلام متفاوت | علامت‌گذاری | موجود/ناقص ذخیره؛ در Proforma فقط موجود | API, I |
| AC-EXP2-04 | قیمت‌گذاری | Save | قیمت اقلام + برآورد کل ذخیره؛ مبنای Proforma | API |
| AC-EXP2-05 | Doctor تأیید کرد | صدور Proforma | Invoice ISSUED + اقلام + هزینه ارسال + اعتبار 7 روز + اعلان به بیمار | API, E2E |
| AC-EXP2-06 | نظر E1≠E2 | ثبت | Disagreement Flag روی رکورد + Doctor دید تشدیدشده | I |

## AC — پزشک

| ID | Given | When | Then | تست |
|---|---|---|---|---|
| AC-DR-01 | درخواست در صف پزشک | بازکردن | پرونده کامل + نسخه + پیشنهادها + AI + تاریخچه | UI |
| AC-DR-02 | Doctor تأیید می‌کند | Approve | PRESCRIPTION_APPROVED + نسخه ACTIVE + Follow-up پیشنهادی قابل تنظیم + اعلان | API, E2E |
| AC-DR-03 | Doctor رد می‌کند | Reject بدون کامنت | خطای اعتبارسنجی؛ با کامنت: CLOSED + اعلان‌ها | API, I |
| AC-DR-04 | Doctor اصلاح می‌خواهد | Revision + کامنت | REVISION → E2 + اعلان؛ پرونده باز می‌ماند | API, E2E |
| AC-DR-05 | تأیید نهایی | تعیین Follow-up | FollowUp SCHEDULED با تاریخ + نوع | API |

## AC — فروشگاه و سبد

| ID | Given | When | Then | تست |
|---|---|---|---|---|
| AC-SHOP-01 | جستجو با «ي/ك/۴/نیم‌فاصله» ناهمگون | Submit | نتایج معادل جستجوی استاندارد (Normalization فعال) | U, API |
| AC-SHOP-02 | فیلتر فعال | اعمال | فقط تطابق‌ها + مرتب‌سازی | API, UI |
| AC-SHOP-03 | قلم نسخه‌ای | تلاش افزودن به سبد | مسدود + پیام مسیر پرونده | API, SEC |
| AC-SHOP-04 | سبد با اقلام | تغییر تعداد | جمع لحظه‌ای صحیح + اعتبارسنجی موجودی | UI, API |
| AC-SHOP-05 | صفحه محصول | مشاهده | نحوه مصرف + محدودیت‌ها + OTC/نسخه‌ای مشخص | UI |
| AC-SHOP-06 | Admin تخفیف می‌دهد | اعمال در Checkout | مبلغ صحیح + ثبت Reason/Actor + Audit | API, I |
| AC-SHOP-07 | قیمت تغییر کرده | مشاهده محصول | قیمت جدید + تاریخ تغییر شفاف | UI |

## AC — سفارش و پیش‌فاکتور

| ID | Given | When | Then | تست |
|---|---|---|---|---|
| AC-ORD-01 | نسخه APPROVED | ساخت سفارش پرونده | Order با اقلام نسخه + اتصال Case/Invoice | API, I |
| AC-ORD-02 | Proforma صادر | تأیید/رد بیمار | Confirm → WAITING_FOR_PAYMENT + اعلان Operator / Reject → CANCELLED + Reason | API, E2E |
| AC-ORD-03 | پرداخت موفق | صدور Invoice | Invoice PAID + غیرقابل ویرایش + شماره INV- | I |
| AC-ORD-04 | سبد OTC | Checkout | Order مستقل + وضعیت PENDING_CONFIRMATION → CONFIRMED | API, E2E |
| AC-ORD-05 | کلیک موازی Checkout | ۱۰ Submit هم‌زمان | دقیقاً یک Order (Idempotency) | I (همزمانی) |
| AC-ORD-06 | سفارش فعال | مشاهده پنل | وضعیت فعلی + تاریخچه تغییرات | UI |

## AC — پرداخت

| ID | Given | When | Then | تست |
|---|---|---|---|---|
| AC-PAY-01 | Proforma تأییدشده | پرداخت درگاه | Authority → redirect → Callback → Verify → PAID + Ref Number | API, E2E |
| AC-PAY-02 | Callback تکراری ۵ بار | Verify | فقط اولین اثرگذار؛ بقیه Log تکرار؛ وضعیت ثابت | I (Idempotency) |
| AC-PAY-03 | بیمار کارت‌به‌کارت | ارسال رسید+مبلغ+تاریخ+پیگیری | AWAITING_VERIFY + اعلان Operator | API, E2E |
| AC-PAY-04 | Operator رسید را می‌بیند | Approve/Reject/Info | Approve→PAID / Reject→REJECTED+دلیل / Info→درخواست مجدد؛ همه Audit | API, I |
| AC-PAY-05 | تراکنش‌های متعدد | گزارش زرین‌پال | تفکیک موفق/ناموفق/در انتظار/Refund + جزئیات + کشف اختلاف | API, UI |
| AC-PAY-06 | درگاه خطا می‌دهد | پرداخت | FAILED + Error ثبت + پیام کاربر + مسیر Retry | I |
| AC-PAY-07 | Admin Refund | با Reason | Payment+Order → REFUNDED + FinancialTransaction REFUND + Audit | API, I |
| AC-PAY-08 | پرداخت رد شد | مشاهده بیمار | پیام روشن + اقدام مجدد + اعلان | UI |

## AC — ارسال و تحویل

| ID | Given | When | Then | تست |
|---|---|---|---|---|
| AC-SHIP-01 | Order PAID | ثبت ارسال | فیلدها کامل (راننده/وسیله/گیرنده/هزینه) + SHIPPED + اعلان | API, E2E |
| AC-SHIP-02 | ارسال ثبت | Tracking Code | کد یکتا TRK- + نمایش بیمار | API, UI |
| AC-SHIP-03 | بیمار در پنل | پیگیری | وضعیت + کد + تاریخ ارسال/تحویل | UI |
| AC-SHIP-04 | تحویل با مدرک | ثبت | پیوست ذخیره + Audit | API |
| AC-SHIP-05 | تحویل ثبت شد | انتقال وضعیت | Case → DELIVERED + FollowUp SCHEDULED + اعلان | I, E2E |

## AC — پیگیری درمان

| ID | Given | When | Then | تست |
|---|---|---|---|---|
| AC-FUP-01 | Doctor/Expert | تعیین تاریخ پیگیری | FollowUp SCHEDULED (مثلاً +۴۰ روز) | API |
| AC-FUP-02 | سررسید رسید | Scheduler | اعلان/پیامک دو طرف + وضعیت DUE | I, E2E |
| AC-FUP-03 | داشبورد اپراتور | مشاهده | تفکیک Due Today / Overdue / Upcoming / Completed | UI |
| AC-FUP-04 | تماس انجام | ثبت Outcome | یکی از ۴ حالت + ذخیره + (Ready for Dataset بدون اعتبار خودکار) | API |
| AC-FUP-05 | Outcome ثبت | بررسی Dataset | رکورد UNREVIEWED (نه APPROVED) — نیاز بازبینی | I |

## AC — تیکت

| ID | Given | When | Then | تست |
|---|---|---|---|---|
| AC-TKT-01 | بیمار وارد | ایجاد تیکت | Subject/Category/Priority + پیام/پیوست + OPEN | API, E2E |
| AC-TKT-02 | Staff پاسخ | ارسال + تغییر وضعیت | وضعیت مطابق گفتگو (IN_PROGRESS/WAITING_*) | API |
| AC-TKT-03 | تیکت فعال | پیام جدید | اعلان TICKET_UPDATED به طرف مقابل | I |
| AC-TKT-04 | Staff | یادداشت داخلی | جدا از پیام بیمار؛ بیمار نمی‌بیند | API, SEC |
| AC-TKT-05 | گزارش Admin | SLA تیکت | میانگین پاسخ + موارد مقطوع | API |

## AC — اعلان و پیامک

| ID | Given | When | Then | تست |
|---|---|---|---|---|
| AC-NTF-01 | کاربر اعلان دارد | مشاهده زنگ/لیست | دوزبانه + خوانده/نخوانده + پیوند مقصد | UI |
| AC-NTF-02 | رخداد Critical (نتیجه/پرداخت/ارسال) | ارسال | In-app + SMS + رکورد SMSLog | I, E2E |
| AC-NTF-03 | Admin پنل SMS | مشاهده | رکوردها با وضعیت/خطا/زمان + فیلتر | UI |
| AC-NTF-04 | SMS Provider خطا | ارسال | جریان اصلی ادامه + Retry + Log خطا (API اصلی 200 می‌ماند) | I |

## AC — مالی و گزارش

| ID | Given | When | Then | تست |
|---|---|---|---|---|
| AC-FIN-01 | تراکنش‌های موجود | داشبورد مالی | درآمد/هزینه/سود/بدهی/بستانچی صحیح از FinancialTransaction | I, API |
| AC-FIN-02 | فیلتر تاریخ/کاربر/محصول/معرف | گزارش | تفکیک صحیح | API |
| AC-FIN-03 | فیلترهای ۱۶گانه | گزارش پویا | ترکیب فیلترها + نتیجه درست | API |
| AC-FIN-04 | گزارش ساخته | Export | فایل CSV/Excel/PDF معتبر | API, I |
| AC-FIN-05 | داشبورد Admin | مشاهده | همه KPIها (کاربر/پرونده/سفارش/درآمد/تیکت/ارسال) به‌روز | UI |
| AC-FIN-06 | هزینه ثبت | ثبت Expense | در سود تقریبی لحاظ + دسته صحیح | API |
| AC-FIN-07 | بازه زمانی | نمودار | سری روزانه + تجمیع درست (شمسی در FA) | UI, I |

## AC — معرف

| ID | Given | When | Then | تست |
|---|---|---|---|---|
| AC-REF-01 | ثبت‌نام موفق | صدور کد | یکتا + نمایش در پنل | API |
| AC-REF-02 | ثبت‌نام با کد معرف | ذخیره رابطه | Referrer↔Referred ثبت + قابل گزارش | I |
| AC-REF-03 | سفارش ارجاعی پرداخت شد | گزارش معرف | درآمد/سفارش تحت آن معرف + کمیسیون طبق قاعده | I, API |

## AC — Admin و حاکمیت

| ID | Given | When | Then | تست |
|---|---|---|---|---|
| AC-ADM-01 | Admin | جستجو/تغییر نقش/فعال-غیرفعال | اعمال + Audit هر تغییر | API, SEC |
| AC-ADM-02 | ماتریس RBAC | ویرایش Permission نقش | ذخیره + اعمال فوری در Guardهای سرور + Audit | API, SEC, I |
| AC-ADM-03 | CRUD بیماری | ذخیره | نام دوزبانه + کد یکتا + دسته + علائم + داروهای مرتبط + Active | API |
| AC-ADM-04 | CRUD محصول | ذخیره | فیلدهای §14 + OTC فلگ + تصویر + موجودی | API |
| AC-ADM-05 | Excel قیمت با ۳ ردیف خطا | Import | Preview خطاها؛ Commit فقط ردیف‌های سالم؛ PriceHistory کامل | API, I, E2E |
| AC-ADM-06 | Bulk +10% | اعمال | همه قیمت‌ها +10% + PriceHistory Old→New + Audit + اعلان | I |
| AC-ADM-07 | ویرایش پرسشنامه | Publish | نسخه جدید؛ پاسخ‌های قدیمی سالم | I |
| AC-ADM-08 | رجیستری AI | مشاهده/Approval | مدل‌ها + metrics + وضعیت + آمار Dataset | UI, API |
| AC-ADM-09 | اکسپلورر Audit | فیلتر | نتایج دقیق + نمایش Old/New + پرچم حساس | API, UI |

## AC — حریم خصوصی

| ID | Given | When | Then | تست |
|---|---|---|---|---|
| AC-PRV-01 | بیمار درخواست Export | گردش کار | فایل داده + Audit + اطلاع نتیجه | API, I |
| AC-PRV-02 | درخواست Delete | بررسی Admin | اجرا/تعلیق با دلیل + Audit کامل | API, SEC |
| AC-PRV-03 | Admin Data Access Log | مشاهده | همه View Medical Fileها با کاربر/زمان/IP | API, UI |
| AC-PRV-04 | داده ورودی Dataset | بررسی | De-identified (بدون شناسه مستقیم بیمار) | I, SEC |
| AC-PRV-05 | هر URL/Log | بازرسی | بدون PHI در URL؛ بدون محتوای حساس در Log معمولی | SEC |

## AC — Edge Cases (ترنس‌ورس)

| ID | سناریو (خلاصه) | معیار Then | تست |
|---|---|---|---|
| AC-EC-01 | کلیک موازی دکمه عملیاتی | فقط یک اثر مؤثر | I |
| AC-EC-02 | Claim هم‌زمان | یک برنده | I |
| AC-EC-03 | Callback تکراری | بدون تغییر دوم | I |
| AC-EC-04 | پرداخت هم‌زمان لغو | یک نتیجه نهایی + در تضاد Refup مسیر | I |
| AC-EC-05 | تغییر قیمت حین پرداخت | قیمت Proforma ملاک | I |
| AC-EC-06 | ویرایش موازی نسخه | دو Version بدون گم‌شدن | I |
| AC-EC-07 | خطای AI | مسیر انسانی ادامه | I |
| AC-EC-08 | قطع SMS | اعلان In-app سالم + Log | I |
| AC-EC-09 | خطای Storage حین آپلود | Rollback کامل | I |
| AC-EC-10 | تصویر رد کیفیت | پیام + Retry موفق | E2E |
| AC-EC-11 | Proforma رهاشده | یادآوری + Auto-cancel با مسیر بازگشت | I |
| AC-EC-12 | تأیید G1 رهاشده | همینطور | I |
| AC-EC-13 | اقلام ناقص | Proforma اقلام موجود + اطلاع بیمار | E2E |
| AC-EC-14 | فایل Malformed/مخرب | رد پیش از ذخیره + Log | SEC |
| AC-EC-15 | Refresh وسط فرم | بدون از دست رفتن کار | E2E |
| AC-EC-16 | رکورد حذف‌نرم | 404 استاندارد بدون افشا | API, SEC |

## AC — غیرعملکردی (انتخاب کلیدی)

| ID | معیار | تست |
|---|---|---|
| AC-NFR-01 | Queue P95 < 1.5s با ۱۰۰ رکورد | PERF |
| AC-NFR-02 | همه Endpointهای خطا: قالب code/message/details/request_id/timestamp | API |
| AC-NFR-03 | لاگ‌ها JSON ساخت‌یافته با request_id قابل Trace | OBS |
| AC-NFR-04 | `/health` + `/readiness` + `/liveness` پاسخ صحیح | OBS |
| AC-NFR-05 | تغییر زبان FA↔EN: dir و تقویم و همه رشته‌ها سوییچ؛ بدون Reload کامل | UI, E2E |
| AC-NFR-06 | موبایل 390px: ناوبری و جداول قابل استفاده | UI |
| AC-NFR-07 | Secret Scan روی Repo: ۰ یافته | SEC (CI) |
| AC-NFR-08 | ترجمه تاریخ رفت/برگشت شمسی↔میلادی: بدون انحراف | U |

---

## قواعد پذیرش فاز (Definition of Done برای PHASE 01)

- [x] هر FR در PRD حداقل یک AC دارد (نگاشت در RTM)
- [x] هر Gate تأیید (G1–G10) دارای AC است
- [x] هر Edge Case کاتالوگ USE-CASES §5 معادل AC-EC دارد
- [x] معیارهای NFR کلیدی (Performance/Format/Observability) AC دارند
- [ ] فاز 04: هر AC به تست خودکار/دستی واقعی نگاشت و اجرا شود (تعهد Test Plan)
