# BabaHakim — ERD | نمودار ارتباط موجودیت‌ها (PHASE 04)

> منبع تولید: `database/models/` (SQLAlchemy Metadata) — اسکریپت: `database/scripts/generate_er_diagrams.py`. نمادها: `PK` کلید اصلی، `FK` کلید خارجی واقعی (درون-Context)، `UK` یکتا. روابط بین-Context طبق ADR-0004/D4 **Soft Reference** هستند (بدون FK فیزیکی).


## ۱) نمای کلان Contextها و ارجاع‌های بین-Context (D4)

![master-context-map](erds/master-context-map.png)

هر یال = تعداد ستون‌های Soft Reference از Context مبدأ به Context مقصد (بدون FK فیزیکی — اعتبارسنجی در لایه Facade + تست یکپارچگی).


## ۲) ERD مسیر طلایی (موجودیت‌های هسته، بین-Context)

![master-golden-path](erds/master-golden-path.png)

مسیر ۱۷-مرحله‌ای بیمار روی هسته داده: `users → medical_files → ai_analyses → prescriptions → orders → invoices → payments → shipments → follow_ups`. برچسب «soft» = مرجع نرم بین-Context.


## ۳) ERD به‌ازای هر Bounded Context (روابط FK واقعی)

### Context «administration» — مدیریت و حسابرسی (1 جدول)

![context-administration](erds/context-administration.png)

### Context «ai» — هوش مصنوعی (5 جدول)

![context-ai](erds/context-ai.png)

### Context «clinical_review» — بازبینی بالینی (7 جدول)

![context-clinical_review](erds/context-clinical_review.png)

### Context «commerce» — فروش و سفارش (5 جدول)

![context-commerce](erds/context-commerce.png)

### Context «finance» — مالی (2 جدول)

![context-finance](erds/context-finance.png)

### Context «identity» — هویت و دسترسی (5 جدول)

![context-identity](erds/context-identity.png)

### Context «medical_records» — پرونده پزشکی (1 جدول)

![context-medical_records](erds/context-medical_records.png)

### Context «notifications» — اعلان‌ها (2 جدول)

![context-notifications](erds/context-notifications.png)

### Context «patients» — بیمار و پرسشنامه (9 جدول)

![context-patients](erds/context-patients.png)

### Context «payments» — پرداخت (1 جدول)

![context-payments](erds/context-payments.png)

### Context «prescriptions» — نسخه‌ها (2 جدول)

![context-prescriptions](erds/context-prescriptions.png)

### Context «products» — محصولات و انبار (5 جدول)

![context-products](erds/context-products.png)

### Context «reporting» — گزارش‌ها (Read Model) (1 جدول)

![context-reporting](erds/context-reporting.png)

### Context «shipping» — ارسال (1 جدول)

![context-shipping](erds/context-shipping.png)

### Context «tickets» — پشتیبانی (2 جدول)

![context-tickets](erds/context-tickets.png)
