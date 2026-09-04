# ADR-0009: Ports & Adapters برای Payment و Shipping (و SMS)

| فیلد | مقدار |
|---|---|
| شماره | ADR-0009 |
| وضعیت | Accepted |
| تاریخ | 1405/06/14 (2026-09-04) |
| فاز تصمیم | PHASE 03 — System Architecture |
| معادل ED | ED-43 |
| اسناد مرتبط | `ARCHITECTURE.md §3, §12` · ADR-0001 (ER4) · `src/lib/ai/provider.ts` (الگوی Port موجود) |

## Context

BabaHakim به سیستم‌های خارجی وابسته است: PSP (زرین‌پال + کارت‌به‌کارت دستی)، Courier (پیک داخلی/خودرو/پست/تیپاکس)، SMS Gateway (Kavenegar/SMS.ir)، Object Storage (ADR-0006) و AI (ADR-0007). این Providerها: (۱) ممکن است تغییر کنند (تعرفه، API، VIP)، (۲) در dev باید Mock/Log باشند (قید P7/C5)، (۳) هر کدام قرارداد شکست/Retry خاص خود را دارند. اگر فراخوانی مستقیم در کد دامنه پخش شود، هر تغییر Provider = جراحی سراسری.

## Options

| گزینه | مزایا | معایب |
|---|---|---|
| **A) Ports & Adapters (Hexagonal)** | تعویض Provider بدون تغییر دامنه؛ تست با Fake؛ قرارداد شکست یکجا | کمی Boilerplate |
| **B) SDK مستقیم در کد دامنه** | سریع شروع | وابستگی دامنه به Vendor؛ تست نیازمند Sandbox واقعی |

## Decision

**تمام وابستگی‌های خارجی از طریق Port (Interface در دامنه) + Adapter (پیاده‌سازی در infra) مصرف می‌شوند:**

| Port | Adapterها | نکات قرارداد |
|---|---|---|
| `PaymentGateway` | `zarinpal` (sandbox/prod)، `card-to-card` (دستی — توسط Operator Verify می‌شود) | `requestPayment()` + `verifyCallback()` هر دو **Idempotent**؛ Callback با کلید Authority؛ خطاها به خطای دامنه‌ای ترجمه می‌شوند |
| `ShippingProvider` | `internal` (پیک/خودرو — ثبت دستی)، `post`، `tipax` (API آینده) | `createShipment()` / `trackShipment()`؛ ردیابی `TRK-` |
| `SmsProvider` | `log-only` (dev — ثبت در SMSLog)، `kavenegar`، `smsir` | ارسال صف‌پشت (Worker)؛ Retry با Backoff |
| `ObjectStorage` | `local-fs`، `s3` | ADR-0006 |
| `AIModelProvider` | `in-process`، `http` | ADR-0007 |

- انتخاب Adapter از Env (۱۲-Factor — قاعده ۱۴ منشور)؛ در dev پیش‌فرض = Adapterهای Log/Mock **با برچسب صریح DEMO/SIMULATED در UI طبق P7**.
- کد دامنه (Contextها) هرگز SDK مستقیم Vendor را import نمی‌کند — این import فقط در `infra/<adapter>` مجاز است.

## Consequences

**مثبت:**
- تعویض PSP/Courier = یک Adapter جدید + تغییر Env، بدون تغییر منطق دامنه.
- تست واحد دامنه با Fake سریع و بدون شبکه اجرا می‌شود (الگوی ۵۱ تست Phase 02).
- آماده‌سازی Extraction آینده Payments (ADR-0001 ER4).

**منفی/هزینه:**
- نگهداری Interface + چند Adapter؛ هم‌گامی قرارداد تست‌ها.

## Compliance

- تست معماری: import از پکیج‌های Vendor فقط مجاز در فایل‌های `infra/*adapter*` — بقیه نقض می‌گیرد.
- هر Port حداقل یک Adapter تست‌شده + یک Fake تست دارد.
- Config Scan: هیچ Endpoint/Key پخت‌شده‌ای در Adapterها نیست (همه از Env — قاعده ۶).
