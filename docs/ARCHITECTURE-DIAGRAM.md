# BabaHakim — نمودارهای معماری (Architecture Diagrams)

| فیلد | مقدار |
|---|---|
| نسخه | 1.0.0 |
| تاریخ | 1405/06/14 (2026-09-04) |
| فاز | PHASE 03 — System Architecture |
| سند مادر | `ARCHITECTURE.md` (متن تصمیمات) — این سند فقط نمودارها + توضیح کوتاه هر نمودار |
| ابزار | Mermaid (رندر بومی GitHub/GitLab/VSCode) |

> **یادداشت زبان نمودارها:** برچسب گره‌ها و پیام‌ها در نمودارها به انگلیسی (نام‌های فنی همان اجزای سند مادر) نوشته شده‌اند، چون موتور رندر Mermaid متن را LTR ترسیم می‌کند و متن فارسی RTL در لبه‌ها/برچسب‌ها به‌هم‌ریخته نمایش داده می‌شود. توضیح هر نمودار فارسی است و هر نام انگلیسی دقیقاً معادل جدول‌های `ARCHITECTURE.md` است (قاعده زبان سند: اصطلاحات فنی به انگلیسی).

---

## فهرست

1. [سطح ۱ — System Context (C4)](#1-سطح-۱--system-context-c4)
2. [سطح ۲ — Container (C4)](#2-سطح-۲--container-c4)
3. [مدل وابستگی Tierها (DAG)](#3-مدل-وابستگی-tierها-dag)
4. [Bounded Context Map](#4-bounded-context-map)
5. [کالبد داخلی یک ماژول (Anatomy)](#5-کالبد-داخلی-یک-ماژول-anatomy)
6. [Pipeline تحلیل AI](#6-pipeline-تحلیل-ai)
7. [چرخه عمر بیمار — Sequence سناریوی طلایی (۱۷ مرحله)](#7-چرخه-عمر-بیمار--sequence-سناریوی-طلایی-۱۷-مرحله)
8. [جریان سفارش تا تحویل (با Adapterها)](#8-جریان-سفارش-تا-تحویل-با-adapterها)
9. [جریان رویدادها (Event Flow)](#9-جریان-رویدادها-event-flow)
10. [مالکیت داده — Context و Schema](#10-مالکیت-داده--context-و-schema)
11. [استقرار Dev (docker-compose)](#11-استقرار-dev-docker-compose)
12. [توپولوژی Prod (هدف)](#12-توپولوژی-prod-هدف)
13. [نقشه Extraction آینده](#13-نقشه-extraction-آینده)

---

## 1. سطح ۱ — System Context (C4)

سیستم BabaHakim و بازیگران/سیستم‌های خارجی آن. (معادل PRD §2 — ۶ نقش + ۴ Actor خارجی)

```mermaid
flowchart TB
    subgraph people["Actors"]
        PATIENT["Patient / User"]
        EXPERT1["Expert 1"]
        EXPERT2["Expert 2"]
        DOCTOR["Doctor"]
        OPERATOR["Operator"]
        ADMIN["Admin"]
    end

    BH["BabaHakim Platform<br/>Modular Monolith - AI tongue analysis<br/>+ clinical workflow + commerce"]

    subgraph external["External Systems"]
        PSP["Zarinpal PSP<br/>(Payment Gateway)"]
        SMS["SMS Gateway<br/>(Kavenegar / SMS.ir)"]
        COURIER["Courier Services<br/>(Post / Tipax / internal fleet)"]
        MAIL["Email / Push (future)"]
    end

    PATIENT -->|"register - questionnaire - upload image<br/>shop - pay - track"| BH
    EXPERT1 -->|"claim - assess - prescribe"| BH
    EXPERT2 -->|"review - pricing - forward"| BH
    DOCTOR -->|"approve - reject - revision"| BH
    OPERATOR -->|"proforma - shipment - payment verify"| BH
    ADMIN -->|"RBAC - catalog - prices - reports - audit"| BH

    BH -->|"payment request / verify"| PSP
    PSP -->|"callback (idempotent)"| BH
    BH -->|"SMS dispatch"| SMS
    BH -->|"shipment register / tracking"| COURIER
    BH -->|"email / push"| MAIL
```

---

## 2. سطح ۲ — Container (C4)

اجزای اجرایی معماری — دقیقاً ۱۱ جزء جدول `ARCHITECTURE.md §3.1`. سبک پیام‌ها: **Sync در-پروسه/HTTP** و **Async از Queue**.

```mermaid
flowchart TB
    subgraph clients["Clients"]
        BROWSER["Browser<br/>FA-RTL / EN-LTR"]
    end

    subgraph app["BabaHakim Application (one codebase - two processes)"]
        WEB["web - Next.js App Router<br/>Frontend SPA + /api/v1 Route Handlers<br/>(thin delivery layer)"]
        WORKER["worker - BullMQ consumer process<br/>ai.analyze - notify.dispatch - sla.check<br/>reporting.aggregate - payment.retry"]
    end

    subgraph infra["Infrastructure"]
        DB[("PostgreSQL 16<br/>schema per bounded context")]
        REDIS[("Redis 7<br/>cache + queues")]
        S3[("Object Storage S3-compatible<br/>MinIO dev / S3 prod<br/>private bucket: bh-medical")]
        AI["ai - AI Service<br/>(FastAPI + Tongue models)<br/>behind AIModelProvider port"]
        NOTIF["notifications module + adapters<br/>in-app - SMS - email"]
    end

    subgraph gateways["Ports and Adapters"]
        PAYGW["PaymentGateway port<br/>adapter: Zarinpal"]
        SHIPGW["ShippingProvider port<br/>adapters: internal - post - tipax"]
        OBJGW["ObjectStorage port<br/>adapter: local-fs then S3"]
    end

    PSP["Zarinpal PSP"]
    SMSGW["SMS Gateway"]

    BROWSER -->|"HTTPS - JWT cookies"| WEB
    WEB -->|"SQL - Prisma"| DB
    WEB -->|"cache - rate-limit"| REDIS
    WEB -->|"job enqueue"| REDIS
    WEB -->|"sync call (analysis)"| AI
    WEB -->|"storage put/get - signed URLs"| OBJGW
    OBJGW --> S3

    REDIS -->|"consume jobs"| WORKER
    WORKER -->|"SQL - Prisma"| DB
    WORKER -->|"inference / health"| AI
    WORKER -->|"dispatch"| NOTIF
    NOTIF -->|"send SMS"| SMSGW
    WORKER -->|"cache update"| REDIS

    WEB -->|"init - verify"| PAYGW
    PAYGW -->|"request - verify"| PSP
    PSP -->|"async callback /api/v1/payments/zarinpal/callback"| WEB
    WORKER -->|"register shipment"| SHIPGW
```

---

## 3. مدل وابستگی Tierها (DAG)

نمودار گراف وابستگی Contextها — قاعده D1 (`ARCHITECTURE.md §5`): پیکان‌ها فقط از بالا به پایین؛ **هیچ مسیر بازگشتی وجود ندارد ⇒ چرخه ریاضیاتاً ناممکن**.

```mermaid
flowchart TB
    KERNEL["Kernel - src/shared<br/>db - i18n - Result - ConfigService - AuditPort<br/>(imports nothing from modules)"]

    subgraph T0["T0"]
        IDENTITY["Identity"]
        ADMINCTX["Administration<br/>(settings - audit stream)"]
    end

    subgraph T1["T1"]
        NOTIF["Notifications"]
        PATIENTS["Patients"]
    end

    subgraph T2["T2"]
        MEDREC["Medical Records"]
        PRODUCTS["Products"]
        TICKETS["Tickets"]
    end

    subgraph T3["T3"]
        AICTX["AI"]
        RX["Prescriptions"]
        COMMERCE["Commerce"]
    end

    subgraph T4["T4"]
        CLIN["Clinical Review<br/>(clinical orchestrator)"]
        PAY["Payments<br/>(financial orchestrator)"]
        SHIP["Shipping"]
    end

    subgraph T5["T5"]
        FINANCE["Finance"]
        REPORT["Reporting<br/>(events + read models only)"]
    end

    KERNEL --> IDENTITY
    KERNEL --> ADMINCTX

    IDENTITY --> NOTIF
    IDENTITY --> PATIENTS
    ADMINCTX --> PATIENTS

    PATIENTS --> MEDREC
    PATIENTS --> TICKETS
    IDENTITY --> TICKETS
    NOTIF --> TICKETS

    MEDREC --> AICTX
    PATIENTS --> RX
    PRODUCTS --> RX
    PRODUCTS --> COMMERCE
    PATIENTS --> COMMERCE

    AICTX --> CLIN
    RX --> CLIN
    COMMERCE --> CLIN
    MEDREC --> CLIN
    PATIENTS --> CLIN
    COMMERCE --> PAY
    COMMERCE --> SHIP

    PAY --> FINANCE
    COMMERCE --> FINANCE

    REPORT -.->|"consumes events from all (no compile-time import)"| KERNEL
    FINANCE --> REPORT
```

> نکته: خط‌چین `REPORT` یعنی تغذیه **فقط از Event Bus/Read Model** — نه import کد. این تنها رابطه‌ای است که در نمودار وابستگی کامپایل‌زمان دیده نمی‌شود.

---

## 4. Bounded Context Map

نقشه ارتباط دامنه‌ای (Context Map) — نوع رابطه هر Context با بقیه (SO = Sync Facade، EV = Event، SR = Soft Reference):

```mermaid
flowchart LR
    IDENTITY["Identity<br/>T0"]
    ADMINCTX["Administration<br/>T0"]
    NOTIF["Notifications<br/>T1"]
    PATIENTS["Patients<br/>T1"]
    MEDREC["Medical Records<br/>T2"]
    PRODUCTS["Products<br/>T2"]
    TICKETS["Tickets<br/>T2"]
    AICTX["AI<br/>T3"]
    RX["Prescriptions<br/>T3"]
    COMMERCE["Commerce<br/>T3"]
    CLIN["Clinical Review<br/>T4"]
    PAY["Payments<br/>T4"]
    SHIP["Shipping<br/>T4"]
    FINANCE["Finance<br/>T5"]
    REPORT["Reporting<br/>T5"]

    IDENTITY -->|"SO: resolve user"| NOTIF
    PATIENTS -->|"EV: questionnaire submitted"| CLIN
    MEDREC -->|"EV: image stored / rejected"| AICTX
    MEDREC -->|"SO: signed url"| CLIN
    AICTX -->|"EV: analysis completed"| CLIN
    RX -->|"EV: prescription finalized"| COMMERCE
    PRODUCTS -->|"SO: price / availability"| RX
    PRODUCTS -->|"SO: catalog + price"| COMMERCE
    CLIN -->|"SO: issue invoice (atomic)"| COMMERCE
    CLIN -->|"SO: create order"| COMMERCE
    COMMERCE -->|"SO: invoice + order (cascade writer)"| PAY
    COMMERCE -->|"SO: order (cascade writer)"| SHIP
    PAY -->|"EV: payment confirmed"| FINANCE
    PAY -->|"EV: payment confirmed"| REPORT
    SHIP -->|"EV: delivered"| CLIN
    TICKETS -.->|"SR: orderId / caseId"| COMMERCE
    TICKETS -.->|"SR: caseId"| CLIN
    ADMINCTX -.->|"settings via Kernel ConfigService"| PATIENTS
```

---

## 5. کالبد داخلی یک ماژول (Anatomy)

ساختار استاندارد هر Bounded Context — سطح عمومی فقط `api/` است (قاعده D2):

```mermaid
flowchart TB
    subgraph module["modules/payments (example context)"]
        subgraph api["api/ - PUBLIC FACADE (only importable surface)"]
            FACADE["index.ts<br/>initiatePayment() - verifyGatewayCallback()<br/>submitCardReceipt() - operatorApprovePayment()"]
            TYPES["types.ts<br/>DTOs - commands - results"]
        end
        subgraph domain["domain/ - PRIVATE"]
            MACHINE["payment.machine.ts<br/>6 states / 8 transitions"]
            CASCADE["paymentPaidCascade.ts<br/>atomic single-writer cascade"]
            EVENTS["events.ts<br/>payments.payment.confirmed/failed"]
        end
        subgraph infra["infra/ - PRIVATE"]
            REPO["repository.ts<br/>Prisma Payment model only"]
            GATEWAY["zarinpal.adapter.ts<br/>implements PaymentGateway port"]
        end
    end

    ROUTES["app/api/v1/payments/**<br/>(thin route handlers)"] -->|"imports only api/"| FACADE
    FACADE --> MACHINE
    FACADE --> REPO
    MACHINE --> CASCADE
    GATEWAY --> PSP["Zarinpal PSP"]
    EVENTS --> BUS["Event Bus (BullMQ)"]

    style api fill:#DEDBDB,stroke:#173F76
    style domain fill:#57AFE2,stroke:#173F76
    style infra fill:#225BBE,stroke:#173F76,color:#fff
```

رنگ‌ها طبق Design System BabaHakim: سطح عمومی (خاکستری `#DEDBDB`)، دامنه (آبی روشن `#57AFE2`)، زیرساخت (آبی `#225BBE`).

---

## 6. Pipeline تحلیل AI

مسیر کامل تصویر از آپلود تا بازبینی انسانی (ادغام §4.2 AI و ماشین AI_REVIEW فاز 02):

```mermaid
flowchart TB
    UP["Patient uploads tongue photo<br/>/api/v1/images/upload"] --> VALID["sharp pipeline<br/>MIME - size - corruption - metadata strip"]
    VALID -->|"invalid"| REJ["REJECTED<br/>actionable FA message"]
    VALID -->|"ok"| QGATE["Quality gate<br/>blur variance - brightness - exposure - resolution"]
    QGATE -->|"below threshold (ED-29)"| REJ
    QGATE -->|"accepted"| VARIANTS["4 variants<br/>original - compressed - ai - thumb"]
    VARIANTS --> STORE["Object Storage (private bucket)<br/>+ SHA-256 + quality JSON"]
    STORE --> EVSTORE["event: medicalrecords.image.stored"]
    EVSTORE --> ENQ["enqueue job ai.analyze(caseId, imageId)"]
    ENQ --> PROVIDER["AIModelProvider port"]
    PROVIDER --> MODEL["TongueModelV1 (in-process today)<br/>or AI Service container (target)"]
    MODEL --> PRED["prediction + confidence x quality-damping<br/>+ explainability indicators"]
    PRED --> SAVE["AIAnalysis record<br/>reviewStatus = PENDING_REVIEW"]
    SAVE --> EVAI["event: ai.analysis.completed"]
    EVAI --> NEXP1["Expert 1 queue - suggestion card in UI"]
    EVAI --> NEXP2["Notifications: patient informed"]
    NEXP1 --> HUMAN["Human review chain<br/>Expert 1 - Expert 2 - Doctor<br/>(AI is a suggestion - never a final verdict)"]

    style QGATE fill:#57AFE2,stroke:#173F76
    style HUMAN fill:#DEDBDB,stroke:#173F76
    style MODEL fill:#225BBE,stroke:#173F76,color:#fff
```

---

## 7. چرخه عمر بیمار — Sequence سناریوی طلایی (۱۷ مرحله)

۱۷ مرحله چرخه عمر بیمار (PRD §9 / USE-CASES §۲) روی اجزای معماری — شماره‌گذاری ۱ تا ۱۷ دقیقاً مطابق فهرست رسمی: Registration, Questionnaire, Image Upload, AI Analysis, Expert 1, Initial Assessment, User Approval, Prescription, Expert 2, Doctor, Order, Invoice, Payment, Shipment, Delivery, Follow-up, Reassessment. برای خوانایی، سه Lane منطقی: بیمار، سیستم (web/worker)، زنجیره انسانی + مالی:

```mermaid
sequenceDiagram
    autonumber
    participant P as Patient
    participant W as web (api)
    participant K as worker (queue)
    participant A as AI service
    participant E1 as Expert 1
    participant E2 as Expert 2
    participant D as Doctor
    participant O as Operator
    participant PAY as Payment adapter

    Note over P,W: 1-Registration
    P->>W: register (mobile OTP-style login)
    W-->>P: welcome + questionnaire prompt

    Note over P,W: 2-Questionnaire
    P->>W: submit 15-question mizaj questionnaire
    W-->>P: mizaj result (4-dimension scores)

    Note over P,K: 3-Image Upload
    P->>W: upload tongue image
    W->>W: quality gate -> 4 variants -> object storage
    W-->>P: accepted / rejected (actionable reason)

    Note over W,A: 4-AI Analysis
    W->>K: enqueue ai.analyze
    K->>A: inference request
    A-->>K: prediction + confidence + explainability
    K->>W: AIAnalysis saved (PENDING_REVIEW)

    Note over E1: 5-Expert 1
    E1->>W: claim case

    Note over E1: 6-Initial Assessment
    E1->>W: assessment + initial diagnosis

    Note over P: 7-User Approval (gate G7)
    W-->>P: notification: approve assessment?
    P->>W: approve

    Note over E1: 8-Prescription (Expert 1)
    E1->>W: prescription draft + dosage instructions

    Note over E2: 9-Expert 2
    E2->>W: review + availability + pricing

    Note over D: 10-Doctor approval (gate G9)
    D->>W: approve / reject / revision

    Note over O: 11-Order + 12-Invoice
    O->>W: issue proforma INV-xxx (7-day expiry ED-30)
    W-->>P: proforma notification

    Note over P: 13-Payment
    P->>W: choose gateway / card-to-card
    W->>PAY: initiate (idempotency key)
    PAY-->>W: callback verify -> atomic cascade
    W-->>P: payment confirmed

    Note over O: 14-Shipment
    O->>W: register shipment (courier + tracking TRK-xxx)

    Note over P: 15-Delivery
    W-->>P: delivery confirmation

    Note over K: 16-Follow-up
    K->>W: schedule follow-up (doctor-set interval)

    Note over K: 17-Reassessment
    W-->>P: follow-up survey
    P->>W: request reassessment -> new case with lineage (ED-13)
```

---

## 8. جریان سفارش تا تحویل (با Adapterها)

Cascade مالی-ارسال (ماشین‌های ORDER/PAYMENT/SHIPMENT فاز 02 — ED-33 «نویسنده واحد»):

```mermaid
sequenceDiagram
    autonumber
    participant P as Patient
    participant W as web
    participant ENG as workflow engine
    participant PG as Zarinpal adapter
    participant PSP as Zarinpal PSP
    participant O as Operator
    participant SP as Shipping adapter

    P->>W: confirm proforma / checkout
    W->>ENG: ORDER.CONFIRM (machine guard)
    ENG-->>W: order CONFIRMED + audit + notify

    P->>W: initiate gateway payment
    W->>PG: request authority (idempotent)
    PG->>PSP: payment request
    PSP-->>PG: authority
    PG-->>W: redirect URL

    PSP->>W: callback (verify + idempotency key)
    W->>ENG: PAYMENT.VERIFY_GATEWAY (SYSTEM actor)
    ENG->>ENG: atomic cascade:<br/>Payment PAID + Invoice PAID + Order PAID<br/>+ FinancialTransaction + Case progress
    ENG-->>W: event payments.payment.confirmed

    Note over O: card-to-card alternative path
    P->>W: upload receipt + tracking number
    O->>W: operator verify -> same cascade (manual gate G10)

    O->>W: register shipment
    W->>SP: create shipment (internal / post / tipax)
    SP-->>W: tracking TRK-xxx
    W->>ENG: SHIPMENT.DISPATCH (cascades ORDER only)
    Note over W: delivery -> SHIPMENT.DELIVER<br/>(ORDER via single-writer - never touches CASE)

    W-->>P: notifications at each stage (34 templates)
```

---

## 9. جریان رویدادها (Event Flow)

مسیر Async رویدادهای هسته (کاتالوگ کامل `ARCHITECTURE.md §7.2`). ناشر → Queue → Consumerها:

```mermaid
flowchart LR
    subgraph publishers["Domain events (publishers)"]
        ID1["identity.user.registered"]
        MR["medicalrecords.image.stored"]
        AI1["ai.analysis.completed"]
        CR["clinicalreview.case.stage.changed"]
        RX1["prescriptions.prescription.finalized"]
        CM["commerce.invoice.issued"]
        PM["payments.payment.confirmed"]
        SH1["shipping.shipment.delivered"]
    end

    BUS[("Event Bus<br/>BullMQ + Redis<br/>at-least-once + eventId idempotency<br/>DLQ after N retries")]

    subgraph consumers["Consumers (worker)"]
        NTF["notify.dispatch<br/>34 templates in-app + SMS"]
        FNC["finance.projection<br/>revenue / reconciliation"]
        RPT["reporting.aggregate<br/>daily read models"]
        SLA["sla.check<br/>ED-08 gates - reminders"]
    end

    ID1 --> BUS
    MR --> BUS
    AI1 --> BUS
    CR --> BUS
    RX1 --> BUS
    CM --> BUS
    PM --> BUS
    SH1 --> BUS

    BUS --> NTF
    BUS --> FNC
    BUS --> RPT
    BUS --> SLA

    style BUS fill:#173F76,color:#fff
    style NTF fill:#57AFE2
    style FNC fill:#57AFE2
    style RPT fill:#57AFE2
    style SLA fill:#57AFE2
```

---

## 10. مالکیت داده — Context و Schema

نگاشت ۳۶ مدل Prisma به Contextها و Postgres Schema هدف (تک‌مالکیتی — جدول `ARCHITECTURE.md §4.1`):

```mermaid
flowchart TB
    subgraph db["PostgreSQL - one schema per context (FK across schemas forbidden)"]
        subgraph s_identity["schema: identity"]
            M1["User - Role - Permission<br/>RolePermission - RefreshToken"]
        end
        subgraph s_patients["schema: patients"]
            M2["PatientProfile - Questionnaire<br/>Question - QuestionOption<br/>QuestionnaireResponse - Referral"]
        end
        subgraph s_medrec["schema: medical_records"]
            M3["MedicalImage<br/>4 variants + SHA-256 + quality"]
        end
        subgraph s_ai["schema: ai"]
            M4["AIModel - AIAnalysis"]
        end
        subgraph s_clin["schema: clinical_review"]
            M5["MedicalCase - CaseEvent<br/>Disease - Diagnosis"]
        end
        subgraph s_prod["schema: products"]
            M6["Product - ProductPriceHistory<br/>DiseaseProduct"]
        end
        subgraph s_rx["schema: prescriptions"]
            M7["Prescription - PrescriptionItem"]
        end
        subgraph s_comm["schema: commerce"]
            M8["CartItem - Order - OrderItem - Invoice"]
        end
        subgraph s_pay["schema: payments"]
            M9["Payment"]
        end
        subgraph s_ship["schema: shipping"]
            M10["Shipment"]
        end
        subgraph s_notif["schema: notifications"]
            M11["Notification - SMSLog"]
        end
        subgraph s_tick["schema: tickets"]
            M12["Ticket - TicketMessage"]
        end
        subgraph s_fin["schema: finance"]
            M13["FinancialTransaction"]
        end
        subgraph s_adm["schema: administration"]
            M14["AuditLog (append-only) - SystemSetting"]
        end
        subgraph s_rpt["schema: reporting (read models)"]
            M15["daily_revenue - case_sla - top_products<br/>(projections - not OLTP)"]
        end
    end

    style s_identity fill:#DEDBDB,stroke:#173F76
    style s_clin fill:#57AFE2,stroke:#173F76
    style s_rpt fill:#DEDBDB,stroke:#225BBE,stroke-dasharray: 5 5
    style db fill:#FFFFFF,stroke:#173F76
```

> ارجاع بین‌Schema فقط Soft Reference (ID) — مثل `Ticket.orderId`. در SQLite فعلی همین تفکیک با تست معماری نگه داشته می‌شود.

---

## 11. استقرار Dev (docker-compose)

توپولوژی استقرار توسعه (قید C4 — هم VSCode هم Docker):

```mermaid
flowchart TB
    DEV["Developer machine<br/>(VSCode dev server :3000)"]

    subgraph compose["docker-compose - babahakim-dev"]
        subgraph net["internal network (isolated)"]
            PGX[("postgres:16")]
            RDX[("redis:7")]
            MINIO[("minio - S3 API<br/>bucket: bh-medical")]
            AIX["ai-service (FastAPI)<br/>:8000 internal only"]
        end
    end

    subgraph outside["external"]
        PSPX["Zarinpal sandbox"]
        SMSX["SMS gateway (mock in dev)"]
    end

    DEV -->|"Prisma + app SQL"| PGX
    DEV -->|"queues + cache"| RDX
    DEV -->|"S3 SDK"| MINIO
    DEV -->|"AIModelProvider - HTTP"| AIX
    DEV -->|"sandbox mode"| PSPX
    DEV -->|"log-only (no real SMS in dev)"| SMSX

    style compose fill:#FFFFFF,stroke:#173F76
    style net fill:#DEDBDB,stroke:#225BBE
```

---

## 12. توپولوژی Prod (هدف)

```mermaid
flowchart TB
    U["Users - browsers (FA/EN)"]
    LB["Load Balancer / Caddy<br/>TLS termination"]

    subgraph cluster["BabaHakim production"]
        WEB1["web replica 1<br/>Next.js standalone"]
        WEB2["web replica 2<br/>(stateless JWT - horizontal scale)"]
        WRK1["worker pool<br/>notify + sla (high concurrency)"]
        WRK2["worker pool<br/>ai.analyze (low concurrency - GPU-bound)"]
        PG[("PostgreSQL primary<br/>+ daily backup - restore drill")]
        PGREP[("Read replica<br/>(reporting queries - future)")]
        RDS[("Redis<br/>cache + queues + DLQ")]
        S3P[("Object Storage S3<br/>bucket: bh-medical (private)")]
        AIS["ai-service<br/>(GPU node when needed - no app change)"]
    end

    PSP["Zarinal PSP"]
    MON["Prometheus + Grafana<br/>(metrics - alerting)"]

    U --> LB
    LB --> WEB1
    LB --> WEB2
    WEB1 --> PG
    WEB2 --> PG
    WRK1 --> PG
    WRK2 --> PG
    WEB1 --> RDS
    WEB2 --> RDS
    WRK1 --> RDS
    WRK2 --> RDS
    WRK2 --> AIS
    WEB1 --> S3P
    WRK1 --> S3P
    PG --> PGREP
    WEB1 -->|"payment verify"| PSP
    PSP -->|"callback"| LB
    WEB1 -.-> MON
    WRK1 -.-> MON
    WRK2 -.-> MON

    style cluster fill:#FFFFFF,stroke:#173F76
    style AIS fill:#225BBE,color:#fff
    style PG fill:#DEDBDB,stroke:#173F76
```

---

## 13. نقشه Extraction آینده

مسیر معیارمحور شکستن Monolith (فقط پس از برآورده‌شدن معیارهای `ARCHITECTURE.md §2.3`) — استراتژی Strangler:

```mermaid
flowchart TB
    NOW["v1 - TODAY<br/>Modular Monolith<br/>web + worker + postgres + redis + s3<br/>15 modules - enforced boundaries"]

    STEP1["Step 1 (first candidate)<br/>EXTRACT AI SERVICE<br/>AIModelProvider: in-process -> HTTP<br/>code consumers unchanged"]
    STEP2["Step 2<br/>EXTRACT NOTIFICATION SERVICE<br/>queue consumer -> standalone deploy<br/>publishers already event-driven"]
    STEP3["Step 3 (if PCI scope demands)<br/>EXTRACT PAYMENTS<br/>facade -> API gateway + own schema"]
    STEP4["Step 4 (if analytics load demands)<br/>EXTRACT REPORTING<br/>event feed + analytical store"]

    KEEP["NEVER (last): Clinical Review - Patients - Identity<br/>highest cross-context transactionality<br/>clinical integrity core"]

    NOW -->|"trigger: GPU scale / release cadence"| STEP1
    STEP1 -->|"trigger: SMS volume / rate-limit risk"| STEP2
    STEP2 -->|"trigger: PCI compliance scope"| STEP3
    STEP3 -->|"trigger: analytics load"| STEP4
    KEEP -.->|"stays in monolith core"| NOW

    style NOW fill:#173F76,color:#fff
    style KEEP fill:#DEDBDB,stroke:#173F76
    style STEP1 fill:#225BBE,color:#fff
    style STEP2 fill:#57AFE2
    style STEP3 fill:#57AFE2
    style STEP4 fill:#57AFE2
```

---

## نکات رندر

- همه نمودارها با Mermaid v10+ سازگارند (GitHub / VSCode Mermaid Preview / GitLab).
- رنگ‌های به‌کاررفده از Design System رسمی BabaHakim هستند: `#173F76`، `#225BBE`، `#57AFE2`، `#DEDBDB` (سند `BRANDING.md`).
- در صورت تغییر معماری، این سند به‌همراه `ARCHITECTURE.md` و ADR مربوطه در یک Commit به‌روزرسانی می‌شوند (قاعده ۱۱ منشور).
