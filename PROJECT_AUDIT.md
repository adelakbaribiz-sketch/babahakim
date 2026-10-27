# PROJECT_AUDIT — ممیزی فنی BabaHakim (2026-10-27)

> این سند بر پایه خواندن مستقیم کد، schema، دیتابیس زنده و `dev.log` نوشته شده است، نه بر پایه مستندات قبلی.
> مستندات موجود در `docs/` (PRD، ARCHITECTURE، WORKFLOW و …) معتبر اما ادعای «593/593» آن‌ها مربوط به چرخه قبلی است.

## 1. پشتیبان‌گیری پیش از تغییر

مسیر: `C:\Users\ASUS\Desktop\babahakim\backups\pre-overhaul-20261027-194952\`

| فایل | محتوا |
|---|---|
| `code.bundle` | `git bundle --all` — کل تاریخچه و شاخه‌ها |
| `uncommitted.diff` | تغییرات commit‌نشده درخت کار (فقط حذف `tool-results/*`) |
| `custom.db` | `VACUUM INTO` از دیتابیس زنده؛ `PRAGMA integrity_check = ok` |
| `db-raw-copy/` | کپی خام `custom.db` + `-wal` + `-shm` |
| `storage/` | کپی پوشه رسانه پروژه |
| `env.bak` | فایل `.env` |

بازگردانی: بخش «بازگردانی» در `DEPLOYMENT_GUIDE.md`.

## 2. معماری واقعی

| لایه | فناوری |
|---|---|
| Runtime | Bun 1.4 / Node 24 روی Windows (پروژه در اصل روی لینوکس `/home/z/my-project` ساخته شده) |
| Framework | Next.js 16 (App Router) — یک SPA در `src/app/page.tsx` با view-router داخلی (`src/components/app/routes.ts`) |
| UI | React 19، Tailwind 4، shadcn/ui (Radix)، `cmdk` برای Combobox، `sonner`، RTL فارسی + انگلیسی (`src/lib/i18n.ts`) |
| API | `src/app/api/v1/**/route.ts` — همه از `apiRoute()` (`src/server/api/handler.ts`): request-id، trace، نگاشت خطا، Zod، idempotency |
| لایه کاربرد | `src/server/application/services/*` + DTOهای Zod در `src/server/application/dto.ts` |
| گردش‌کار | موتور State Machine اعلانی `src/lib/workflow/` (11 ماشین: CASE، PRESCRIPTION، ORDER، PAYMENT، SHIPMENT، TICKET، …) — هر گذار در یک تراکنش: به‌روزرسانی وضعیت + `CaseEvent` + `AuditLog` + `WorkflowState` |
| دیتابیس | Prisma 6 + SQLite (`DATABASE_URL=file:/home/z/my-project/db/custom.db` ← روی ویندوز به `C:\home\z\my-project\db\custom.db` تعبیر می‌شود؛ WAL فعال) |
| احراز هویت | JWT دسترسی + Refresh Token چرخشی در کوکی httpOnly، CSRF double-submit، rate-limit درون‌حافظه، قفل حساب پس از ۵ خطا، OTP/MFA (`src/lib/security/otp.ts`) |
| رمزنگاری | AES-256-GCM با `FIELD_ENC_KEY` (`src/lib/security/encryption.ts`) — تا امروز برای هیچ فیلدی استفاده نشده بود |
| رسانه | موتور فایل `StoredFile/Version/Variant` + `sharp`، ذخیره در `./storage` |
| رخداد/صف | Event bus درون‌فرایندی (`server/infrastructure/events.ts`) + `DurableJob` در DB |
| کش | Map درون‌حافظه با TTL (`server/infrastructure/cache.ts`) |
| اعلان | `Notification` + لایه SMS (Kavenegar؛ بدون کلید = mock/log در `SMSLog`) |
| پرداخت | زرین‌پال (request/verify سمت سرور) + کارت‌به‌کارت با رسید و تأیید اپراتور |
| تست | `bun test` — تست‌های واحد در `src/**/__tests__` و تست‌های یکپارچه در `tests/integration` که **به سرور زنده روی پورت 3000** متصل می‌شوند |

### نقش‌ها
`ADMIN`، `EXPERT_1` (کارشناس اول)، `EXPERT_2` (کارشناس دوم)، `DOCTOR`، `OPERATOR`، `PATIENT` — ماتریس مجوز در `src/lib/constants.ts` (`ROLE_PERMISSIONS`)؛ بررسی در Backend با `requireRole/requirePermission` و موتور گردش‌کار.

### داده زنده (لحظه ممیزی)
9 کاربر (۴ بیمار، ۵ کارکنان seed)، 3 پرونده، 2 نسخه، 12 محصول، 2 سفارش، **0 تیکت**.

## 3. مشکلات کشف‌شده (با علت ریشه‌ای)

### P0-1 — تیکت بیمار ثبت نمی‌شود ✅ ریشه پیدا شد
- `src/components/app/views/patient/ShopViews.tsx` — state فرم `{subject, category, message}` است، اما `ticketFormSchema` در `src/lib/forms.ts` فیلد `priority` را **اجباری** می‌خواهد.
- `safeParse` شکست می‌خورد، خطا در `errors.priority` ذخیره می‌شود ولی هیچ فیلدی آن را نمایش نمی‌دهد ← کلیک «ارسال» بی‌صدا هیچ کاری نمی‌کند؛ درخواست هرگز به API نمی‌رسد (تأیید: جدول `Ticket` خالی است و در `dev.log` هیچ `POST /api/v1/tickets` وجود ندارد).
- Backend (`supportService.createTicket`) سالم است.

### P0-2 — رد نسخه توسط پزشک پرونده را می‌بندد ✅ ریشه پیدا شد
- `src/lib/workflow/machines/case.ts` — گذار `DOCTOR_REJECT: WAITING_FOR_DOCTOR → CLOSED` با `closedAt`.
- پرونده از همه صف‌ها خارج می‌شود و هیچ گذاری از `CLOSED` وجود ندارد ← بسته‌شدن دائمی.
- در ماشین نسخه، `REJECTED` پایانی است و بازگشت ممکن نیست.

### P0-3 — کارشناس دوم نمی‌تواند نسخه را به کارشناس اول برگرداند
- تنها گذار از `WAITING_FOR_EXPERT_2`، `EXPERT2_REVIEW` (ارسال به پزشک) است. وضعیت `REVISION_REQUESTED` وجود دارد ولی فقط پزشک (از مسیر دیگری) به آن نمی‌رسد؛ `DOCTOR_REVISION` به `WAITING_FOR_EXPERT_2` می‌رود، نه کارشناس اول.
- کارشناس دوم نمی‌تواند اقلام را اضافه/حذف/ویرایش کند (`expert2ReviewSchema` فقط موجودی و قیمت را می‌پذیرد).

### P0-4 — وضعیت «قهوه‌ای» در «آخرین رخدادها» ✅ ریشه پیدا شد
- `StaffViews.tsx` برای هر رخداد، نشان رنگی **`toStatus` تاریخی آن رخداد** را نشان می‌دهد. رنگ `warning` = `#B45309` (کهربایی تیره، دیده‌شده به‌صورت قهوه‌ای) برای `WAITING_FOR_USER_APPROVAL`.
- دیتابیس درست به‌روز می‌شود (پرونده‌های زنده تا `DELIVERED` و `WAITING_FOR_PAYMENT` جلو رفته‌اند)، اما رخداد «ارزیابی ارسال شد» برای همیشه با برچسب «در انتظار تأیید کاربر» و رنگ قهوه‌ای نمایش داده می‌شود و وضعیت فعلی پرونده هیچ‌جا در این ویجت نیست.
- عامل دوم: داشبورد staff (`dash:staff:shared` و صف‌ها) و داشبورد بیمار ۱۵ ثانیه کش می‌شوند و **هیچ گذار گردش‌کاری کش را باطل نمی‌کند** ← بلافاصله پس از اقدام، داده قدیمی دیده می‌شود.

### P0-5 — احراز هویت با موبایل یکتا؛ کد ملی استفاده نمی‌شود
- `User.phone @unique` ← دو عضو یک خانواده نمی‌توانند ثبت‌نام کنند.
- `User.nationalId` وجود دارد ولی در هیچ مسیری نوشته/خوانده نمی‌شود.
- ورود، OTP و MFA همه با `findUnique({ phone })` کار می‌کنند ← با برداشتن یکتایی باید به شناسه کاربر منتقل شوند.

### P1 — یافته‌های هسته بیمار
- مزاج‌شناسی: `assertEnoughAnswers` ارسال ناقص را رد می‌کند؛ ذخیره پیش‌نویس، وضعیت تکمیل و نسخه الگوریتم وجود ندارد. `Questionnaire.version` هست ولی پاسخ‌ها snapshot نسخه سؤال/امتیاز را ذخیره نمی‌کنند (فقط امتیاز گزینه).
- پروفایل: استان/شهر متن آزاد؛ سن عددی وجود ندارد؛ داروها و حساسیت‌ها متن آزاد (`currentMeds`, `allergies`).
- رضایت‌نامه: `ConsentRecord` با `version` وجود دارد، اما متن رضایت‌نامه قابل مدیریت نیست و آپلود عکس زبان رضایت `MEDICAL_IMAGE_AI` را بررسی نمی‌کند.

### P2 — فروشگاه و نسخه
- انتخاب محصول در نسخه با `Select` ساده روی کل فهرست؛ دوز/تناوب/مدت متن آزاد.
- هر محصول یک تصویر؛ دسته‌بندی/برند رشته آزاد؛ پک، تدابیر، واژه‌نامه دوز و تداخل دارویی وجود ندارند.
- هزینه ارسال ثابت در کد (`SHOP_SHIPPING_COST`)؛ روش پرداخت/ارسال قابل مدیریت نیست.
- Import/Export قیمت با CSV وجود دارد (`priceEngineSchema`).

### P3/P4
- بایگانی پرونده، فیلتر زمانی، ستون‌های هویتی کامل، عضویت، نوبت‌دهی، نظرسنجی: وجود ندارند.
- گزارش‌ها و خروجی CSV/XLSX در `ReportsCenter` و `server/infrastructure/reporting` موجودند.

### یافته‌های محیطی
- `DATABASE_URL` به مسیر لینوکسی اشاره می‌کند؛ روی ویندوز به‌طور تصادفی به `C:\home\z\...` نگاشت شده و کار می‌کند.
- `JWT_SECRET` و `FIELD_ENC_KEY` تنظیم نشده‌اند ← کلید dev مشتق‌شده (در production سرویس بالا نمی‌آید — رفتار درست).
- `tsc --noEmit`: صفر خطا (baseline).
- تست‌های یکپارچه به سرور روی :3000 و دیتابیس همان سرور وصل می‌شوند ← **نباید روی دیتابیس زنده اجرا شوند**؛ برای این کار یک DB آزمون جداگانه ساخته شد (`DEPLOYMENT_GUIDE.md`).

## 4. ریسک‌ها
| ریسک | کنترل |
|---|---|
| تغییر یکتایی `phone` روی داده زنده | Migration نسخه‌دار + پشتیبان؛ ستون حذف نمی‌شود، فقط index یکتا برداشته می‌شود |
| ذخیره کد ملی | رمز AES-GCM + blind index (HMAC) یکتا؛ مقدار خام هرگز در DB/لاگ/Audit نیست |
| تغییر گذارهای CASE | تست‌های واحد موجود (`workflow.test.ts`) + تست‌های جدید؛ وضعیت جدید اضافه نمی‌شود، از `REVISION_REQUESTED` موجود استفاده می‌شود |
| حجم نیازمندی‌ها (~60 بند) | اجرای مرحله‌ای P0→P4؛ هر بند در `IMPLEMENTATION_REPORT.md` با وضعیت صادقانه |
| اطلاعات پزشکی (تداخل، دوز) | هیچ داده پزشکی ساختگی seed نمی‌شود؛ ساختار و پنل مدیریت ساخته می‌شود و پر کردن آن با منبع معتبر بر عهده متخصص است |

## 5. برنامه اجرا
1. **P0**: تیکت (فرم + فیلد اولویت + تست یکپارچه)، گردش‌کار رد پزشک/برگشت کارشناس دوم، رخدادها و باطل‌سازی کش، ورود با کد ملی + موبایل مشترک + تغییر کد ملی فقط توسط مدیر با Audit.
2. **P1**: سن/تاریخ تولد، استان/شهر جست‌وجوپذیر، مزاج اختیاری و ناقص با نسخه الگوریتم.
3. **P2**: کمبوباکس جست‌وجوی سروری محصول در نسخه، واژه‌نامه دوز/تناوب/مدت، ویرایش اقلام توسط کارشناس دوم.
4. **P3**: ستون‌های هویتی پرونده، فیلتر زمانی، بایگانی/بازگردانی.
5. **P4** و موارد باقی‌مانده: طبق ظرفیت؛ هر مورد اجرانشده در `KNOWN_ISSUES.md` با وضعیت «پیاده‌سازی‌نشده».
