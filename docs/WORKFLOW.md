# BabaHakim — موتور گردش کار و ماشین‌های وضعیت (Workflow & State Machines)

| فیلد | مقدار |
|---|---|
| نسخه | 2.0.0 |
| تاریخ | 1405/06/14 (2026-09-05) |
| فاز | PHASE 02 — Workflow & State Machine · **PHASE 12 — Business Workflow Engineering (Governance)** |
| کد | `src/lib/workflow/` |
| تست | `bun test src/lib/workflow` → ۸۳ تست · کل مجموعه: `bun test` → ۲۸۳ تست · Lint: 0 خطا |

---

## ۱) معماری موتور (غیر Hardcode — ED-31)

### ۱.۱ اصل طراحی

هیچ منطق Transitionی در UI یا بدنه Routeها **Hardcode نشده**. منبع واحد حقیقت، **جدول‌های اعلانی ماشین‌ها** است:

```text
src/lib/workflow/
├── types.ts            ← قراردادها (TransitionDef / MachineDef / HookCtx / ExecResult)
├── engine.ts           ← موتور اجرا (resolve / guards / $transaction / event / audit / WorkflowState / executeAdminRecovery)
├── registry.ts         ← ثبت ماشین‌ها (تنها نقطه اتصال؛ افزودن ماشین = یک فایل)
├── pure.ts             ← Resolverهای خالص Client-Safe (ED-107)
├── policies.ts         ← [P12] سیاست‌های Timeout/Retry/Failure (خالص، اعلانی)
├── subtransition.ts    ← [P12] گذار Machine-Guarded داخل tx فراخواننده + sync WorkflowState
├── governance.ts       ← [P12] Runtime حاکمیت: بک‌فیل / Drift / SLA (REMIND/ESCALATE/AUTO)
├── machines/           ← ۱۱ ماشین اعلانی
│   ├── case.ts         ← پرونده بیمار (۲۱ وضعیت / ۱۸ Transition)
│   ├── prescription.ts ← نسخه (۷ وضعیت / ۷ Transition)
│   ├── order.ts        ← سفارش (۱۱ وضعیت / ۱۰ Transition شامل ENTER_PAYMENT)
│   ├── payment.ts      ← پرداخت (۶ وضعیت / ۸ Transition)
│   ├── shipment.ts     ← ارسال (۵ وضعیت / ۴ Transition)
│   ├── ticket.ts       ← تیکت (۶ وضعیت / ۸ Transition)
│   ├── followup.ts     ← پیگیری (۵ وضعیت / ۴ Transition)
│   ├── aiReview.ts     ← بازبینی AI (۴ وضعیت / ۴ Transition)
│   ├── deletionRequest.ts ← [P12] درخواست حذف داده (۴ وضعیت / ۳ Transition)
│   ├── medicalImage.ts ← [P12] دروازه AI تصویر (۴ وضعیت / ۴ Transition)
│   └── invoice.ts      ← [P12] سند مالی (۵ وضعیت / ۴ Transition)
└── __tests__/          ← ۸۳ Unit Test (workflow + policies + subtransition)

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

## ۱۱) تصمیمات مهندسی ثبت‌شده فاز ۰۲

| ED | تصمیم |
|---|---|
| ED-31 | موتور گردش کار عمومی + ماشین‌های اعلانی داده‌محور (بدون Hardcode) — افزودن ماشین = یک فایل + ثبت |
| ED-32 | بدون جدول Event جدید: AuditLog (`WORKFLOW_*`) جریان رخداد همه ماشین‌هاست؛ CaseEvent فقط برای تایم‌لاین CASE حفظ شد |
| ED-33 | «نویسنده واحد»: Cascade پرداخت اتمیک در تراکنش PAYMENT؛ پیشرفت CASE فقط توسط ماشین CASE؛ SHIPMENT فقط ORDER را Cascade می‌کند |
| ED-34 | `NEW` وضعیت مجازی ایجاد است (۱۸ Transition واقعی — اصلاح شمارش ۱۹ در مستندات فاز ۰۱)؛ `MARK_DELIVERED` از PAYMENT_CONFIRMED/PREPARING_SHIPMENT هم مجاز (مسیر تحویل مستقیم اپراتور) |

**ریسک‌های باقی‌مانده:** Gateهای SLA (ED-08) به Scheduler فاز ۰۵ وابسته‌اند؛ `MARK_DUE/MARK_OVERDUE` فعلاً دستی/رزرو سیستم‌اند؛ رابط UI روی فیلدهای جدید AI_REVIEW (reviewStatus) هنوز رسمی نشده (فاز UI). همه تست‌ها سبز: `bun test` (51) + Smoke (13) + Lint (0).

---

# PHASE 12 — Business Workflow Engineering (لایه حاکمیت گردش کار)

> **فرمان فاز:** استخراج تمام Business Workflowها؛ برای هر فرآیند تعریف States / Transitions / Actors / Permissions / Conditions / Events / Notifications / **Timeouts / Retries / Failures / Recovery**؛ تبدیل فرآیندهای مهم به State Machine؛ **هیچ Workflow مهمی فقط در UI کنترل نمی‌شود — Backend منبع واحد حقیقت است.**

## ۱۲) کاتالوگ ۱۱بُعدی فرآیندهای کسب‌وکار

هر فرآیند مهم اکنون Machine دارد و **هر ۱۱ بُعد** برای آن تعریف شده است:

| بُعد | منبع تعریف (Backend SoT) |
|---|---|
| States | `machines/*.ts → statuses` |
| Transitions | `machines/*.ts → transitions` (from/to/graph) |
| Actors | `roles` روی هر Transition (+ SYSTEM برای gateway/scheduler) |
| Permissions | `permission` روی هر Transition + `ROLE_PERMISSIONS` |
| Conditions | هوک `validate` (قبل از هر نوشتن، 422 در نقض) + مالکیت (BR-RBAC-03) |
| Events | CaseEvent (تایم‌لاین CASE) + AuditLog اتمیک `WORKFLOW_*` |
| Notifications | هوک `postCommit` + قالب‌های `notify.ts` (ED-17: شکست هرگز جریان را نمی‌شکند) |
| **Timeouts** | `policies.ts → TIMEOUT_POLICIES` (SLA هر وضعیت + نردبان REMIND→ESCALATE) |
| **Retries** | `policies.ts → RETRY_POLICIES` (backoff LINEAR/EXPONENTIAL) + صف کار با DLQ |
| **Failures** | `policies.ts → FAILURE_POLICIES` (taxonomi وضعیت‌های شکست هر ماشین) |
| **Recovery** | `recoveryActions` + `executeAdminRecovery` (فرار اضطراری ADMIN، BR-WF-07) |

### ۱۲.۱ جدول کاتالوگ ماشین‌ها (۱۱ ماشین)

| ماشین | موجودیت | وضعیت‌ها | گذارها | خطاهای تعریف‌شده (Failures) | مسیر بازیابی (Recovery) | مهم‌ترین SLA |
|---|---|---|---|---|---|---|
| CASE | MedicalCase | ۲۱ | ۱۸ | CANCELLED | فرار اضطراری ADMIN | صف کارشناس ۲۴h یادآوری / ۷۲h تشدید |
| PRESCRIPTION | Prescription | ۷ | ۷ | REJECTED, SUPERSEDED | REVISE (نسخه جدید) | صف EXPERT_2/DOCTOR ۲۴h |
| ORDER | Order | ۱۱ | ۱۰ | CANCELLED, REFUNDED | REFUND | تأیید سفارش ۱۲h/۴۸h |
| PAYMENT | Payment | ۶ | ۸ | FAILED, REJECTED | RETRY (بیمار) / REQUEST_INFO | **PENDING → ۳۰min انقضای درگاه (AUTO)** |
| SHIPMENT | Shipment | ۵ | ۴ | FAILED | فرار اضطراری | تحویل ۵d / در راه ۷d تشدید |
| TICKET | Ticket | ۶ | ۸ | — (RESOLVED/CLOSED موفق) | REOPEN | پاسخ ۲۴h/۷۲h |
| FOLLOWUP | FollowUp | ۵ | ۴ | CANCELLED | — | DUE ۲۴h / OVERDUE ۷۲h تشدید |
| AI_REVIEW | AIAnalysis | ۴ | ۴ | REJECTED | RESET (مدیر) | بازبینی انسانی ۱۲h/۴۸h تشدید |
| DELETION_REQUEST (P12) | DeletionRequest | ۴ | ۳ | REJECTED | فرار اضطراری | **مهلت حریم خصوصی ۴۸h/۷d تشدید** |
| MEDICAL_IMAGE (P12) | MedicalImage | ۴ | ۴ | REJECTED | REVALIDATE (مدیر) / بارگذاری مجدد بیمار | کارگر گیرکرده ۱h |
| INVOICE (P12) | Invoice | ۵ | ۴ | CANCELLED | صدور مجدد | تأیید پیش‌فاکتور ۷۲h |

### ۱۲.۲ فرآیندهای غیرماشین (عمداً)

| فرآیند | چرا ماشین نیست | منبع حقیقت Backend |
|---|---|---|
| Auth/OTP (چالش ۲ دقیقه‌ای) | چرخه عمر گذرا و کوتاه | `lib/security/otp.ts` (TTL + attempts + single-use) |
| Consent Records | دفتر versioned، نه وضعیت | `lib/security/privacy.ts` |
| SMS Delivery | زیرساخت ارسال با status QUEUED/SENT/FAILED | `SMSLog` + Jobs |
| Media StoredFile (P10) | چرخه زیرساخت فایل با Pipeline/TTL اختصاصی | `server/infrastructure/media/*` — پل بالینی آن از P12 به ماشین MEDICAL_IMAGE وصل شد |
| Dataset Lifecycle (P11) | DRAFT/FROZEN/ARCHIVED — immutable versions | `server/infrastructure/ai/datasets.ts` |

## ۱۳) لایه سیاست‌ها (`policies.ts` — خالص و Client-Safe)

### ۱۳.۱ نردبان SLA (Timeout)

هر وضعیت حساس می‌تواند **زنجیره سیاست** داشته باشد (مثال: صف کارشناس اول):

```text
CASE/WAITING_FOR_EXPERT_1:
  24h → REMIND    (notify EXPERT_1 + OPERATOR, cooldown 24h, سقف ۳ یادآوری)
  72h → ESCALATE  (یک‌بار — ADMIN + نقش‌های سیاست؛ لچِ escalatedAt)
PAYMENT/PENDING:
  30m → AUTO_TRANSITION (GATEWAY_FAIL توسط SYSTEM — idempotent با گراف ماشین)
```

| قاعده | مکانیزم |
|---|---|
| تکرار یادآوری | `cooldownMs` (پیش‌فرض ۲۴h) + `maxReminders` (پیش‌فرض ۳) — شمارنده در WorkflowState |
| تشدید یک‌بار | `escalatedAt` به‌عنوان Latch — هرگز اسپم نمی‌شود |
| انقضای خودکار | گذار فقط از وضعیت مبدا مجاز؛ رقابت با کاربر/گیت‌وی → INVALID_TRANSITION = no-op بی‌خطر |
| Retry خودکار | `cooldownMs` پیش‌فرض ۵ دقیقه + backoff نمایی مطابق RETRY_POLICIES |

### ۱۳.۲ Retry و Failures

- **RETRY_POLICIES**: PAYMENT/AUTO (نمایی ۲s×2ⁿ، ۳ تلاش)، FOLLOWUP/BATCH (خطی ۵s، ۲ تلاش)، MEDICAL_IMAGE/BATCH (نمایی، ۳ تلاش) + سیاست پیش‌فرض برای بقیه.
- **FAILURE_POLICIES**: هر ماشین failureStatuses + recoveryActions + مجوز فرار اضطراری (`forceRecovery`).
- صف کار (`jobs.ts`) تلاش/backoff/DLQ را برای همه کارهای سیستمی نگه می‌دارد (ED-102)؛ DLQ در کنسول حاکمیت قابل مشاهده است.

## ۱۴) Runtime حاکمیت (`governance.ts`)

Job تکرارشونده **هر ۲ دقیقه** (bootstrap):

```text
runWorkflowGovernanceTick()
  1) BACKFILL   ردیف‌های پیش-P12 → WorkflowState (enteredAt = createdAt)
  2) DRIFT      WorkflowState.status ≠ رکورد واقعی → re-sync + Audit WORKFLOW_STATE_DRIFT
                (هر مسیر آینده‌ای که موتور را دور بزند، همین‌جا لو می‌رود — پاسدار SoT)
  3) SLA        ارزیابی نردبان → REMIND / ESCALATE / AUTO_TRANSITION
                همه گذارها از executeTransition با Actor SYSTEM — هرگز نوشتن مستقیم
```

| ردیف WorkflowState (Prisma) | نقش |
|---|---|
| entityType + entityId (یکتا) | شناسه نمونه |
| status + enteredAt | کِی وارد وضعیت فعلی شد (شمارنده SLA) |
| lastRemindedAt / reminderCount |Latch یادآوری |
| escalatedAt | Latch تشدید |
| lastDriftSyncAt | ردیابی آشتی‌سازی |

> WorkflowState یک **Projection** است نه منبع حقیقت دوم — ستون status رکورد موجودیت، canonical باقی می‌ماند (کامنت مدل در schema.prisma).

## ۱۵) Sub-Transition (کاسکادهای Machine-Guarded — ED-33 اصلاح‌شده)

مسیرهای کاسکاد که قبلاً status را مستقیم می‌نوشتند، اکنون از `applySubTransition` داخل همان تراکنش فراخواننده عبور می‌کنند: گارد کامل + Audit + CaseEvent + WorkflowState:

| مسیر | قبل (bypass) | بعد (P12) |
|---|---|---|
| پرداخت تأیید شد | `order.update({status: PAID})` مستقیم + invoice.updateMany | ORDER.MARK_PAID (SYSTEM) → زنجیره txEffects → INVOICE.MARK_PAID (زیر‌گذار) + رکورد مالی |
| شروع پرداخت | `order.update({status: PAYMENT_PENDING})` + invoice.updateMany — **حفره گراف: هیچ گذاری به PAYMENT_PENDING نمی‌رسید!** | ORDER.ENTER_PAYMENT (ED-126) + INVOICE.CONFIRM |
| تأیید سفارش | invoice.updateMany CONFIRMED | INVOICE.CONFIRM (زیر‌گذار) |
| پل کارگر مدیا (تصویر) | medicalImage.updateMany | MEDICAL_IMAGE.VALIDATE / REJECT (موتور) |
| مصرف تصویر در AI | medicalImage.update PROCESSED | MEDICAL_IMAGE.MARK_PROCESSED (no-op خوش‌خیم برای re-run) |
| اسکن پیگیری (bootstrap) | followUp.updateMany بدون Audit | FOLLOWUP.MARK_DUE/MARK_OVERDUE سطر‌به‌سطر (Audited) |
| حذف داده (حریم خصوصی) | deletionRequest.update + تصاویر updateMany | DELETION_REQUEST.COMPLETE با ناشناس‌سازی اتمیک (ED-125) + MEDICAL_IMAGE.REJECT برای هر تصویر |

## ۱۶) بازیابی (Recovery) — سه لایه

| لایه | مسیر | ثبت |
|---|---|---|
| **Recovery طبیعی** | گذارهای بازیابی ماشین (PAYMENT.RETRY، TICKET.REOPEN، AI_REVIEW.RESET، MEDICAL_IMAGE.REVALIDATE، PRESCRIPTION.REVISE) | Audit استاندارد موتور |
| **Governance خودکار** | انقضای SLA → REMIND/ESCALATE/AUTO_TRANSITION | Audit `WORKFLOW_SLA_*` + WorkflowState |
| **فرار اضطراری مدیر** (BR-WF-07) | `POST /api/v1/admin/workflow/recover` → `executeAdminRecovery` — فقط ADMIN، دلیل ≥۳ حرف اجباری، وضعیت هدف باید در کاتالوگ ماشین باشد | Audit `WORKFLOW_ADMIN_RECOVER` + CaseEvent + اعلان WORKFLOW_RECOVERED به مالک + Console.warn ساخت‌یافته |

## ۱۷) API کنسول حاکمیت (ADMIN-only)

| Endpoint | متد | Function | Rate limit |
|---|---|---|---|
| `/api/v1/admin/workflow/overview` | GET | کاتالوگ ۱۱ ماشین + وضعیت‌های گیرکرده (SLA breach) + آخرین گزارش tick + صف/DLQ + بازیابی‌های اخیر | — |
| `/api/v1/admin/workflow/scan` | POST | اجرای دستی یک tick حاکمیت (بک‌فیل + drift + SLA) | ۳/دقیقه |
| `/api/v1/admin/workflow/recover` | POST | فرار اضطراری: `{entityType, entityId, targetStatus, reason}` | ۱۰/دقیقه |

**تأیید عملکردی زنده:** scan → ۱۱ ماشین / ۹۳ نمونه / ۰ خطا؛ recover واقعی AI_REVIEW → ACCEPTED با Audit اتمیک + WorkflowState؛ نقش PATIENT روی هر سه → 403.

## ۱۸) قواعد کسب‌وکار جدید (BR-WF)

- **BR-WF-01** — هیچ فرآیند مهمی در UI کنترل نمی‌شود؛ UI فقط `action` درخواست می‌کند و گاردها (نقش/Permission/مالکیت/گراف) در Backend.
- **BR-WF-02** — هر گذار: Audit اتمیک + WorkflowState sync در همان تراکنش.
- **BR-WF-03** — بُعد Timeout برای هر وضعیت انتظار از طریق TIMEOUT_POLICIES — مقادیر SLA فقط در policies.ts تنظیم می‌شوند.
- **BR-WF-04** — تشدید یک‌بار (Latch)؛ یادآوری با cooldown و سقف؛ انقضای خودکار idempotent.
- **BR-WF-05** — Drift (نوشتن status خارج از موتور) = تخلف معماری؛ در هر tick آشکار، آشتی و Audit می‌شود.
- **BR-WF-06** — کاسکادهای مالی همیشه زیر‌گذار Machine-Guarded داخل همان تراکنش (ED-33/P12).
- **BR-WF-07** — فرار اضطراری فقط ADMIN + دلیل اجباری + وضعیت قانونی + Audit کامل (WORKFLOW_ADMIN_RECOVER).

## ۱۹) تصمیمات مهندسی فاز ۱۲

| ED | تصمیم |
|---|---|
| ED-121 | لایه سیاست اعلانی خالص (policies.ts) — مقادیر SLA/Retry/Failure داده‌اند نه کد پراکنده؛ خالص و Client-Safe |
| ED-122 | WorkflowState به‌عنوان Projection اتمیک هر گذار (یکتا per موجودیت؛ شمارنده‌های SLA در آن؛ رکورد موجودیت canonical می‌ماند) |
| ED-123 | Runtime حاکمیت هرگز status را مستقیم نمی‌نویسد — همیشه از executeTransition با SYSTEM |
| ED-124 | DELETION_REQUEST ماشین‌دار شد + یکسان‌سازی وضعیت پایانی به COMPLETED (ناسازگاری قدیمی PROCESSED در adminService) |
| ED-125 | ناشناس‌سازی داخل همان تراکنش گذار COMPLETE (anonymizeUserTx) — همه‌یا‌هیچ با تغییر وضعیت درخواست |
| ED-126 | رفع حفره گراف ORDER: گذار ENTER_PAYMENT (PAYMENT_PENDING قبلاً از هیچ مسیر ماشین‌محوری قابل دسترس نبود) |
| ED-127 | بازسازی `POST /api/v1/images/upload` — مسیر موجود در فازهای ۰۸–۱۱ اما هرگز commit نشده و از workspace حذف شده بود (الگوی تکراری ثبت‌نشدن فایل؛ همان الگوی register/route.ts فاز ۰۰) |
| ED-128 | TS_CAPS: نقشه ستون‌های زمانی هر جدول (updatedAt/deletedId همگانی نیست؛ DeletionRequest → requestedAt) برای بک‌فیل/Drift |
| ED-129 | notifyRole + کدهای WORKFLOW_REMINDER/ESCALATED/RECOVERED/DELETION_REJECTED به موتور اعلان |

**تأییدها:** `bun test` ۲۸۳/۲۸۳ · Lint 0 خطا · Backend-Audit PASSED (0 E-error) · Frontend-Audit PASSED · Pentest 45/45 · Probe امنیتی: 401/403 صحیح، ADMIN endpoints عملکردی.
