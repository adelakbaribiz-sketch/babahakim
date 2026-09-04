# ADR-0008: رویداد دامنه‌ای (Domain Events) برای ارتباط Cross-Context

| فیلد | مقدار |
|---|---|
| شماره | ADR-0008 |
| وضعیت | Accepted |
| تاریخ | 1405/06/14 (2026-09-04) |
| فاز تصمیم | PHASE 03 — System Architecture |
| معادل ED | ED-42 |
| اسناد مرتبط | `ARCHITECTURE.md §5.3, §7` · `ARCHITECTURE-DIAGRAM.md §9` · `src/lib/notify.ts` (۳۴ قالب) |

## Context

ارتباط بین ۱۵ Context باید دوگانه باشد: گاهی اتمیک و فوری (Cascade پرداخت — ED-33) و گاهی اطلاع‌رسانی اثر جانبی (اعلان، تجمیع، SLA). اگر همه‌چیز Sync فراخوانی شود، Coupling سخت و چرخه‌های منطقی رشد می‌کنند و Worker (ADR-0005) بی‌کار می‌ماند. اگر همه‌چیز Async شود، یکپارچگی مالی نقض می‌شود (C2).

## Options

| گزینه | مزایا | معایب |
|---|---|---|
| **A) همه‌چیز Sync Facade** | سادگی ذهنی | Coupling شدید؛ Worker بی‌استفاده؛ شکست اعلان = شکست تراکنش |
| **B) همه‌چیز Event** | جدایی کامل | ناسازگاری نهایی (Eventual) برای Cascade مالی غیرقابل قبول (C2) |
| **C) Hybrid: Sync برای ذات سیگنال، Event برای اثر جانبی** | سازگاری جایی که باید، جدایی جایی که می‌شود | نیاز به قاعده شفاف تفکیک |

## Decision

**الگوی Hybrid:** تقسیم مسئولیت بین «ذات سیگنال» و «اثر جانبی» ستون فقرات ارتباطی BabaHakim است:

1. **Sync Facade (اتمیک):** فقط عملیاتی که پاسخ فوری کاربر یا یکپارچگی تراکنشی می‌خواهند — Cascade پرداخت (ED-33)، صدور Proforma از Case، ثبت Transition.
2. **Domain Event (Async):** هر اثر جانبی — اعلان‌ها (۳۴ قالب موجود → مصرف Consumer `notify.dispatch`)، تحلیل AI، تجمیع Reporting، ثبت Finance، ابطال Cache.
3. **نام‌گذاری:** `<context>.<entity>.<verb-past>` — کاتالوگ کامل `ARCHITECTURE.md §7.2`.
4. **قرارداد پیام:** `{ id, name, occurredAt, context, payload, correlationId }` روی BullMQ (ADR-0005)؛ تحویل At-least-once؛ Idempotency با `eventId`.
5. **Event-Carried Payload:** رویداد داده لازم Consumer را حمل می‌کند (`recipientId`, `orderId`, مبلغ) تا Lookup معکوس (و چرخه بالقوه) حذف شود.
6. **Cascade مالی Sync می‌ماند** اما رویداد `payments.payment.confirmed` برای اثرات جانبی منتشر می‌شود — یعنی یک عمل، دو مسیر.

## Consequences

**مثبت:**
- شکست SMS/Reporting هرگز تراکنش اصلی را خراب نمی‌کند (Resilience).
- مسیر آینده Extraction (ADR-0001 ER3) از الان شبکه‌پسند است.

**منفی/هزینه:**
- تفکیک «ذات/اثر» باید در بازبینی PR حفظ شود؛ مستندسازی رویدادها باید هم‌گام بماند.
- Consumerهای Idempotent باید با تست نوشته شوند.

## Compliance

- هر Event جدید باید در کاتالوگ §7.2 ثبت شود (بازبینی PR) — رویداد ثبت‌نشده = نقض.
- تست Idempotency دوبل-اجرای پیام برای هر Consumer.
- تست معماری: `events/` هر Context فقط توسط ناشر خودش publish می‌کند.
