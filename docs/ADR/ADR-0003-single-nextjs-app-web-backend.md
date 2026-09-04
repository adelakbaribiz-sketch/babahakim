# ADR-0003: یک Deployable واحد برای Frontend و Backend (Next.js App Router)

| فیلد | مقدار |
|---|---|
| شماره | ADR-0003 |
| وضعیت | Accepted |
| تاریخ | 1405/06/14 (2026-09-04) |
| فاز تصمیم | PHASE 03 — System Architecture |
| معادل ED | ED-37 |
| اسناد مرتبط | `ARCHITECTURE.md §3` · `WORKFLOW.md` · PRD §12 |

## Context

BabaHakim از فاز 00 روی Next.js 16 (App Router) با React 19 + Tailwind 4 + shadcn/ui ساخته شده است. باید مشخص شود Frontend و Backend دو Deployable جدا هستند یا یک واحد. قیدها: C1 (تیم کوچک)، C4 (VSCode + Docker)، SPA دوزبانه فعلاً تک-Route `/` است، ۲۵ Route Handler تحت `/api/v1` فعال‌اند، و i18n (fa/en + RTL/LTR + تقویم جلالی) در Client انجام می‌شود.

## Options

| گزینه | مزایا | معایب |
|---|---|---|
| **A) Next.js واحد (SSR/API یکجا)** | یک Deploy؛ اشتراک TypeScript types بین Front/Back (بدون Codegen)؛ Build موجود و اثبات‌شده | مقیاس Front و Back به هم گره می‌خورد |
| **B) SPA (Vite) + API جدا (NestJS/Express)** | جداسازی کامل | دو Build/Deploy/CI؛ از scaffold موجود فاصله؛ Codegen type یا تکرار تعریف |
| **C) SSR کامل (بدون SPA)** | SEO بهتر | پرونده پزشکی اساساً پشت Login است؛ SEO ارزش بالینی ندارد |

## Decision

**BabaHakim یک Deployable واحد `web` (Next.js App Router) دارد:** Frontend (App Router، فعلاً SPA تک-Route) و Backend (Route Handlers نازک زیر `/api/v1`) در همان Build. منطق دامنه در `src/modules/*` (ADR-0002) زندگی می‌کند و Routeها فقط HTTP → Facade ترجمه می‌کنند (الگوی موفق فاز 02 که منطق Transition را از Route به Engine منتقل کرد).

فرآیندهای Async (AI/Notify/SLA/Report) در **Process جدا `worker`** با همان Codebase اجرا می‌شوند (ADR-0011) — یعنی «یک Codebase، دو Entry Point». صفحات عمومی (Landing/Auth) در فازهای بعد می‌توانند به Server Components مهاجرت کنند بدون تغییر معماری.

## Consequences

**مثبت:**
- یک Build/Deploy/CI برای کل UX+API؛ اشتراک مستقیم typeها.
- با Stage موجود سازگار (بدون Rewrite — قاعده ۵ منشور).

**منفی/هزینه:**
- Long-running requestها می‌توانند Event Loop را مشغول کنند (کاهش: بار سنگین به Worker/Queue منتقل می‌شود — ADR-0005).
- Standalone build + image Docker باید برای هر دو Entry Point (web/worker) پیکربندی شود.

## Compliance

- قاعده «Route نازک» با بازبینی PR + تست: Route Handler نباید منطق دامنه داشته باشد (استثنا: Validation Zod و شکل‌دهی Response).
- Health endpoint `/api/health` در CI استقرار بررسی می‌شود.
- tsc + eslint + `bun test` در هر PR روی همان Codebase واحد.
