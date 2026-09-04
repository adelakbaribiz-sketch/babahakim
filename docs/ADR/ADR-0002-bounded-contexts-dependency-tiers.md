# ADR-0002: ۱۵ Bounded Context + مدل Tier وابستگی

| فیلد | مقدار |
|---|---|
| شماره | ADR-0002 |
| وضعیت | Accepted |
| تاریخ | 1405/06/14 (2026-09-04) |
| فاز تصمیم | PHASE 03 — System Architecture |
| معادل ED | ED-36 |
| اسناد مرتبط | `ARCHITECTURE.md §4, §5, §6` · `ARCHITECTURE-DIAGRAM.md §3, §4` |

## Context

Monolith بدون مرز دامنه‌ای، به‌سرعت به Big Ball of Mud تبدیل می‌شود و Extraction آینده ناممکن می‌گردد. باید:
- مرزهای دامنه با زبان کسب‌وکار (نه لایه‌های فنی Controller/Service/Repository) تعریف شوند؛
- هر داده تک‌مالک باشد؛
- چرخه وابستگی (Circular Dependency) به‌صورت ساختاری غیرممکن شود.

## Options

| گزینه | مزایا | معایب |
|---|---|---|
| **A) لایه‌بندی فنی** (controllers/services/repos) | آشنایی عمومی | وابستگی عرضی بین Features؛ مرز دامنه نامرئی؛ چرخه‌های پنهان |
| **B) Bounded Context با Tierهای عددی** | DAG تضمین‌شده؛ مالکیت داده صریح؛ آماده Extraction | نیاز به انضباط import؛ هزینه اولیه تعریف Facade |
| **C) Package-by-feature بدون قاعده وابستگی** | ساده شروع | چرخه‌ها آزادانه رشد می‌کنند |

## Decision

**BabaHakim ۱۵ Bounded Context دارد** — Identity, Patients, Medical Records, AI, Clinical Review, Products, Prescriptions, Commerce, Payments, Shipping, Notifications, Tickets, Reporting, Finance, Administration — در `src/modules/<context>/` با ساختار `api/ domain/ infra/ events/`.

**مدل وابستگی Tier:** K(ernel) → T0 → T1 → T2 → T3 → T4 → T5؛ وابستگی فقط به Tier پایین‌تر (قاعده D1). ۸ قاعده D1..D8 (فقط Public Facade، تک‌مالکیتی مدل‌ها، Soft Reference، تقسیم Sync/Async، ممنوعیت import در Reporting/Finance، خنثی‌بودن Kernel، ممنوعیت چرخه) تعریف شد. چون هر Context دقیقاً یک Tier دارد و پیکان‌ها فقط رو به پایین‌اند، **گراف وابستگی DAG است و چرخه ریاضیاتاً ناممکن می‌شود.**

## Consequences

**مثبت:**
- ریشه‌ای‌ترین مکانیزم ضد-چرخه (ساختاری، نه صرفاً بازبینی).
- تفکیک واضح مالکیت ۳۶ مدل Prisma فعلی (جدول §4.1 سند معماری).
- مسیر Extraction مشخص: هر Context یک «Package آماده-شکستن».

**منفی/هزینه:**
- Lookup بین‌Contextی باید از Facade/Event بگذرد (نه Query مستقیم) — کمی بیشتر کدنویسی.
- افزودن Context جدید نیازمند تعیین Tier و به‌روزرسانی قواعد تست معماری.

## Compliance

- `architecture.test.ts` (ADR-0010) در هر CI: (الف) فقط `api` import شده، (ب) `TIER[from] >= TIER[to]`، (ج) Kernel هیچ import از modules ندارد.
- dependency-cruiser برای بررسی سطح Path در CI.
- نقض D-قواعد = خطای build، نه هشدار.
