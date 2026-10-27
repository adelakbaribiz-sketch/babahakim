# DATABASE_MIGRATIONS

## Migrationهای این چرخه

| نام | محتوا | داده |
|---|---|---|
| `20261027120000_overhaul_identity_archive_vocab` | حذف index یکتای `User.phone` + index معمولی · ستون‌های `User.nationalIdHash` (unique)، `nationalIdEnc`، `ageYears`، `ageRecordedAt` · `OtpChallenge.userId` · `MedicalCase.archivedAt/archivedById/archiveReason` + index · `Question.required/weight/category` · `QuestionnaireResponse.status/answeredCount/totalQuestions/questionnaireVersion/scoringVersion/updatedAt` · جدول `ClinicalVocabulary` | بدون حذف داده؛ جداول `Question` و `QuestionnaireResponse` با `INSERT … SELECT` بازسازی می‌شوند (روش استاندارد Prisma برای SQLite). پاسخ‌های قدیمی `status=COMPLETED` می‌گیرند. |
| `20261027130000_vocabulary_defaults` | ۳۶ گزینه قالبی دوز/واحد/تناوب/مدت/هشدار | `INSERT OR IGNORE` — تکرارپذیر، ویرایش‌های مدیر را بازنویسی نمی‌کند |

## مهم: دیتابیس زنده با `db push` ساخته شده بود
جدول `_prisma_migrations` وجود نداشت؛ `prisma migrate deploy` مستقیم روی آن، `0_init` را دوباره اجرا می‌کرد. برای همین `scripts/db-migrate-safe.mjs` ساخته شد:
1. پشتیبان سازگار `VACUUM INTO` کنار دیتابیس (`custom.db.pre-migrate-<زمان>.db`)
2. اگر جدول تاریخچه نباشد، migrationهای تا `20260907090000_reliability_phase17` را `resolve --applied` می‌کند (پیش از اجرا تأیید شد که schema زنده دقیقاً برابر schema قبلی است: `prisma migrate diff` → empty)
3. `prisma migrate deploy`
4. `PRAGMA integrity_check` + مقایسه تعداد ردیف قبل/بعد؛ اگر ردیفی کم شود با کد 2 خارج می‌شود

```bash
bun run db:migrate:safe
```

## اجرای انجام‌شده
- روی کپی تست (`testenv\test.db`): موفق، integrity ok، بدون کاهش ردیف.
- **روی دیتابیس زنده** (`C:\home\z\my-project\db\custom.db`) در 2026-10-27: موفق؛ integrity ok؛ تعداد پس از مهاجرت: 9 کاربر، 3 پرونده، 2 نسخه، 12 محصول، 3 پاسخ پرسشنامه، 15 سؤال (برابر قبل) + 36 گزینه واژه‌نامه؛ 11 ردیف در `_prisma_migrations`.
  پشتیبان خودکار: `C:\home\z\my-project\db\custom.db.pre-migrate-2026-10-27T17-11-10-058Z.db`

## بازگردانی
1. سرور را متوقف کنید.
2. یکی از پشتیبان‌ها را جایگزین کنید (فایل‌های `-wal` و `-shm` کنار دیتابیس را هم حذف کنید):
   - `C:\home\z\my-project\db\custom.db.pre-migrate-2026-10-27T17-11-10-058Z.db`
   - یا `C:\Users\ASUS\Desktop\babahakim\backups\pre-overhaul-20261027-194952\custom.db`
3. کد را به نسخه قبل برگردانید: `git stash` (یا `git checkout -- .` پس از ذخیره تغییرات دلخواه)، یا از `code.bundle` همان پوشه پشتیبان.
4. `node_modules\.bin\prisma generate`

کد جدید با schema قدیم کار نمی‌کند (ستون‌های جدید)؛ کد و دیتابیس باید با هم برگردانده شوند.

## به‌روزرسانی: آماده‌سازی برای سرور (همان روز)
- **کشف**: دیتابیسی که از صفر با migrationها ساخته شود، جداول/ستون‌های فاز ۱۰ و ۱۱ (StoredFile*، AIPromptTemplate، AIDataset*، AIInferenceLog، AIEvaluationReport، ستون‌های AIModel، ستون‌های MedicalImage/Product) را نداشت، چون قبلاً با `db push` اضافه شده بودند ← استقرار تازه روی سرور خراب می‌شد.
- **اصلاح**: migration `20260920000000_reconcile_db_push_drift` (پیش از دو migration این چرخه). اکنون دیتابیس ساخته‌شده از migrationها با `schema.prisma` **صفر اختلاف** دارد (`prisma migrate diff` → empty).
- `scripts/db-migrate-safe.mjs` بازنویسی شد و سه حالت را پشتیبانی می‌کند: بدون فایل (ساخت از صفر)، db push بدون تاریخچه (baseline تا reconcile)، دارای تاریخچه (ثبت reconcile به‌عنوان اعمال‌شده). فقط وقتی کاری pending باشد پشتیبان می‌گیرد؛ اجرای مجدد no-op است. همین اسکریپت در entrypoint داکر اجرا می‌شود.
- روی دیتابیس زنده اجرا شد (پشتیبان: `custom.db.pre-migrate-2026-10-27T17-54-41-390Z.db`)؛ اختلاف schema: صفر.
