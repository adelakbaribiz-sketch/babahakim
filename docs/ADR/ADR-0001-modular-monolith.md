# ADR-0001: Modular Monolith بر Microservices ترجیح داده می‌شود

| فیلد | مقدار |
|---|---|
| شماره | ADR-0001 |
| وضعیت | Accepted |
| تاریخ | 1405/06/14 (2026-09-04) |
| فاز تصمیم | PHASE 03 — System Architecture |
| معادل ED | ED-35 |
| اسناد مرتبط | `ARCHITECTURE.md §2` · `ARCHITECTURE-DIAGRAM.md §13` · PRD §12 |

## Context

مستقیم‌ترین سوال معماری BabaHakim: سیستم به‌صورت Microservices ساخته شود یا Modular Monolith؟ قیدهای حاکم:
- **C1:** تیم کوچک (۱-۳ نفر) — ظرفیت Ops برای ده‌ها Service نیست.
- **C2:** Cascade پرداخت (Payment→Invoice→Order→Case) باید اتمیک بماند (ED-33).
- **C3:** AI باید مستقل Scale شود (GPU) — بدون Deploy مجدد کل سیستم.
- **C4:** استقرار هم VSCode هم Docker.
- داده پزشکی ⇒ ریسک ناسازگاری توزیع‌شده در سطح «سلامت بیمار» است، نه فقط UX.

## Options

| گزینه | مزایا | معایب |
|---|---|---|
| **A) Modular Monolith** (ماژول‌های مرزدار در یک Codebase/Process) | یک Transaction ACID؛ یک Deploy؛ Latency در-پروسه؛ Ops ساده؛ سرعت Iteration بالا | Fault Isolation ضعیف‌تر؛ Scale کل به‌صورت یکجا |
| **B) Microservices از روز اول** | Scale/Deploy مستقل؛ Fault Domain کوچک | Saga اجباری برای C2؛ Distributed Tracing اجباری؛ ۱۰+ Deployable با تیم ۱-۳ نفره؛ هزینه چند برابر |
| **C) Serverless/managed همه‌چیز** | Ops نزدیک صفر | Cold-start برای AI؛ قفل به Vendor؛ محدودیت اجرای مدل روی GPU |

## Decision

**BabaHakim v1 به‌صورت Modular Monolith ساخته می‌شود.** Microservices به‌صورت «افق معیارمحور» باقی می‌ماند و سیستم از الان با ۵ قاعده Extraction-Readiness برای آن آماده می‌شود:

1. هر Bounded Context فقط از Public API خودش import می‌شود (ER1).
2. هر Context Schema داده خودش را مالک می‌شود (ER2).
3. ارتباط Cross-Context فقط Sync Facade یا Async Event (ER3).
4. وابستگی خارجی فقط از طریق Port/Adapter (ER4).
5. قواعد وابستگی در CI Enforce می‌شوند (ER5).

نیاز C3 (مقیاس AI) با جداسازی **AI Service و Worker به‌عنوان Processهای مستقل از همان ابتدا** پاسخ داده می‌شود — بدون شکستن Monolith بالینی-تجاری.

## Consequences

**مثبت:**
- یکپارچگی تراکنشی Cascade مالی تضمین‌شده (بدون Saga/Compensation).
- هزینه زیرساخت و نگهداری حداقلی؛ استقرار با docker-compose ساده.
- Refactor درون-Codebase سریع؛ تست‌های واحد مثل ۵۱ تست Workflow بدون شبیه‌سازی شبکه اجرا می‌شوند.

**منفی/هزینه:**
- یک Process web = نقصه خرابی واحد (کاهش: Stateless + Scale افقی + Health-check).
- انضباط مرزبندی باید **پیوسته** با CI حفظ شود وگرنه به «Big Ball of Mud» تبدیل می‌شود (ADR-0010).
- Extracion آینده هزینه اولیه دارد (قراردادهای Facade از الان باید رعایت شوند).

## Compliance

- تست معماری (ADR-0010) رعایت ER1/ER3/ER5 را در هر CI اجرا می‌کند.
- معیارهای بازنگری §2.3 سند معماری (۳+ شرط هم‌زمان) به‌عنوان «تست» تصمیم مستند شده‌اند؛ ورود به Microservices بدون تأیید این معیارها غیرمجاز است.
