# ADR-0016: لایه حاکمیت گردش کار (Workflow Governance Layer)

| فیلد | مقدار |
|---|---|
| شماره | ADR-0016 |
| وضعیت | Accepted |
| تاریخ | 1405/06/14 (2026-09-05) |
| فاز تصمیم | PHASE 12 — Business Workflow Engineering |
| معادل ED | ED-121..129 |
| اسناد مرتبط | `WORKFLOW.md §12–19` · `BUSINESS-RULES.md §6 (BR-WF)` · ADR-0001 (Modular Monolith) · ADR-0008 (Domain Events) |

## Context

PHASE 02 یک موتور ماشین وضعیت اعلانی برای ۸ موجودیت ساخت و ۷ بُعد از الزامات گردش کار (States/Transitions/Actors/Permissions/Conditions/Events/Notifications) را پوشش داد. اما ممیزی PHASE 12 چهار شکاف ساختاری پیدا کرد:

1. **Timeout/SLA** — هیچ تعریف اعلانی‌ای برای «چقدر ماندگاری در وضعیت مجاز است» وجود نداشت؛ موارد گیرکرده فقط با چشم اپراتور در داشبورد دیده می‌شدند.
2. **Retries/Failures/Recovery** — Retry فقط در سطح JobQueue بود؛ Taxonomi شکست و مسیر بازیابی به‌صورت پراکنده در کد قرار داشت (AI_REVIEW.RESET تنها استثنا).
3. **Bypass موتور** — مسیرهای واقعی کسب‌وکار status را مستقیم می‌نوشتند: کاسکاد پرداخت (`order.update PAID`)، شروع پرداخت (نوشتن `PAYMENT_PENDING` بدون هیچ گذار ماشین — حفره گراف)، پل کارگر مدیا (updateMany)، اسکن پیگیری (updateMany بدون Audit)، فرآیند کامل حذف داده (DeletionRequest بدون ماشین) و Invoice (کاملاً بدون ماشین).
4. **فرآیندهای بدون ماشین** — DeletionRequest (حریم خصوصی)، MedicalImage (دروازه بالینی AI) و Invoice (مالی) به‌عنوان فرآیند مهم، State Machine نداشتند.

قید حاکم: «هیچ Workflow مهمی فقط در UI کنترل نشود؛ Backend منبع حقیقت باشد» + ۱۷ قانون منشور + اصل اتمیک بودن Audit با تغییر وضعیت (PHASE 02).

## Options

| گزینه | مزایا | معایب |
|---|---|---|
| A) تایمرهای ad-hoc در سرویس‌ها (setTimeout per entity) | ساده در شروع | غیر اعلانی، غیر قابل audit، در restart از دست می‌رود، SoT را در کد پراکنده غرق می‌کند |
| B) جدول SLA جداگانه + Cron مستقل خارج از Next.js | جداسازی عملیاتی | زیرساخت اضافه؛ خارج از تراکنش موتور؛ ریسک ناهماهنگی با گراف ماشین |
| C) **لایه سیاست اعلانی + Projection اتمیک + Runtime داخل همان Monolith** | — | (انتخاب‌شده) |

## Decision

BabaHakim لایه حاکمیت **داخل همان Monolith** را انتخاب می‌کند، با سه قطعه:

1. **`policies.ts` (خالص/Client-Safe)** — کاتالوگ داده‌محور TIMEOUT_POLICIES (نردبان REMIND→ESCALATE→AUTO_TRANSITION per status)، RETRY_POLICIES (backoff) و FAILURE_POLICIES (taxonomi + recoveryActions). هیچ مقدار SLA در کد اجرایی hardcoded نمی‌شود.
2. **`WorkflowState` (Prisma، Projection)** — یک ردیف per (entityType, entityId) که موتور در **همان تراکنش هر گذار** آن را upsert می‌کند: enteredAt (شروع شمارنده SLA)، lastRemindedAt/reminderCount (Latch یادآوری)، escalatedAt (Latch تشدید). رکورد موجودیت canonical می‌ماند — این Projection منبع حقیقت دوم نیست.
3. **`governance.ts` (Runtime، job هر ۲ دقیقه)** — بک‌فیل ردیف‌های قدیمی، آشکارسازی Drift (هر نوشتن status خارج موتور → re-sync + Audit WORKFLOW_STATE_DRIFT — پاسدار فعال SoT)، و ارزیابی نردبان SLA. **Runtime هرگز status را مستقیم نمی‌نویسد** — هر گذار از executeTransition با Actor SYSTEM می‌گذرد تا گارد/Audit/CaseEvent یکنواخت بماند.

به‌علاوه: `subtransition.ts` برای کاسکادهای درون‌تراکنش (گذار Machine-Guarded داخل tx فراخواننده)، ۳ ماشین جدید (DELETION_REQUEST/MEDICAL_IMAGE/INVOICE) → مجموعاً ۱۱ ماشین، رفع ۷ مسیر bypass، رفع حفره گراف ORDER.ENTER_PAYMENT، و `executeAdminRecovery` (فرار اضطراری ADMIN با Audit کامل — BR-WF-07).

## Consequences

**مثبت:**
- ۱۱ بُعد گردش کار برای هر فرآیند مهم، از یک منبع اعلانی واحد
- SLAها enforce می‌شوند نه فقط توصیه — انقضای درگاه ۳۰ دقیقه‌ای خودکار، مهلت حریم خصوصی ۷ روزه تشدید می‌شود
- Drift Detection: هر bypass آینده در اولین tick (~۲ دقیقه) Audit می‌شود
- بازیابی سه‌لایه: طبیعی / خودکار / اضطراری — همه با Audit اتمیک
- انطباق با ED-33 تقویت شد: کاسکادهای مالی هم Machine-Guarded

**منفی/قابل مدیریت:**
- هر tick تا ۵۰۰ ردیف/ماشین می‌خواند (Bounded) — با SQLite توسعه فعلی OK؛ در مقیاس بالا به poll → push (Events) مهاجرت می‌شود
- WorkflowState نیازمند Migration (`20260905090000_workflow_state_phase12`) — افزودنی، بدون تغییر جداول موجود
- DeletionRequest وضعیت پایانی COMPLETED شد (adminService قبلی PROCESSED می‌نوشت — ناسازگاری داده قدیمی در dev-db با آشتی بک‌فیل قابل شناسایی است)

## تبدیل به Bun/Next واقعی

- Runtime از JobQueue موجود (jobs.ts — BullMQ-compatible) استفاده می‌کند؛ مهاجرت به Redis صرفاً config است
- Probe عملکردی زنده: scan → ۱۱ ماشین/۹۳ نمونه/۰ خطا؛ recover واقعی با Audit + WorkflowState اتمیک
