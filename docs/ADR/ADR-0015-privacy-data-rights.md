# ADR-0015: حقوق داده شخصی — Consent نسخه‌دار + Export + حذف از طریق Anonymization

| فیلد | مقدار |
|---|---|
| شماره | ADR-0015 |
| وضعیت | Accepted |
| تاریخ | 1405/06/14 (2026-09-04) |
| فاز تصمیم | PHASE 05 — Security & Privacy |
| معادل ED | ED-67/68/69/70 |
| اسناد مرتبط | `SECURITY.md §9` · `THREAT-MODEL.md` · `DATABASE.md` (ED-49) |

## Context

فرمان محصول PHASE 05: Consent، Privacy/Terms Acceptance، Data Access، Data Export، Deletion Request، Anonymization، De-identification. تعارض بالقوه: «حق حذف» بیمار ↔ تعهد حسابداری/بالینی نگه‌داری تجمیع‌ها (ED-49 فاز ۰۴: رکوردهای مالی هرگز حذف نمی‌شوند).

## Options

| گزینه | مزایا | معایب |
|---|---|---|
| **A) حذف = ناشناس‌سازی (PII strip + نگه‌داری تجمیع)** | سازگار با ED-49؛ قابل حسابرسی؛ برگشت‌ناپذیر از دید حریم خصوصی | داده بالینی aggregate می‌ماند |
| B) Hard-delete کامل کاربر | ساده | نقض تعهد مالی؛ شکستن FK/تاریخ؛ مغایر §48 مشخصات |
| C) فقط Soft-delete | برگشت‌پذیر است | PII همچنان موجود — «حق فراموشی» برآورده نمی‌شود |

## Decision

**A** + معماری Consent: مدل‌های `ConsentRecord` (نسخه‌دار، MARKETING قابل‌لغو/بقیه تا فعال‌بودن خدمت)، `DeletionRequest` (گردش کار PENDING→COMPLETED/REJECTED)، خروجی خودکار JSON (۱/روز)، و توابع De-identification (`pseudonymize`/`redactText`) برای دیتاست‌ها. ادمین با `ANONYMIZE` اجرا می‌کند: تلفن/نام/کدملی/ایمیل→جاگذار، نشست‌ها ابطال، تصاویر REJECTED/RIGHT_TO_ERASURE، درخواست COMPLETED با `anonymizedAt`.

## Consequences

**مثبت:** حقوق داده برآورده؛ تعهد مالی حفظ؛ رویدادهای Consent/Deletion قابل حسابرسی.
**هزینه:** گردش کار ادمین (صف + پردازش دستی)؛ متن سند TERMS/PRIVACY نسخه‌دار باید توسط محصول نگه‌داری شود.

## Compliance

- pentest: consents اعطا/لغو (MARKETING 200 / PRIVACY 409)، export 200→429، deletion 200→409، admin-gate 403.
- unit: anonymizeUser (PII strip + ابطال نشست + status=COMPLETED)، hashed OTP storage، redactText/pseudonymize.
