# ADR-0013: Alembic به‌عنوان مرجع یکتای DDL (Python) — Prisma فقط Introspection

| فیلد | مقدار |
|---|---|
| شماره | ADR-0013 |
| وضعیت | Accepted |
| تاریخ | 1405/06/14 (2026-09-04) |
| فاز تصمیم | PHASE 04 — Database Architecture |
| معادل ED | ED-47 |
| اسناد مرتبط | `ADR-0004` (بخشی Supersede) · `DATABASE.md` · `DATABASE-ERD.md` · `BUSINESS-RULES.md §5` |

## Context

ADR-0004 هدف PostgreSQL 16 + Prisma + Schema-per-Context را قطعی کرد، اما ابزار Migration را ضمناً `prisma migrate` فرض کرده بود. در PHASE 04 فرمان صریح محصول: «Migration با Alembic» آمده است؛ همچنین معماری هدف (ADR-0007) سرویس AI را FastAPI/Python در نظر می‌گیرد و Monorepo ظرفیت زیرپروژه Python را دارد. لازم است مالکیت DDL بدون شکاف یا ابزار موازی تعیین شود.

## Options

| گزینه | مزایا | معایب |
|---|---|---|
| **A) Alembic مرجع DDL + Prisma Introspection** | فرمان صریح محصول؛ ابزار Migration بالغ (autogenerate/check/downgrade)؛ هم‌زبان با AI-Service؛ کنترل کامل روی Trigger/Partial/BRIN/trgm (خارج از DSL Prisma) | دو زبان در Monorepo؛ Prisma client از Introspection تولید می‌شود (نه Schema-first) |
| B) prisma migrate بماند | یک زبان | نقض فرمان محصول؛ Trigger/BRIN/trgm در DSL Prisma پشتیبانی کامل ندارد (نیاز به SQL خام موازی = دو مرجع) |
| C) هر دو فعال | انعطاف | **دو منبع حقیقت** = Drift تضمین‌شده؛ رد |

## Decision

**Alembic (SQLAlchemy 2.0 Metadata) تنها مرجع ساختار دیتابیس PostgreSQL است.** جریان: مدل در `database/models/` → `alembic revision --autogenerate` → بازبینی → `upgrade head` → `alembic check` (صفر Drift) → pytest (۸۵ تست — پروویژن فقط از مسیر Migration).

اپ Next.js در فاز بعدی با Prisma از طریق **`prisma db pull` (Introspection)** به همین دیتابیس وصل می‌شود — Prisma ابزار دسترسی/Type-safety است، نه ابزار DDL. این جایگزینی **جزئی** ADR-0004 است (Schema-per-Context و قواعد D3/D4 دست‌نخورده باقی می‌مانند).

## Consequences

**مثبت:**
- Triggerهای امنیتی (Append-Only / forbid_hard_delete)، Partial Index، BRIN و trgm در قلب Pipeline Migration (قابل تست و نسخه‌بندی) قرار می‌گیرند.
- `alembic check` Drift مدل↔دیتابیس را در CI قابل اعتبارسنجی می‌کند (قاعده ۲ منشور).
- چرخه `downgrade base → upgrade head` تست‌شده = Backfill/Rollback مطمئن.

**منفی/هزینه:**
- Monorepo دو زبان می‌شود (Node + Python) — venv اختصاصی `database/.venv` و `requirements.txt` مدیریت می‌شود.
- مهاجرت اپ به PostgreSQL نیازمند Introspection + بازتولید client است (یک‌باره، مستند در §8.4 ARCHITECTURE).

## Compliance

- تست `test_migrations.py::test_alembic_check_no_drift` — صفر Drift مدل↔DB.
- تست چرخه کامل Migration (down/up) — بازیابی ۴۹ جدول + ۴۴ تریگر + دیفالت‌ها.
- قاعده منشور ۸: PR حاوی DDL خارج از `database/alembic/versions/` رد می‌شود.
- تست `test_no_cross_schema_foreign_keys` — قاعده D4 همچنان برقرار.
