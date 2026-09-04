# BabaHakim — Database Architecture | معماری پایگاه داده (PHASE 04)

> **فاز:** PHASE 04 — Database Architecture · **تاریخ:** ۱۴۰۵/۰۶/۱۴ (2026-09-04)
> **منبع حقیقت DDL:** `database/models/` (SQLAlchemy 2.0) → **Alembic** (تنها مسیر تغییر Schema — قاعده ۸ منشور)
> **ارتباط:** `ARCHITECTURE.md §8` · `ADR-0004` · `ADR-0013` · `DATABASE-ERD.md` · ED-47..58 در `BUSINESS-RULES.md §5`

---

## ۰) خلاصه اجرایی — قرارداد داده در یک نگاه

| شاخص | مقدار | توضیح |
|---|---|---|
| موتور | PostgreSQL 16.2 | ACID، Transaction واقعی برای Cascade مالی (C2) |
| تفکیک منطقی | **۱۵ Schema = ۱۵ Bounded Context** | ADR-0004 — Schema-per-Context |
| جداول | **۴۹** (۴۰ Entity اصلی مشخصات §47 + ۹ پشتیبان) | §۳ کاتالوگ کامل |
| ستون‌ها | ۶۲۵ | — |
| کلید اصلی | `BIGINT GENERATED ALWAYS AS IDENTITY` | ED-48 |
| FK واقعی | **۳۴** — همگی درون-Schema | FK بین-Schema ممنوع (D4) |
| Check Constraint | **۱۶۷** | قواعد کسب‌وکار سطح DB — §۵ |
| Unique Constraint/Index | ۲۳ Constraint + ۸۸ Unique Index (۴۱ Partial) | §۹ |
| Index کل | ۱۹۰ (۴ BRIN + ۴ GIN-trgm) | §۹ |
| تریگر | **۴۴** (۵۲ event) | §۶ |
| Append-Only | ۸ جدول تاریخچه‌ای | §۸ |
| Soft-Delete | ۱۳ جدول + تریگر ممنوعیت Hard-Delete | §۷ |
| JSONB | ۱۵ ستون (payload/snapshot/کیفیت) | — |
| Migration | ۴ فایل Alembic خطی | §۱۰ |
| تست | **۸۵/۸۵ PASS** (`pytest`) | §۱۱ |
| افزونه | `pg_trgm 1.6` (جستجوی فازی) + `pgvector` آماده | — |

---

## ۱) جایگاه در معماری و جریان مالکیت DDL

```
database/                     ← زیرپروژه Python در Monorepo (Modular Monolith)
├── models/                   ← SQLAlchemy 2.0 — منبع حقیقت Schema (۱۵ فایل = ۱۵ Context)
│   ├── base.py               ← Naming Convention + Mixinها (Id/Timestamp/SoftDelete)
│   ├── statuses.py           ← کاتالوگ مقادیر CHECK — هم‌ردیف constants.ts اپ
│   └── identity.py … reporting.py
├── alembic/                  ← Migrations (0001..0004) + env.py (15-schema filter)
├── scripts/                  ← pg_server.py (سرور Embedded) · generate_er_diagrams.py
├── tests/                    ← ۵ فایل pytest — فقط از مسیر Migration پروویژن می‌شود
├── requirements.txt · .pgurl (gitignored) · pgdata/ (gitignored)
```

**جریان:** تغییر مدل در `models/` → `alembic revision --autogenerate` → بازبینی دستی → `upgrade head` → `alembic check` (صفر Drift) → تست‌ها. هیچ DDL دستی خارج Alembic مجاز نیست (قاعده ۸ منشور؛ PRهای حاوی diff خام SQL رد می‌شوند).

**نقش اپ Next.js:** تا مهاجرت اپ (فاز بعدی طبق §8.4 ARCHITECTURE)، SQLite فعلی dev باقی می‌ماند؛ PostgreSQL این فاز **دیتابیس هدف Production** است که Prisma بعداً با `prisma db pull` از آن Introspection می‌کند (ADR-0013).

### ۱.۱ راه‌اندازی و اجرا (Dev)

```bash
cd database
.venv/bin/python scripts/pg_server.py start    # init + start + ساخت babahakim_dev/_test → .pgurl
.venv/bin/alembic upgrade head                 # اعمال Migrations
.venv/bin/alembic check                        # صفر Drift مدل↔دیتابیس
.venv/bin/python -m pytest tests/ -q           # ۸۵ تست
.venv/bin/python scripts/generate_er_diagrams.py   # بازتولید ERD از Metadata
.venv/bin/python scripts/pg_server.py stop|status
```

> سرور Embedded (pgserver/pg_ctl) روی Unix-Socket داخل `database/pgdata` اجرا می‌شود — **بدون نیاز به root/Docker** در این محیط؛ در Docker Production از `postgres:16` رسمی استفاده می‌شود (ADR-0011). `pg_trgm` برای این بیلد از سورس ۱۶.۲ کامپایل و در `pginstall` نصب شد (اسکریپت‌سازی‌شده در worklog؛ در Image رسمی Docker موجود است).

---

## ۲) قواعد ساختاری (Structural Rules)

| موضوع | قاعده | دلیل |
|---|---|---|
| PK | `BIGINT IDENTITY ALWAYS` | ۸ بایت،درج ترتیبی = ایندکس B-Tree فشرده؛ AUTOINCREMENT اجباری (سطح DB) | 
| شناسه کسب‌وکار | `code` یکتا با فرمت regex (`BH-`/`ORD-`/`INV-`/`PAY-`/`TKT-`/`SKU-`) | قابل ارجاع انسانی + CHECK فرمت |
| زمان | `TIMESTAMPTZ` + `server_default now()` | TZ-safe |
| پول | `BIGINT` (تومان صحیح) | بدون ممیز؛ ریاضی با CHECK قفل شده |
| نسبت/اعتماد | `NUMERIC(4,3)` با `CHECK 0..1` | دقت ثابت |
| وضعیت‌ها | `VARCHAR + CHECK IN (...)` — **نه ENUM پستگرس** | افزودن مقدار = Migration ساده بدون `ALTER TYPE` غیرتراکنشی (ED-51) |
| Payload | `JSONB` (predictions، quality، explainability، snapshotها) | اسکیما-منعطف برای داده توصیفی |
| `updated_at` | تریگر `set_updated_at` — سطح DB | حتی UPDATE خام SQL هم درست می‌ماند |
| Timestamps | `created_at` server_default؛ `submitted_at`/`decided_at`/… رویدادمحور | — |
| Privacy | `password_hash`، `national_id_hash` (هش)، IP به‌صورت `INET` | هیچ plaintext حساس |

**Naming Convention** (یکسان برای همه آبجکت‌ها — خروجی Alembic قابل‌پیش‌بینی):
`pk_<table>` · `fk_<table>_<col>_<reftable>` · `uq_<table>_<col>` · `ck_<table>_<rule>` · `ix_<table>_<col>`

---

## ۳) کاتالوگ ۴۹ جدول به تفکیک Context

نمادها: **SD**=Soft-Delete · **AO**=Append-Only (ترایگر ممنوعیت UPDATE/DELETE) · **V**=Versioning/History · **bold**=Entity اصلیِ درخواستی مشخصات §47

| Context | جدول | نوع | SD | AO | V | نکته کلیدی |
|---|---|---|:--:|:--:|:--:|---|
| **identity** | **users** | اصلی | ✓ | — | — | تلفن/ایمیل Unique **جزئی** (آزاد پس از Soft-Delete)؛ قفل Brute-force |
| | **roles** | اصلی | ✓ | — | — | ۶ نقش سیستمی؛ `code` CHECK دامنه |
| | **permissions** | اصلی | — | — | — | ۳۱ دسترسی |
| | role_permissions | پشتیبان | — | — | — | PK مرکب؛ CASCADE |
| | refresh_tokens | پشتیبان | — | — | — | چرخشی + زنجیره `replaced_by` (کشف Replay) |
| **patients** | **patient_profiles** | اصلی | (تابع user) | — | — | ۱:۱ با user؛ mizaj denormalized |
| | **addresses** | اصلی | ✓ | — | — | یک Default فعال per user (Unique جزئی) |
| | **contact_logs** | اصلی | — | — | — | کانال/جهت/نتیجه تماس (ED-52) |
| | **questionnaires** | اصلی | ✓ | — | ✓ | فقط **یک نسخه فعال** (Unique جزئی) |
| | **questions** | پشتیبان | — | — | — | نسخه‌دار؛ `UNIQUE(questionnaire, position)` |
| | question_options | پشتیبان | — | — | — | امتیاز + بُعد مزاج |
| | questionnaire_responses | پشتیبان | — | ✓ | ✓ | تاریخچه مِزاج **هرگز حذف نمی‌شود** (§7 مشخصات) |
| | **answers** | اصلی | — | — | — | نرمال‌شده (ED-55)؛ `UNIQUE(response, question)` |
| | **referrals** | اصلی | — | — | ✓ | نرخ پورسانت Snapshot |
| **medical_records** | **images** | اصلی | ✓ | — | ✓ | ۴ واریانت + SHA-256 + کیفیت JSONB + Dedup |
| **ai** | **ai_models** | اصلی | — | — | ✓ | رجیستری + شجره Dataset/Approval |
| | **ai_analyses** | اصلی | — | — | ✓ | هر Prediction با model/dataset/preprocessing/threshold (§61) |
| | **datasets** | اصلی | ✓ | — | — | — |
| | **dataset_versions** | اصلی | — | — | ✓ | Split **Patient-Level** (§63 ضد Leakage) |
| | dataset_items | پشتیبان | — | — | — | Label/Disagreement/Outcome (§12/§82/§83) |
| **clinical_review** | **medical_files** | اصلی | ✓ | — | ✓ | Aggregate پرونده؛ ۲۱ وضعیت؛ `reassessment_of` (ED-13) |
| | case_events | پشتیبان | — | ✓ | ✓ | تایم‌لاین بیمار (ED-32) |
| | **diseases** | اصلی | ✓ | — | — | کاتالوگ + trgm search |
| | **diagnoses** | اصلی | — | — | ✓ | موافقت/اختلاف با AI |
| | **expert_reviews** | اصلی | — | — | ✓ | دلسپاری به مستند (ED-53) — کارشناس ۱ و ۲ |
| | **doctor_reviews** | اصلی | — | — | ✓ | دروازه پزشک (ED-03) |
| | **follow_ups** | اصلی | ✓ | — | — | Outcome برای Dataset (§82) |
| **products** | **products** | اصلی | ✓ | — | — | `is_otc` XOR `requires_prescription` |
| | **product_price_history** | اصلی | **AO** | — | ✓ | «هیچ قیمت قدیمی از بین نرود» (§15) |
| | **inventories** | اصلی | — | — | — | ۱:۱؛ `reserved ≤ on_hand` |
| | inventory_movements | پشتیبان | **AO** | — | ✓ | دفتر خبری علامت‌دار + `balance_after` |
| | disease_products | پشتیبان | — | — | — | Junction؛ سمت Disease = Soft-Ref |
| **prescriptions** | **prescriptions** | اصلی | ✓ | — | ✓ | زنجیره Supersede + `UNIQUE(file, version)` |
| | **prescription_items** | اصلی | — | — | — | XOR available/missing (ED-06) |
| **commerce** | **carts** | اصلی | — | — | — | یک سبد ACTIVE per user (Unique جزئی) |
| | cart_items | پشتیبان | — | — | — | قیمت Snapshot |
| | **orders** | اصلی | ✓ | — | — | **ریاضی پول CHECK** `total = subtotal − discount + shipping` |
| | **order_items** | اصلی | — | — | — | `line_total = unit_price × quantity` |
| | **invoices** | اصلی | — | — | ✓ | پیش‌فاکتور؛ بدون حذف (ED-49) |
| **payments** | **payments** | اصلی | — | — | — | Idempotency چهارگانه + Evidence-based PAID |
| **shipping** | **shipments** | اصلی | — | — | — | ۱:۱ با Order (ED-33)؛ DELIVERED مستند |
| **notifications** | **notifications** | اصلی | — | — | — | ایندکس جزئی Unread — صندوق ورودی |
| | **sms_logs** | اصلی | **AO** | — | — | حسابرسی ارسال |
| **tickets** | **tickets** | اصلی | ✓ | — | — | SLA (first_response/resolved/closed) |
| | **ticket_messages** | اصلی | — | **AO** | — | یادداشت داخلی جدا |
| **finance** | **financial_transactions** | اصلی | **AO** | — | ✓ | اصلاح = قلم معکوس (ED-50) |
| | **expenses** | اصلی | — | — | — | گردش کار تأیید |
| **administration** | **audit_logs** | اصلی | **AO** | — | — | جریان رویداد فرا-Context (ED-32) — غیرقابل جعل |
| **reporting** | daily_revenue | Read-Model | — | — | — | CQRS-lite — فقط Worker می‌نویسد |

> شمارش: ۱۵ Context · ۴۰ Entity اصلی (تمام لیست مشخصات §47 + Cart) · ۹ جدول پشتیبان · جمع ۴۹.

### ۳.۱ نگاشت Entityهای درخواستی کاربر → جداول

`User→users` · `Role→roles` · `Permission→permissions` · `PatientProfile→patient_profiles` · `Address→addresses` · `Questionnaire→questionnaires` · `Question→questions` · `Answer→answers` (+ `question_options`/`questionnaire_responses` پشتیبان) · `MedicalFile→medical_files` · `Image→images` · `AIAnalysis→ai_analyses` · `Disease→diseases` · `Diagnosis→diagnoses` · `Prescription→prescriptions` · `PrescriptionItem→prescription_items` · `Product→products` · `ProductPriceHistory→product_price_history` · `Inventory→inventories` (+`inventory_movements`) · `Cart→carts` (+`cart_items`) · `Order→orders` · `OrderItem→order_items` · `Invoice→invoices` · `Payment→payments` · `Shipment→shipments` · `Ticket→tickets` · `TicketMessage→ticket_messages` · `Notification→notifications` · `FollowUp→follow_ups` · `Referral→referrals` · `AuditLog→audit_logs` · `Expense→expenses` · `FinancialTransaction→financial_transactions` · `SMSLog→sms_logs` · `ContactLog→contact_logs` · `Dataset→datasets` · `DatasetVersion→dataset_versions` (+`dataset_items`) · `AIModel→ai_models` · `ExpertReview→expert_reviews` · `DoctorReview→doctor_reviews` — **پوشش ۴۰/۴۰** ✓

---

## ۴) FK واقعی درون-Context در برابر Soft-Reference بین-Context (D4)

**قاعده (ADR-0004):** هر جدول دقیقاً به یک Context تعلق دارد؛ FK فیزیکی فقط درون یک Schema؛ ارجاع Cross-Context = **Soft Reference** (`BIGINT` + ایندکس، بدون Constraint) که اعتبارش در لایه Facade اپ + تست یکپارچگی تضمین می‌شود. تست `test_no_cross_schema_foreign_keys` این را روی کاتالوگ زنده اثبات می‌کند.

### ۴.۱ نقشه Soft-Referenceها (خروجی اسکریپت ERD — `master-context-map.png`)

| مبدأ → مقصد | ستون‌ها (نمونه) |
|---|---|
| تقریباً همه → **identity** | `user_id`، `patient_user_id`، `expert_user_id`، `actor_user_id`، … |
| clinical_review → ai / medical_records / prescriptions / patients | `current_ai_analysis_id`، `questionnaire_response_id` (+ `image_id` از طریق images) |
| ai → medical_records / identity | `image_id`، `patient_ref_id` |
| prescriptions → clinical_review / products | `medical_file_id`، `product_id` |
| commerce → identity / products / prescriptions / patients | `user_id`، `product_id`، `prescription_id`، `address_id` |
| payments → commerce / medical_records / identity | `invoice_id`، `order_id`، `receipt_image_id` |
| shipping → commerce / medical_records | `order_id` (UNIQUE)، `proof_image_id` |
| notifications / tickets / finance → … | `user_id`، `medical_file_id`، `order_id`، `payment_id` |
| products → clinical_review | `disease_products.disease_id` |

هر ستون Soft-Ref **ایندکس‌دار** است (تست §۱۱) و در ERD با برچسب `soft` مشخص شده.

### ۴.۲ سیاست‌های ON DELETE (نمونه‌های کلیدی)

| رابطه | رفتار | دلیل |
|---|---|---|
| `case_events → medical_files` | CASCADE | تایم‌لاین بدون پرونده بی‌معناست (و پرونده اصلاً Hard-Delete نمی‌شود) |
| `refresh_tokens → users` | CASCADE | Session بدون کاربر بی‌معناست |
| `product_price_history → products` | **RESTRICT** | قیمت‌ها باید از حذف محصول هم جان به در ببرند (§15) |
| `inventories`/`inventory_movements → products` | **RESTRICT** | دفتر انبار تقدیم ندارد |
| `answers → questions`/`question_options` | **RESTRICT** | تاریخچه پاسخ محفوظ بماند |
| `prescriptions → prescriptions` (supersede) | SET NULL | زنجیره نسخه |
| `medical_files → medical_files` (reassessment) | SET NULL | نسب پرونده |

---

## ۵) قواعد کسب‌وکار قفل‌شده در سطح Database (نمونه‌های کلیدی از ۱۶۷ Check)

| قاعده | Constraint | مشخصات |
|---|---|---|
| ریاضی سفارش | `total = subtotal − discount + shipping_cost` و `discount ≤ subtotal` و غیرمنفی‌ها | §79 (Race-safe) |
| ریاضی قلم | `line_total = unit_price × quantity` | §79 |
| پرداخت مثبت | `amount > 0` | — |
| PAID مستند | `paid_at NOT NULL ∧ (ref_number ∨ tracking_code)` | §33 |
| AWAITING_VERIFY فقط کارت‌به‌کارت با رسید | `method='CARD_TO_CARD' ∧ receipt_image_id NOT NULL` | §34 |
| Idempotency | Unique جزئی روی `authority`/`ref_number`/`idempotency_key`/`receipt_image_id` | §79 |
| انضباط علامت انبار | `STOCK_IN/RESERVE/RETURN → q>0`، `STOCK_OUT/RELEASE/DAMAGE → q<0`، `ADJUSTMENT ≠ 0` | ED-54 |
| موجودی | `reserved ≤ on_hand`؛ `balance_after ≥ 0` | ED-54 |
| XOR نسخه‌دار | `is_available ≠ is_missing` | ED-06 |
| OTC انحصار | `NOT (is_otc ∧ requires_prescription)` | §64/§66 |
| اختلاف Dataset | دو Label کارشناس بدون Label نهایی ⇒ `has_disagreement` اجباری | §12 |
| نسخه Superseded | `status='SUPERSEDED' ⇒ superseded_by NOT NULL` | §16 |
| تایید نسخه | `APPROVED ⇒ approved_by ∧ approved_at` | §16 |
| پرونده بسته/لغو | `CLOSED ⇒ closed_at`؛ `CANCELLED ⇒ reason` | §17 |
| تصویر رد‌شده | `REJECTED ⇒ rejection_reason` | §8 |
| فشرده‌سازی | `size_compressed ≤ size_original` | §8 |
| شماره موبایل | regex `^\+?[0-9]{10,15}$` | §6 |
| کدپستی | `^[0-9]{10}$` | §6 |
| فرمت کدها | `^ORD-…`/`^INV-…`/`^PAY-…`/`^TKT-…`/`^BH-…`/`^SKU-…` | §47 |
| اعتماد AI | `0 ≤ confidence ≤ 1` | §61 |
| مالی | `amount > 0`؛ `occurred_at ≤ now()`؛ `incurred_date ≤ today` | §39 |
| اختصاصی کارشناس ۲ | `availability فقط برای stage='EXPERT_2'` | §28-§31 |
| گزارش روزانه | `net = gross − refunds` | §8.3 ARCH |

---

## ۶) ممنوعیت جعل رویدادها 

سه تابع در `administration` + ۴۴ تریگر (Migration 0003):

| تابع | رفتار | جداول |
|---|---|---|
| `set_updated_at()` | `updated_at = now()` روی هر UPDATE | ۲۳ جدول |
| `forbid_mutation()` | UPDATE/DELETE ⇒ `check_violation` | **۸ جدول Append-Only** |
| `forbid_hard_delete()` | DELETE ⇒ `check_violation` | **۱۳ جدول Soft-Delete** |

---

## ۷) Soft Delete — سیاست دو لایه (§48 مشخصات)

1. **لایه داده:** ستون `deleted_at` (+ وضعیت `is_active` جایی که معنا دارد) روی ۱۳ جدول دامنه‌ای.
2. **لایه موتور:** تریگر `forbid_hard_delete` — حتی DBA هم نمی‌تواند `DELETE` بزند؛ Cascadeهای فرزند نیز مسدودند (fail-safe ساختاری).
3. **ابزار/تست:** `TRUNCATE … RESTART IDENTITY CASCADE` مسیر مجاز پاک‌سازی تست است (row-trigger را دور می‌زند)؛ نقش‌های Production نباید مجوز TRUNCATE داشته باشند.

**Unique جزئی برای حریم خصوصی:** `phone`/`email` پس از Soft-Delete آزاد می‌شوند (`WHERE deleted_at IS NULL`)؛ `referral_code` و کدهای کسب‌وکار هرگز آزاد نمی‌شوند (Unique سراسری).

> مستثنی‌های عمدی (ED-49): رکوردهای **مالی/حقوقی** (`payments`، `invoices`، `expenses`) و **ثبت‌های علمی** (`ai_analyses`) هیچ‌گاه حذف نمی‌شوند — حتی نرم؛ چرخه حیات فقط از طریق `status`. این قوی‌تر از Soft-Delete است و تعهد «قابل حسابرسی» را کامل می‌کند.

---

## ۸) History و Versioning — سطوح

| سطح | سازوکار | جداول/ستون‌ها |
|---|---|---|
| **Append-Only مطلق** (۸ جدول) | تریگر ممنوعیت Mutation | `audit_logs` · `product_price_history` · `inventory_movements` · `questionnaire_responses` · `case_events` · `sms_logs` · `ticket_messages` · `financial_transactions` |
| **Versioning ردیفی** | ردیف جدید + زنجیره | `prescriptions(version, superseded_by)` · `questionnaires(version)` · `dataset_versions(version)` · `images.version` |
| **Ledger با تراز** | `balance_after` + علامت | `inventory_movements` |
| **Snapshot** (بدون وابستگی به زمان) | JSONB منجمد | `orders.address_snapshot` · `invoices.items_snapshot` · `order_items.name/sku/price` · `prescription_items.drug_name/unit_price` · `medical_files.mizaj_snapshot` |
| **اصلاح مالی** | قلم معکوس، نه UPDATE | `financial_transactions(txn_type='ADJUSTMENT')` (ED-50) |
| **شجره علمی** | FK نرم + RESTRICT | `ai_models.training_dataset_version_id` · `ai_analyses(model,dataset,preprocessing,threshold)` |

---

## ۹) ایندکس‌های Performance (۱۹۰ ایندکس — ۱۴۰+ B-Tree / ۴۱ Partial / ۴ BRIN / ۴ GIN-trgm)

### ۹.۱ الگوهای طراحی و Rationale

| الگو | مثال | چرا |
|---|---|---|
| **Partial Queue** | `ix_medical_files_status WHERE deleted_at IS NULL` · `ix_medical_files_expert1_queue(assigned_expert1, status) WHERE … IS NOT NULL AND deleted_at IS NULL` | صف کارشناسان فقط فایل‌های زنده را می‌بیند؛ ایندکس کوچک و داغ |
| **Partial Uniqueness** | `uq_carts_active_per_user WHERE status='ACTIVE'` · `uq_questionnaires_single_active WHERE is_active` · `uq_users_phone_active WHERE deleted_at IS NULL` | قید کسب‌وکار که فقط روی زیرمجموعه‌ای معنا دارد |
| **Composite (col, time DESC)** | `ix_orders_user_time` · `ix_case_events_file_time` · `ix_notifications_user_time` | الگوی «آخرین N موردِ کاربر» — پوشش Filter+Sort هم‌زمان |
| **Due-Scan** | `ix_follow_ups_due_scan(status, due_date)` | کوئری DueToday/Overdue — تست EXPLAIN دارد |
| **Low-Stock** | `ix_inventories_low_stock WHERE quantity_on_hand <= reorder_level` | گزارش کسری فقط روی ردیف‌های مشکل‌دار |
| **BRIN** روی جریان‌های Append-Only | `brin_audit_logs_created_at` · `brin_case_events_created_at` · `brin_sms_logs_created_at` · `brin_financial_txns_occurred_at` | رشد یکنواخت زمانی → ایندکس چند-کیلوبایتی، اسکن بازه‌ای ارزان |
| **GIN trgm** | `ix_products_name_fa_trgm` / `name_en` · `ix_diseases_name_*` | جستجوی فازی فارسی/انگلیسی (متن نرمال‌شده ی/ک) — §67 |
| **Soft-Ref backing** | `ix_payments_order` · `ix_images_medical_file` · … | هر ارجاع نرم بین-Context ایندکس‌دار (جبران نبود FK) |

### ۹.۲ تأیید EXPLAIN (تست‌شده)

نمونه‌هایی که تست `test_indexes_performance.py` با `enable_seqscan=off` اثبات می‌کند از ایندکس هدف استفاده می‌کنند: صف کارشناس ۱ · ایندکس صف پزشک · ایندکس Unread · اسکن سررسید پیگیری · تایم‌لاین پرونده · سفارش‌های کاربر · جستجوی trgm (Bitmap GIN) · ارجاع‌های نرم. (در حجم‌های واقعی، planner طبعاً مسیر بهینه را برمی‌گزیند.)

---

## ۱۰) Alembic — Migrations

| Revision | عنوان | محتوا |
|---|---|---|
| `0001` | create bounded-context schemas + pg_trgm | ۱۵ `CREATE SCHEMA` + `CREATE EXTENSION pg_trgm` |
| `0e862845eba8` | all 49 tables | ۴۹ `create_table` + ۱۱۸ ایندکس/Unique/Check (autogen + بازبینی) |
| `0003` | db-level guards | ۳ تابع + ۴۴ تریگر |
| `4e4b217705f9` | server defaults | DEFAULT های سطح DB برای وضعیت/بولین/شمارنده |

- `env.py`: URL از `PGDATABASE_URL` یا `.pgurl`؛ `include_schemas` + فیلتر ۱۵ Context؛ `compare_type` + `compare_server_default`؛ `version_table` در `public`.
- `alembic check` = **صفر Drift** (اجرای مستمر در CI پیشنهادی).
- **Expand-Contract** برای تغییرات Breaking (ADR-0011): ستون جدید → بک‌فیل → مهاجرت کد → حذف ستون قدیمی در ریویژن بعدی.
- تست چرخه کامل: `downgrade base → upgrade head` بازیابی کامل قرارداد (۴۹ جدول + ۴۴ تریگر + دیفالت‌ها).

---

## ۱۱) تست‌ها — ۸۵/۸۵ PASS

| فایل | پوشش |
|---|---|
| `test_schema_structure.py` | ۱۵ Schema · ۴۹ جدول · PK/IDENTITY همه · **صفر FK بین-Schema** · قواعد Cascade/Restrict · کاتالوگ Unique/Check · سیم‌کشی ۴۴ تریگر |
| `test_constraints.py` | ردّ داده نامعتبر: تلفن/نقش/زبان · تلفن تکراری فعال · ریاضی سفارش/قلم · تخفیف · پرداخت صفر/بی‌مستند · Idempotency تکراری · علامت انبار · XOR نسخه · OTC · اطمینان AI · تصویر رد/فشرده · مالی آینده/غیرمثبت · پرسشنامه فعال تکراری · پاسخ تکراری/بعد نامعتبر |
| `test_soft_delete_history.py` | ممنوعیت Hard-Delete (۳ جدول) · آزادسازی تلفن · Auto-bump `updated_at` · تغییرناپذیری ۸ جدول Append-Only · زنجیره Supersede · نسخه پرسشنامه · Dataset Patient-Level + Disagreement · Dedup تصویر |
| `test_indexes_performance.py` | وجود ۳۴ ایندکس حیاتی · ۴ BRIN · ۴ trgm GIN · Partial با WHERE صحیح · EXPLAIN مسیرهای داغ · Soft-Ref ایندکس‌دار |
| `test_migrations.py` | زنجیره خطی/تک‌Head · `alembic check` صفر Drift · **چرخه کامل down/up** · ریست Sequence |

اجرای تست‌ها فقط از مسیر Alembic پروویژن می‌شود (`conftest`) — یعنی Migrationها همیشه تست‌شده‌اند، نه `create_all`.

---

## ۱۲) عملیات (Ops)

- **اتصال‌ها:** dev/test روی Socket محلی (`.pgurl`)؛ Production: `PGDATABASE_URL` از Secret (۱۲-Factor؛ هیچ Connection String در Git).
- **بکاپ (§49 مشخصات):** `pg_dump -Fc` روزانه + WAL Archiving در فاز Deployment؛ تست Restore فصلی (ADR-0011).
- **نگهداشت:** `VACUUM/ANALYZE` خودکار؛ جداول Append-Only با BRIN و Partitions آینده (اگر > ۱۰M ردیف شد؛ ED-58).
- **قابلیت Multi-Tenant (§68):** تک‌سازمان فعلی؛ طراحی آماده: افزودن `tenant_id BIGINT` + PostgreSQL **RLS** یک Migration Expand است — PKهای BIGINT و Soft-Refها مانعی ایجاد نمی‌کنند (ED-48).

---

## ۱۳) Engineering Decisions این فاز (ED-47..58)

| ED | پرسش | تصمیم | مبنا |
|---|---|---|---|
| ED-47 | ابزار DDL؟ | **Alembic (SQLAlchemy)** مرجع یکتای Schema؛ Prisma در فاز بعد فقط Introspect می‌کند (`db pull`) — جایگزینی جزئی ابزار ADR-0004 | فرمان صریح PHASE 04 + Python AI-Service در معماری | ADR-0013 |
| ED-48 | نوع PK؟ | `BIGINT IDENTITY` (نه UUID) — ایندکس فشرده/درج ترتیبی؛ Multi-Tenant آینده با `tenant_id`+RLS نه UUID سراسری | §68 + Performance |
| ED-49 | Soft-Delete برای همه؟ | دامنه‌ای‌ها ✓؛ رکوردهای مالی/حقوقی/علمی (payments/invoices/expenses/ai_analyses) **بدون هیچ حذفی** — فقط status | قوی‌تر از §48؛ حسابرسی |
| ED-50 | اصلاح رکورد مالی؟ | قلم معکوس `ADJUSTMENT` در Ledger Append-Only — هرگز UPDATE | استاندارد حسابداری دوجهتی |
| ED-51 | ENUM پستگرس؟ | نه — `VARCHAR+CHECK`؛ افزودن مقدار = Migration عادی قابل Rollback | تجربه ALTER TYPE |
| ED-52 | ContactLog کجا؟ | Context `patients`؛ کانال/جهت/نتیجه + Soft-Ref تیکت/پرونده | §47 بدون تعیین جا |
| ED-53 | بازبینی‌ها مستقل؟ | `expert_reviews`/`doctor_reviews` مستقل از Prescription/Case — سابقه تصمیم حفظ شود | فرمان Entity مستقل PHASE 04 |
| ED-54 | Inventory؟ | جدول ۱:۱ + `inventory_movements` دفتر خبری (علامت + `balance_after`)؛ `product.stock` حذف شد — منبع حقیقت Ledger | فرمان PHASE 04 + §14 |
| ED-55 | Answer نرمال؟ | بله — جدول `answers` به‌جای JSON (SQLite قدیم)؛ UNIQUE(response,question) | «Database را Normalize کن» §47 |
| ED-56 | FK بین-Context؟ | ممنوع فیزیکی — Soft-Ref ایندکس‌دار + تست کاتالوگ | ADR-0004/D4 |
| ED-57 | جستجوی فارسی؟ | GIN-trgm روی متن نرمال‌شده (نه FTS کامل) — تا نیاز واقعی | §67 (سادگی تا نیاز) |
| ED-58 | جداول بزرگ؟ | BRIN الان؛ Partitions هنگام >۱۰M ردیف (audit/event) | مقیاس‌پذیری قاعده ۱۵ |

---

## ۱۴) بدهی فنی و گام‌های بعدی

| مورد | توضیح | فاز هدف |
|---|---|---|
| سوئیچ اپ به PostgreSQL | تغییر `datasource` Prisma + `db pull` + انتقال Seed (§8.4 ARCH) | فاز بعدی |
| Role کمکی DB | کاربر غیر-superuser با مجوزهای حداقلی برای web/worker | فاز Security |
| Partitioning | `audit_logs`/`case_events` هنگام رشد | آینده (ED-58) |
| Seed مرجع | Seed ۶ نقش/۳۱ دسترسی به‌صورت Migration Data | فاز بعدی |
| CI | اجرای `alembic check` + pytest در Pipeline | فاز CI/CD |
