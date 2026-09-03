# BabaHakim — موتور گردش کار و ماشین‌های وضعیت (Workflow & State Machines)

| فیلد | مقدار |
|---|---|
| نسخه | 1.0.0 |
| تاریخ | 1405/06/13 (2026-09-04) |
| فاز | PHASE 02 — Workflow & State Machine |
| کد | `src/lib/workflow/` |
| تست | `bun test src/lib/workflow` → ۵۱ تست · Smoke: `scripts/smoke-phase02-workflow.sh` → ۱۳/۱۳ |

---

## ۱) معماری موتور (غیر Hardcode — ED-31)

### ۱.۱ اصل طراحی

هیچ منطق Transitionی در UI یا بدنه Routeها **Hardcode نشده**. منبع واحد حقیقت، **جدول‌های اعلانی ماشین‌ها** است:

```text
src/lib/workflow/
├── types.ts            ← قراردادها (TransitionDef / MachineDef / HookCtx / ExecResult)
├── engine.ts           ← موتور اجرا (resolve / guards / $transaction / event / audit)
├── registry.ts         ← ثبت ماشین‌ها (تنها نقطه اتصال؛ افزودن ماشین = یک فایل)
├── machines/           ← ۸ ماشین اعلانی
│   ├── case.ts         ← پرونده بیمار (۲۱ وضعیت / ۱۸ Transition)
│   ├── prescription.ts ← نسخه (۷ وضعیت / ۷ Transition)
│   ├── order.ts        ← سفارش (۱۱ وضعیت / ۹ Transition)
│   ├── payment.ts      ← پرداخت (۶ وضعیت / ۸ Transition)
│   ├── shipment.ts     ← ارسال (۵ وضعیت / ۴ Transition)
│   ├── ticket.ts       ← تیکت (۶ وضعیت / ۸ Transition)
│   ├── followup.ts     ← پیگیری (۵ وضعیت / ۴ Transition)
│   └── aiReview.ts     ← بازبینی AI (۴ وضعیت / ۴ Transition)
└── __tests__/          ← ۵۱ Unit Test

سازگاری گذشته: src/lib/constants.ts → TRANSITIONS/canTransition (Shim روی همان ماشین CASE)
```

**قرارداد توسعه‌پذیری:** افزودن موجودیت جدید = ساخت `machines/<entity>.ts` (جدول داده + هوک‌ها) + یک خط ثبت در `registry.ts`. موتور، Routeها و تست‌ها **بدون هیچ تغییری** کار می‌کنند.

### ۱.۲ چرخه اجرای یک Transition (۹ تضمین)

```text
executeTransition({ machine, entityId, action, actor, payload, req })
  1) LOAD      رکورد با Adapter پر-موجودیت (deletedAt → 404)
  2) GUARDS    نقش (ADMIN bypass طبق BR-RBAC-02) → Permission (BR-RBAC-01) →
              مالکیت بیمار (BR-RBAC-03) → Member گراف (from ⊆ status)
  3) VALIDATE  هوک اعتبارسنجی اعلانی (قبل از هر نوشتن)
  4) TX        ┌─ db.$transaction ──────────────────────────────┐
              │ • UPDATE status + dataEffects (خالص)            │
              │ • CaseEvent (فقط CASE — تایم‌لاین UI)            │
              │ • AuditLog (همه ماشین‌ها — الزام فاز ۰۲)         │
              │ • txEffects (Cascadeهای هم‌تراکنش)               │
              └────────────────────────────────────────────────┘
  5) POSTCOMMIT  اعلان‌ها (شکست = Log ساخت‌یافته، هرگز شکستن جریان — ED-17)
```

| تضمین | مکانیزم |
|---|---|
| **Audit Log برای هر Transition** | رکورد `WORKFLOW_<ENTITY>_<ACTION>` با Actor/Entity/Old/New/IP/Device — **اتمیک با تغییر وضعیت** (همان تراکنش) |
| **Event Timeline** | CASE → CaseEvent (UI تایم‌لاین)؛ سایر ماشین‌ها → AuditLog به‌عنوان جریان رخداد قابل کوئری (ED-32) |
| **Validation** | هوک اعلانی؛ خطا → `VALIDATION` (422) بدون هیچ نوشتن |
| **Failure** | خطای هر مرحله درست قبل از Commit → کل تراکنش Rollback خودکار (وضعیت قبلی سالم می‌ماند) |
| **Rollback** | `db.$transaction` — UPDATE + Event + Audit + Cascade یا همه یا هیچ |
| **Idempotency** | Transition از وضعیت نهایی مجاز نیست (409)؛ Callback تکراری پرداخت → پاسخ از رکورد PAID موجود (BR-FIN-01) |
| **Concurrency** | UPDATE تراکنشی + گارد وضعیت (from-status) — رقابت Claim → فقط یک برنده (409 برای دیگری) |
| **System Actor** | Gateway/Cron فقط Transitionهای `system: true` را می‌زنند |
| **سازگاری گذشته** | `constants.TRANSITIONS` / `canTransition` / `caseService.applyTransition` → همان ماشین، همان امضا |

### ۱.۳ نگاشت خطا (کد → HTTP)

`NOT_FOUND→404` · `INVALID_TRANSITION→409` · `FORBIDDEN_ROLE/PERMISSION→403` · `NOT_OWNER→403` · `VALIDATION→422` · `SIDE_EFFECT→500`

---

## ۲) ماشین CASE — پرونده بیمار (۲۱ وضعیت / ۱۸ Transition)

> `NEW` وضعیت مجازی است: پرونده هنگام ایجاد مستقیماً `WAITING_FOR_EXPERT_1` می‌شود و CaseEvent گام `NEW → WAITING_FOR_EXPERT_1` را ثبت می‌کند (ED-34).

### ۲.۱ جدول Transitionها

| # | Action | From → To | Actor | Permission | Validation | Cascade (txEffects) | Notification |
|---|---|---|---|---|---|---|---|
| T1 | CLAIM | WAITING_FOR_EXPERT_1 → EXPERT_1_REVIEW | EXPERT_1 | claim_cases | — | — | — |
| T2 | SUBMIT_ASSESSMENT | EXPERT_1_REVIEW → WAITING_FOR_USER_APPROVAL | EXPERT_1 | expert1_assessment | summary الزامی | — | ASSESSMENT_READY + SMS به بیمار |
| T3 | USER_APPROVE | WAITING_FOR_USER_APPROVAL → WAITING_FOR_EXPERT_1_PRESCRIPTION | PATIENT | — (مالک) | — | — | TREATMENT_APPROVED |
| T4 | USER_DECLINE | WAITING_FOR_USER_APPROVAL → CLOSED | PATIENT | — (مالک) | reason الزامی | closingNote+closedAt | CASE_CLOSED |
| T5 | SUBMIT_PRESCRIPTION | WAITING_FOR_EXPERT_1_PRESCRIPTION / REVISION_REQUESTED → WAITING_FOR_EXPERT_2 | EXPERT_1 | create_prescription | — (Route اقلام را می‌سازد) | — | PRESCRIPTION_CREATED |
| T6 | EXPERT2_REVIEW | WAITING_FOR_EXPERT_2 → WAITING_FOR_DOCTOR | EXPERT_2 | expert2_review | — | — | SENT_TO_DOCTOR (پزشک) |
| T7 | DOCTOR_APPROVE | WAITING_FOR_DOCTOR → PRESCRIPTION_APPROVED | DOCTOR | approve_prescription | — | doctor+followUpDays | DOCTOR_APPROVED + SMS |
| T8 | DOCTOR_REJECT | WAITING_FOR_DOCTOR → CLOSED | DOCTOR | approve_prescription | کامنت الزامی | closingNote+closedAt | CASE_CLOSED |
| T9 | DOCTOR_REVISION | WAITING_FOR_DOCTOR → WAITING_FOR_EXPERT_2 | DOCTOR | approve_prescription | کامنت الزامی | — | DOCTOR_COMMENTED |
| T10 | CREATE_PROFORMA | PRESCRIPTION_APPROVED → PROFORMA_CREATED | EXPERT_2 / OPERATOR | create_invoice | نسخه APPROVED (Route) | — (Route سفارش/فاکتور می‌سازد) | PROFORMA_CREATED + SMS |
| T11 | CONFIRM_PROFORMA | PROFORMA_CREATED / WAITING_FOR_USER_CONFIRMATION → WAITING_FOR_PAYMENT | PATIENT | — (مالک) | — | — | PAYMENT_PENDING |
| T12 | REJECT_PROFORMA | PROFORMA_CREATED / WAITING_FOR_USER_CONFIRMATION → CANCELLED | PATIENT | — (مالک) | reason الزامی | closingNote+closedAt | CASE_CLOSED |
| T13 | MARK_PAID | WAITING_FOR_PAYMENT → PAYMENT_CONFIRMED | OPERATOR / EXPERT_2 (+SYSTEM در Cascade پرداخت) | verify_payment | — | (پرداخت Cascade می‌کند) | PAYMENT_CONFIRMED |
| T14 | START_SHIPPING | PAYMENT_CONFIRMED / PREPARING_SHIPMENT → SHIPPED | OPERATOR / EXPERT_2 | manage_shipments | — | SHIPMENT.SHIP Cascade | ORDER_SHIPPED + SMS |
| T15 | MARK_DELIVERED | SHIPPED / PAYMENT_CONFIRMED / PREPARING_SHIPMENT → DELIVERED | OPERATOR / EXPERT_2 | manage_shipments | — | SHIPMENT.DELIVER Cascade | ORDER_DELIVERED + SMS |
| T16 | SCHEDULE_FOLLOWUP | DELIVERED → FOLLOW_UP | EXPERT_1 / OPERATOR | manage_followups | — | (Route رکورد FUP می‌سازد) | FOLLOWUP_DUE |
| T17 | COMPLETE_FOLLOWUP | FOLLOW_UP → CLOSED | EXPERT_1 / OPERATOR | manage_followups | — | FOLLOWUP.COMPLETE Cascade | CASE_CLOSED |
| T18 | REFER_AGAIN | FOLLOW_UP / DELIVERED → REFERRED_AGAIN | PATIENT / EXPERT_1 / OPERATOR | — | — | FUPهای باز COMPLETE | REFERRED_AGAIN |

### ۲.۲ کاتالوگ وضعیت‌ها (ورودی/خروجی/مسئول)

| وضعیت | ورودی (Tها) | خروجی (Tها) | مسئول انتظار | پیام رخداد |
|---|---|---|---|---|
| NEW (مجازی) | ایجاد | — | SYSTEM | — |
| WAITING_FOR_EXPERT_1 | ایجاد | T1 | EXPERT_1 | ASSIGNED_EXPERT به همه EXPERT_1 |
| EXPERT_1_REVIEW | T1 | T2 | EXPERT_1 | — |
| WAITING_FOR_USER_APPROVAL | T2 | T3/T4 | PATIENT (**G1**) | ASSESSMENT_READY + SMS |
| WAITING_FOR_EXPERT_1_PRESCRIPTION | T3 | T5 | EXPERT_1 | TREATMENT_APPROVED |
| WAITING_FOR_EXPERT_2 | T5, T9 | T6 | EXPERT_2 | PRESCRIPTION_CREATED + ASSIGNED به EXPERT_2 |
| REVISION_REQUESTED (نسخه) | — (سطح Prescription) | T5 | EXPERT_1 | — |
| WAITING_FOR_DOCTOR | T6 | T7/T8/T9 | DOCTOR (**G3**) | SENT_TO_DOCTOR + ASSIGNED به پزشکان |
| PRESCRIPTION_APPROVED | T7 | T10 | EXPERT_2/OPERATOR | DOCTOR_APPROVED + SMS |
| PREPARING_ORDER | — (رزرو) | T10 | OPERATOR | — |
| PROFORMA_CREATED | T10 | T11/T12 | PATIENT (**G4**) | PROFORMA_CREATED + SMS |
| WAITING_FOR_USER_CONFIRMATION | — (رزرو) | T11/T12 | PATIENT | PROFORMA_CONFIRMATION_NEEDED |
| WAITING_FOR_PAYMENT | T11 | T13 | SYSTEM/PATIENT (**G5/G6**) | PAYMENT_PENDING |
| PAYMENT_CONFIRMED | T13 | T14 | OPERATOR | PAYMENT_CONFIRMED + SMS |
| PREPARING_SHIPMENT | — | T14 | OPERATOR | — |
| SHIPPED | T14 | T15 | OPERATOR | ORDER_SHIPPED + SMS |
| DELIVERED | T15 | T16/T18 | EXPERT_1/OPERATOR | ORDER_DELIVERED + SMS |
| FOLLOW_UP | T16 | T17/T18 | OPERATOR/PATIENT | FOLLOWUP_DUE |
| REFERRED_AGAIN | T18 | چرخه جدید (ED-13) | PATIENT | REFERRED_AGAIN |
| CLOSED (ترمینال) | T4/T8/T12/T17 | — | — | CASE_CLOSED |
| CANCELLED (ترمینال) | T12 | — | — | CASE_CLOSED |

**Failure/Rollback مشترک:** هر T خطا بدهد → Rollback کامل؛ وضعیت قبلی سالم؛ Audit تنها در موفقیت (اتمیک). Gateهای G1..G6 با SLA ED-08 (یادآوری ۷۲h / بستن ۳۰d) در فاز Scheduler فعال می‌شوند.

---

## ۳) ماشین PRESCRIPTION — نسخه (۷ وضعیت / ۷ Transition)

| وضعیت | ورودی | خروجی | Actor مجاز | Validation |
|---|---|---|---|---|
| PENDING_EXPERT_2 (اولیه) | ایجاد توسط EXPERT_1 | EXPERT2_REVIEW / SUPERSEDE | EXPERT_2 | — |
| PENDING_DOCTOR | EXPERT2_REVIEW, REVISE | DOCTOR_APPROVE/REJECT/REVISION | DOCTOR | — |
| REVISION_REQUESTED | DOCTOR_REVISION | REVISE / SUPERSEDE | EXPERT_1 (اصلاح) | — |
| APPROVED | DOCTOR_APPROVE | FINALIZE / SUPERSEDE | OPERATOR | — |
| REJECTED (ترمینال) | DOCTOR_REJECT | — | — | کامنت پزشک الزامی |
| SUPERSEDED (ترمینال) | SUPERSEDE | — | — | ثبت دلیل «نسخه جدید جایگزین شد» |
| FINALIZED (ترمینال) | FINALIZE | — | OPERATOR/ADMIN | پس از تأمین |

| Action | From → To | Permission | Cascade |
|---|---|---|---|
| EXPERT2_REVIEW | PENDING_EXPERT_2/REVISION_REQUESTED → PENDING_DOCTOR | expert2_review | dataEffects: expert2Notes |
| DOCTOR_APPROVE | PENDING_DOCTOR → APPROVED | approve_prescription | approvedById/At |
| DOCTOR_REJECT | PENDING_DOCTOR → REJECTED | approve_prescription | کامنت الزامی |
| DOCTOR_REVISION | PENDING_DOCTOR → REVISION_REQUESTED | approve_prescription | کامنت الزامی |
| REVISE | REVISION_REQUESTED → PENDING_EXPERT_2 | edit_prescription | چرخه بازبینی مجدد |
| SUPERSEDE | هر وضعیت فعال → SUPERSEDED | edit_prescription (SYSTEM هم مجاز) | نسخه جدید ثبت شد |
| FINALIZE | APPROVED → FINALIZED | manage_orders | بایگانی پس از تأمین |

**Failure:** هر تغییر نسخه = رکورد جدید با version+1؛ نسخه قبلی SUPERSEDED می‌شود (تاریخچه هرگز حذف نمی‌شود — BR-MED-06).

---

## ۴) ماشین ORDER — سفارش (۱۱ وضعیت / ۹ Transition)

| وضعیت | ورودی | خروجی | Actor | Validation/نکته |
|---|---|---|---|---|
| CART (اولیه) | — | CHECKOUT | PATIENT | فقط OTC (BR-MED-03) |
| PENDING_CONFIRMATION | CHECKOUT | CONFIRM / MARK_PAID / CANCEL | PATIENT/OPERATOR | Proforma صادر شده |
| CONFIRMED | CONFIRM | MARK_PAID / PREPARE / CANCEL | OPERATOR | — |
| PAYMENT_PENDING | (شروع پرداخت) | MARK_PAID | SYSTEM/PATIENT | فاکتور CONFIRMED |
| PAID | MARK_PAID | PREPARE / SHIP / REFUND | SYSTEM/OPERATOR | Cascade: Invoice→PAID + FinancialTransaction INCOME |
| PREPARING | PREPARE | READY | OPERATOR | — |
| READY_TO_SHIP | READY | SHIP | OPERATOR | — |
| SHIPPED | SHIP | DELIVER | OPERATOR/EXPERT_2 | Cascade از SHIPMENT.SHIP |
| DELIVERED | DELIVER | REFUND | OPERATOR | ترمینال عملیاتی |
| CANCELLED (ترمینال) | CANCEL | — | PATIENT(مالک)/OPERATOR | reason ≥ ۳ حرف |
| REFUNDED (ترمینال) | REFUND | — | ADMIN/OPERATOR | reason الزامی؛ Payment→REFUNDED + تراکنش REFUND |

**Cascade MARK_PAID (اتمیک):** Invoice → PAID + paidAt، FinancialTransaction INCOME — تنها وقتی پرداخت مرتبط وجود ندارد (در غیر این صورت منبع حقیقت PAYMENT است).

---

## ۵) ماشین PAYMENT — پرداخت (۶ وضعیت / ۸ Transition)

| وضعیت | ورودی | خروجی | Actor | یادداشت |
|---|---|---|---|---|
| PENDING (اولیه درگاه) | ایجاد | GATEWAY_VERIFY / GATEWAY_FAIL / (RETRY) | SYSTEM | Authority فعال |
| AWAITING_VERIFY (اولیه کارت‌به‌کارت) | ایجاد / SUBMIT_RECEIPT / REQUEST_INFO | VERIFY_APPROVE / VERIFY_REJECT | PATIENT → OPERATOR | رسید + مبلغ + شماره پیگیری |
| PAID | GATEWAY_VERIFY / VERIFY_APPROVE | REFUND | SYSTEM/OPERATOR | **Cascade کامل اتمیک** |
| FAILED | GATEWAY_FAIL | RETRY | SYSTEM → PATIENT | Retry آزاد کاربر |
| REJECTED (نیمه‌ترمینال) | VERIFY_REJECT | RETRY / SUBMIT_RECEIPT / REQUEST_INFO | — | دلیل الزامی |
| REFUNDED (ترمینال) | REFUND | — | ADMIN/OPERATOR | reason الزامی |

**paymentPaidCascade (منبع واحد حقیقت پرداخت — ED-33):** در همان تراکنشِ PAYMENT: ORDER→PAID (اگر نباشد) + Invoice→PAID + FinancialTransaction INCOME (یک‌بار) + CASE→PAYMENT_CONFIRMED با CaseEvent (فقط سفارش نسخه‌ای و case در WAITING_FOR_PAYMENT). Idempotent: Verify تکراری → هیچ double-apply (BR-FIN-01).

---

## ۶) ماشین SHIPMENT — ارسال (۵ وضعیت / ۴ Transition)

| وضعیت | ورودی | خروجی | Actor | Permission |
|---|---|---|---|---|
| PREPARING (اولیه) | ایجاد | SHIP / FAIL | OPERATOR/EXPERT_2 | manage_shipments |
| SHIPPED | SHIP (اطلاعات راننده/کد رهگیری) | IN_TRANSIT / DELIVER / FAIL | OPERATOR/EXPERT_2 | manage_shipments |
| IN_TRANSIT | IN_TRANSIT | DELIVER / FAIL | OPERATOR | manage_shipments |
| DELIVERED (ترمینال) | DELIVER (deliveryDate) | — | OPERATOR/EXPERT_2 | manage_shipments |
| FAILED (ترمینال) | FAIL | — | OPERATOR/ADMIN | reason الزامی → note |

**Cascade DELIVER (اتمیک):** ORDER → DELIVERED. **قاعده نویسنده واحد (ED-33):** پیشرفت CASE همیشه توسط ماشین CASE انجام می‌شود (Route بعد از DELIVER در صورت لزوم `CASE.MARK_DELIVERED` را می‌زند) — هیچ Double-Transition رخ نمی‌دهد.

---

## ۷) ماشین TICKET — تیکت (۶ وضعیت / ۸ Transition)

| وضعیت | ورودی | خروجی | Actor | نکته |
|---|---|---|---|---|
| OPEN (اولیه) | ایجاد | ASSIGN/STAFF_REPLY/CLOSE/PATIENT_REPLY | PATIENT→STAFF | — |
| IN_PROGRESS | ASSIGN/STAFF_REPLY/REOPEN | WAIT_USER/ESCALATE/RESOLVE/CLOSE | STAFF | manage_tickets |
| WAITING_USER | WAIT_USER | PATIENT_REPLY/ESCALATE/RESOLVE/CLOSE | PATIENT انتظار | — |
| WAITING_EXPERT | ESCALATE/PATIENT_REPLY | EXPERT-REPLY→IN_PROGRESS/RESOLVE/CLOSE | EXPERT/DOCTOR | ارجاع تخصصی |
| RESOLVED | RESOLVE | REOPEN / CLOSE | STAFF | اعلان به کاربر |
| CLOSED (ترمینال) | CLOSE | REOPEN | STAFF/ADMIN | پاسخ بیمار روی CLOSED مجاز نیست (بهبود نسبت به v1) |

**بهبود فاز ۰۲ نسبت به v1:** قبلاً PATCH ارادی هر وضعیتی را می‌نوشت (بدون Guard/Audit per-transition)؛ اکنون همه تغییرات Guard + Audit + Validation دارند.

---

## ۸) ماشین FOLLOWUP — پیگیری درمان (۵ وضعیت / ۴ Transition)

| وضعیت | ورودی | خروجی | Actor | یادداشت |
|---|---|---|---|---|
| PENDING (اولیه) | ایجاد | MARK_DUE/MARK_OVERDUE/COMPLETE/CANCEL | SYSTEM/OPERATOR | Bucket نمایشی: DUE_TODAY/OVERDUE/UPCOMING (محاسبه لحظه‌ای) |
| DUE | MARK_DUE | MARK_OVERDUE/COMPLETE/CANCEL | SYSTEM/OPERATOR | Reminder دو-طرفه |
| OVERDUE | MARK_OVERDUE | COMPLETE/CANCEL | SYSTEM/OPERATOR | اولویت داشبورد |
| COMPLETED (ترمینال) | COMPLETE | — | OPERATOR/EXPERT_1/DOCTOR* | completedAt/ById/resultNote (*DOCTOR فاقد manage_followups → عملاً مسدود) |
| CANCELLED (ترمینال) | CANCEL | — | ADMIN/OPERATOR | reason الزامی |

---

## ۹) ماشین AI_REVIEW — بازبینی انسانی AI (۴ وضعیت / ۴ Transition)

> Migration `20260903221412_ai_review_workflow_fields`: ستون‌های `reviewStatus / reviewComment / reviewedById / reviewedAt` (پیش‌تر فقط boolean).

| وضعیت | ورودی | خروجی | Actor | Permission |
|---|---|---|---|---|
| PENDING_REVIEW (اولیه) | ایجاد تحلیل | ACCEPT/MODIFY/REJECT | EXPERT_1/EXPERT_2/DOCTOR | view_ai_analyses |
| ACCEPTED (ترمینال عملی) | ACCEPT | RESET (فقط ADMIN) | بازبین | تحلیل پذیرفته شد |
| MODIFIED (ترمینال عملی) | MODIFY | RESET | بازبین | اصلاح‌شده استفاده شد (رایج‌ترین) |
| REJECTED (ترمینال عملی) | REJECT | RESET | بازبین | کامنت الزامی (علت رد) |

dataEffects هر بازبینی: `humanReviewed=true` + کامنت + بازبین + زمان — تغذیه Dataset یادگیری (BR-MED-08: بدون اعتبار خودکار).

---

## ۱۰) نقشه نگاشت Route → موتور (فاز ۰۲)

| Route | ماشین‌های درگیر |
|---|---|
| `POST /cases/[id]/action` | CASE + (AI_REVIEW / PRESCRIPTION / ORDER / SHIPMENT / FOLLOWUP به‌صورت Cascade) |
| `PATCH /orders/[id]` | ORDER (CONFIRM/CANCEL/PREPARE/READY/REFUND) |
| `POST /payments/[id]/verify` | PAYMENT (VERIFY_APPROVE/REJECT/REQUEST_INFO) + Cascade اتمیک |
| `GET /payments/zarinpal/callback` | PAYMENT (GATEWAY_VERIFY/GATEWAY_FAIL) — Actor SYSTEM |
| `POST /payments/[id]/receipt` | PAYMENT (SUBMIT_RECEIPT) |
| `PATCH /shipments` | SHIPMENT (SHIP/IN_TRANSIT/DELIVER/FAIL) + CASE.MARK_DELIVERED |
| `POST/PATCH /tickets/[id]` | TICKET (PATIENT_REPLY/STAFF_REPLY/ASSIGN/WAIT_USER/ESCALATE/RESOLVE/CLOSE/REOPEN) |
| `PATCH /followups` | FOLLOWUP (COMPLETE/CANCEL/MARK_DUE/MARK_OVERDUE) |

---

## ۱۱) تصمیمات مهندسی ثبت‌شده این فاز

| ED | تصمیم |
|---|---|
| ED-31 | موتور گردش کار عمومی + ماشین‌های اعلانی داده‌محور (بدون Hardcode) — افزودن ماشین = یک فایل + ثبت |
| ED-32 | بدون جدول Event جدید: AuditLog (`WORKFLOW_*`) جریان رخداد همه ماشین‌هاست؛ CaseEvent فقط برای تایم‌لاین CASE حفظ شد |
| ED-33 | «نویسنده واحد»: Cascade پرداخت اتمیک در تراکنش PAYMENT؛ پیشرفت CASE فقط توسط ماشین CASE؛ SHIPMENT فقط ORDER را Cascade می‌کند |
| ED-34 | `NEW` وضعیت مجازی ایجاد است (۱۸ Transition واقعی — اصلاح شمارش ۱۹ در مستندات فاز ۰۱)؛ `MARK_DELIVERED` از PAYMENT_CONFIRMED/PREPARING_SHIPMENT هم مجاز (مسیر تحویل مستقیم اپراتور) |

**ریسک‌های باقی‌مانده:** Gateهای SLA (ED-08) به Scheduler فاز ۰۵ وابسته‌اند؛ `MARK_DUE/MARK_OVERDUE` فعلاً دستی/رزرو سیستم‌اند؛ رابط UI روی فیلدهای جدید AI_REVIEW (reviewStatus) هنوز رسمی نشده (فاز UI). همه تست‌ها سبز: `bun test` (51) + Smoke (13) + Lint (0).
