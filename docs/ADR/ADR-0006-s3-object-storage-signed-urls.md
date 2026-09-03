# ADR-0006: Object Storage سازگار S3 + Signed URL برای تصاویر پزشکی

| فیلد | مقدار |
|---|---|
| شماره | ADR-0006 |
| وضعیت | Accepted |
| تاریخ | 1405/06/14 (2026-09-04) |
| فاز تصمیم | PHASE 03 — System Architecture |
| معادل ED | ED-40 |
| اسناد مرتبط | `ARCHITECTURE.md §3, §9` · PRD P5 (Privacy by Design) · `src/lib/storage.ts` |

## Context

تصاویر زبان، حساس‌ترین داده BabaHakim هستند (P5: هرگز Public نمی‌شوند؛ دسترسی فقط Signed URL منقضی‌شونده با Audit `VIEW_MEDICAL_FILE`). وضعیت فعلی: فایل‌ها روی Disk اپ (`storage/uploads/`) با ۴ واریانت (original/compressed/ai/thumb)، HMAC Signed URL پیاده‌سازی‌شده، کیفیت ارزیابی‌شده با sharp. برای Production: استقرار چند-Replica (web2+) ⇒ Disk محلی به‌عنوان Source مشترک کار نمی‌کند.

## Options

| گزینه | مزایا | معایب |
|---|---|---|
| **A) S3-compatible (MinIO dev / S3-اروان prod) + Port `ObjectStorage`** | استاندارد API؛ Presigned URL؛ Replica-safe؛ Lifecycle | یک زیرساخت جدید در Compose |
| **B) NFS/Volume مشترک** | ساده | Single-host وابسته؛ بدون Presign/Versioning؛ Ops دستی |
| **C) ذخیره در PostgreSQL (bytea)** | Backup یکجا | DB متورم؛ latency؛ عملاً ضد-الگو برای Blob |

## Decision

**همه فایل‌های باینری (تصاویر ۴-واریانتی، رسیدهای کارت‌به‌کارت، تصاویر اثباتی) در Object Storage سازگار S3 با Bucket خصوصی `bh-medical` نگهداری می‌شوند** — MinIO در dev، S3/اروان‌کلود در prod — و کد از طریق **Port `ObjectStorage`** در Kernel به آن دسترسی دارد.

- **معماری دسترسی:** Bucket خصوصی، بدون دسترسی عمومی؛ خواندن فقط با Presigned URL کوتاه‌عمر ( TTL پیش‌فرض ۵ دقیقه، قابل تنظیم)؛ هر صدور URL با Audit ثبت می‌شود (الگوی موجود `VIEW_MEDICAL_FILE` حفظ می‌شود).
- **Adapterها:** `local-fs` (وضعیت فعلی — سازگاری dev بدون Docker)، `s3` (AWS SDK). انتخاب Adapter از Env.
- **داده DB:** فقط متادیتا (کلید شیء، SHA-256، اندازه، کیفیت JSON، واریانت) — طبق `ARCHITECTURE.md §8.2`.
- **Migration:** اسکریپت یک‌بارمصرف انتقال `storage/uploads/*` موجود به Bucket (کلید = همان الگوی فعلی).

## Consequences

**مثبت:**
- Replica-safe (web2+ همه از همان Bucket می‌خوانند) — پیش‌نیاز Scale افقی.
- جداسازی Backup: DB کوچک می‌ماند؛ Lifecycle/Versioning برای Compliance آینده.

**منفی/هزینه:**
- یک سرویس دیگر در Compose؛ latency شبکه در dev (قابل قبول).
- تست E2E باید با MinIO (نه فقط local-fs) اجرا شود پس از فعال‌سازی.

## Compliance

- تست امنیتی: هیچ مسیر عمومی (URL بدون امضا/منقضی) به فایل پزشکی نمی‌رسد؛ TTL با زمان منقضی در تست شبیه‌سازی می‌شود.
- تست معماری: کد تولیدی نباید `fs.writeFile` مستقیم برای uploadها داشته باشد (فقط Adapter local-fs داخل Kernel).
- Audit رکورد صدور هر Signed URL (continuity رفتار فعلی).
