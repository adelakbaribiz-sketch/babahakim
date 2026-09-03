# ADR-0004: PostgreSQL + Prisma + Schema به ازای هر Context

| فیلد | مقدار |
|---|---|
| شماره | ADR-0004 |
| وضعیت | Accepted |
| تاریخ | 1405/06/14 (2026-09-04) |
| فاز تصمیم | PHASE 03 — System Architecture |
| معادل ED | ED-38 |
| اسناد مرتبط | `ARCHITECTURE.md §8` · `ARCHITECTURE-DIAGRAM.md §10` · `WORKFLOW.md` |

## Context

داده فعلی روی SQLite (`db/custom.db`) با ۳۶ مدل Prisma و Migrationهای Jاری (baseline + `20260903221412_ai_review_workflow_fields`) است. برای Production نیاز است: ORM واحد با Type-safety، پشتیبانی Transaction واقعی برای Cascade مالی (C2)، جداول Append-only (AuditLog)، و مالکیت داده به‌ازای-Context (ADR-0002). قید: هیچ داده پزشکی واقعی در dev (C5) و تغییر Schema فقط با Migration (قاعده ۸ منشور).

## Options

| گزینه | مزایا | معایب |
|---|---|---|
| **A) PostgreSQL + Prisma + schema-per-context** | ACID قوی؛ schema بومی برای مرزبندی؛ Prisma تکرار کم؛ Community | نیازمند سرور DB (Docker) |
| **B) SQLite در prod** | صفر-Ops | Concurrency نوشتن ضعیف؛ بدون schema جدا؛ بدون replica |
| **C) MongoDB** | Schema انعطاف‌پذیر | رابطه‌های Rich ما (Case↔Event↔Invoice) رابطه‌ای‌اند؛ Transactionها پیچیده‌تر |
| **D) PostgreSQL + Drizzle** | SQL-first | مهاجرت از Prisma موجود = Rewrite لایه داده ۳۶-مدلی |

## Decision

**PostgreSQL 16 به‌عنوان OLTP اصلی + Prisma ORM + یک Database Schema به ازای هر Bounded Context** (`identity`, `patients`, `medical_records`, `ai`, `clinical_review`, `products`, `prescriptions`, `commerce`, `payments`, `shipping`, `notifications`, `tickets`, `finance`, `administration`, `reporting`).

- **FK بین‌Schemaای ممنوع** — ارتباط Cross-Context فقط Soft Reference (ID) + Lookup از Facade (D4).
- هر Context فقط مدل‌های Schema خودش را Query می‌کند (D3) — در Prisma با نگاشت مدل → Context در تست معماری اعمال می‌شود.
- **SQLite در dev فعلی می‌ماند** به‌عنوان استثنای موقت مستند؛ مسیر مهاجرت ۴-گامی (فعال‌سازی Compose → تغییر datasource → اعمال Migrationها روی DB خالی → تست‌ها) در `ARCHITECTURE.md §8.4` تعریف شد. مرز Context در دوره SQLite با prefix + تست معماری حفظ می‌شود.

## Consequences

**مثبت:**
- جداسازی فیزیکی مالکیت داده ⇒ Extraction آینده هر Context بدون مذاکره جدول.
- Transaction اتمیک Cascade (ED-33) روی ACID واقعی.
- Schema `reporting` برای Read Modelهای آینده از الان رزرو شده.

**منفی/هزینه:**
- دو حالت dev (SQLite محلی سریع / Postgres Compose) باید هر دو در CI تست شوند پس از مهاجرت.
- Prisma multi-schema نیازمند `@@schema` روی مدلها و بازتولید client است (یک Migration نگاشت‌دار، بدون تغییر منطق).

## Compliance

- تست معماری نگاشت ۳۶ مدل → Context را اعتبارسنجی می‌کند (هیچ مدل بدون مالک، هیچ مالکِ دوگانه).
- `prisma migrate dev` تنها مسیر تغییر Schema (قاعده ۸) — PRهای حاوی diff دستی SQL بدون migration رد می‌شوند.
- پس از مهاجرت: سوئیت تست کامل روی Postgres اجرا می‌شود (همان الگوی Phase 02).
