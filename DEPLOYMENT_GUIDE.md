# DEPLOYMENT_GUIDE — پس از چرخه 2026-10

راهنمای کامل استقرار production همچنان `docs/DEPLOYMENT.md` است. این سند فقط تفاوت‌ها و مراحل اجرای فعلی روی ویندوز را می‌گوید.

## اجرای محلی (دیتابیس زنده)
```bash
bun install
```
```bash
bun run db:migrate:safe
```
```bash
bun run dev
```
مرورگر: `http://localhost:3000`

> اسکریپت `dev` از `tee` استفاده می‌کند؛ اگر در PowerShell خطا داد: `bunx next dev -p 3000`.

## اجرای ایزوله برای تست
1. یک کپی از دیتابیس بسازید و مسیرش را در `.env.test-server` بنویسید (فایل نمونه فعلی به `..\testenv\test.db` اشاره می‌کند؛ `BH_CHAOS=1` فقط برای این سرور).
2. ```bash
   bun run dev:testdb
   ```
   لانچر اگر `DATABASE_URL` به دیتابیس زنده اشاره کند، اجرا نمی‌شود و خروجی سرور را در `..\testenv\server.log` هم می‌نویسد.
3. ```bash
   bun test src tests
   ```
   با متغیرهای `DATABASE_URL` (همان کپی) و `BH_QA_SERVER_LOG` (مسیر server.log).

## متغیرهای محیطی جدید/مهم
| متغیر | توضیح |
|---|---|
| `FIELD_ENC_KEY` | **حیاتی**: کلید ۳۲ بایتی base64. رمزنگاری کد ملی و blind index ورود از آن مشتق می‌شود. تغییر آن = از کار افتادن ورود با کد ملی و خواندن کدهای ملی. در حال حاضر تنظیم نشده و کلید dev مشتق‌شده استفاده می‌شود؛ پیش از production باید تنظیم و قبل از ثبت‌نام‌های واقعی ثابت شود (تعویض بعدی نیازمند اسکریپت re-key است که وجود ندارد). |
| `JWT_SECRET` | بدون تغییر نسبت به قبل (در production اجباری). |
| `BH_PDF_FONT`، `BH_PDF_FONT_BOLD`، `BH_PDF_FONT_MONO` | اختیاری — مسیر فونت فارسی برای خروجی PDF؛ پیش‌فرض: FreeSerif لینوکس، سپس tahoma ویندوز. |
| `SMS_PROVIDER_KEY` | بدون کلید، OTP بازیابی و اعلان‌ها پیامک واقعی ارسال نمی‌کنند (فقط لاگ/mock). |
| `ZARINPAL_MERCHANT_ID` و … | بدون تغییر؛ اتصال واقعی تست نشده. |

## اعتبارنامه‌های لازم برای اتصال واقعی (مقادیر عمداً اینجا نیستند)
- پنل پیامک (Kavenegar یا جایگزین) برای OTP/اعلان.
- Merchant ID زرین‌پال و دامنه callback.
- (برای آینده) درگاه بانکی، API ارسال.

## نکته مهاجرت کاربران فعلی
۴ بیمار موجود کد ملی ندارند و با موبایل وارد می‌شوند؛ هر کدام می‌توانند **یک‌بار** از پروفایل کد ملی ثبت کنند، یا مدیر از `PUT /api/v1/admin/users/national-id` ثبت کند. ورود با موبایل برای حساب قدیمی حتی اگر خویشاوندی با همان موبایل ثبت‌نام کند حفظ می‌شود.

## استقرار روی سرور (Docker) — به‌روزرسانی
راهنمای کامل انگلیسی: `docs/en/PRODUCTION-DEPLOYMENT.md`. خلاصه:
1. `cp .env.production.example .env.production` و پر کردن آن؛ اسرار با `bash scripts/gen-secrets.sh`.
2. `docker compose -f docker-compose.prod.yml --env-file .env.production build`
3. اولین بار: `docker compose -f docker-compose.prod.yml --env-file .env.production --profile tools run --rm bootstrap` — فقط داده مرجع + یک مدیر از `BH_ADMIN_PHONE`/`BH_ADMIN_PASSWORD`؛ هیچ حساب دمو ساخته نمی‌شود.
4. `docker compose -f docker-compose.prod.yml --env-file .env.production up -d`
- سرور بدون `JWT_SECRET`/`FIELD_ENC_KEY` اصلاً بالا نمی‌آید (قبلاً بالا می‌آمد و در اولین ورود خطا می‌داد).
- seed دمو با `NODE_ENV=production` اجرا نمی‌شود.
- در دیتابیس زنده فعلی هیچ کد ملی ثبت نشده است؛ پس می‌توانید `FIELD_ENC_KEY` تولید را همین حالا بدون نیاز به انتقال تنظیم کنید.
- CI در GitHub: build، تست، اسکن امنیتی، ساخت image و push به ghcr؛ استقرار SSH فقط با متغیر مخزن `DEPLOY_ENABLED=true` و secrets مربوط.
- **تأییدنشده محلی**: ساخت image داکر (Docker Desktop روی این سیستم اجرا نشد)؛ اولین push به main آن را در CI می‌سازد.
