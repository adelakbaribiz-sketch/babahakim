# ADR — Architecture Decision Records (BabaHakim)

این پوشه، منبع رسمی **تصمیمات معماری** BabaHakim است. هر ADR (Architecture Decision Record) یک تصمیم غیرقابل‌برگشت-آسان، زمینه آن، گزینه‌های بررسی‌شده و پیامدها را ثبت می‌کند.

## قواعد

1. هر تصمیم معماری **قبل از پیاده‌سازی** ثبت می‌شود (قاعده ۱۱ منشور).
2. ADRها **Append-only** هستند: تغییر تصمیم = ADR جدید با ارجاع به ADR قبلی و وضعیت `Superseded` روی قدیمی.
3. هر ADR یک معادل ED دارد در `docs/BUSINESS-RULES.md` (زنجیره تصمیمات محصول + معماری یکپارچه می‌ماند).
4. وضعیت‌های مجاز: `Accepted` · `Proposed` · `Superseded by ADR-XXXX` · `Deprecated`.

## فهرست ADRها

| ADR | عنوان | وضعیت | معادل ED | موضوع کوتاه |
|---|---|---|---|---|
| [ADR-0001](./ADR-0001-modular-monolith.md) | Modular Monolith بر Microservices ترجیح داده می‌شود | Accepted | ED-35 | تصمیم بنیادین معماری + ۵ قاعده Extraction-Readiness |
| [ADR-0002](./ADR-0002-bounded-contexts-dependency-tiers.md) | ۱۵ Bounded Context + مدل Tier وابستگی | Accepted | ED-36 | مرزبندی دامنه + ۸ قاعده وابستگی D1..D8 |
| [ADR-0003](./ADR-0003-single-nextjs-app-web-backend.md) | یک Deployable برای Frontend+Backend (Next.js) | Accepted | ED-37 | App Router + Route Handlers نازک + worker جدا |
| [ADR-0004](./ADR-0004-postgresql-schema-per-context.md) | PostgreSQL + Prisma + Schema به ازای Context | Accepted | ED-38 | تک‌مالکیتی داده + مسیر SQLite→Postgres |
| [ADR-0005](./ADR-0005-redis-cache-queue-bullmq.md) | Redis برای Cache و Queue (BullMQ) | Accepted | ED-39 | دو نقش Redis + DLQ + Idempotency |
| [ADR-0006](./ADR-0006-s3-object-storage-signed-urls.md) | Object Storage سازگار S3 + Signed URL | Accepted | ED-40 | حریم تصاویر پزشکی + Port ObjectStorage |
| [ADR-0007](./ADR-0007-ai-service-isolation.md) | جداسازی AI Service پشت Port | Accepted | ED-41 | AIModelProvider + کاندیدای اول Extraction |
| [ADR-0008](./ADR-0008-domain-events-cross-context.md) | رویداد دامنه‌ای برای ارتباط Cross-Context | Accepted | ED-42 | Event Bus + کاتالوگ رویدادها + تقسیم Sync/Async |
| [ADR-0009](./ADR-0009-ports-adapters-payment-shipping.md) | Ports & Adapters برای Payment/Shipping | Accepted | ED-43 | PaymentGateway + ShippingProvider + زرین‌پال |
| [ADR-0010](./ADR-0010-architecture-enforcement-ci.md) | اجرای قواعد معماری در CI | Accepted | ED-44 | ESLint + dependency-cruiser + architecture.test |
| [ADR-0011](./ADR-0011-deployment-topology.md) | توپولوژی استقرار (Compose/Prod) | Accepted | ED-45 | web/worker/postgres/redis/minio/ai/caddy |
| [ADR-0012](./ADR-0012-observability.md) | Observability ساخت‌یافته | Accepted | ED-46 | JSON logging + metrics + correlationId + OTel-ready |
| [ADR-0013](./ADR-0013-alembic-ddl-source-of-truth.md) | Alembic مرجع یکتای DDL — Prisma فقط Introspection | Accepted | ED-47 | Supersede جزئی ADR-0004 (ابزار Migration) |
| [ADR-0014](./ADR-0014-security-middleware-layer.md) | لایه اجرای امنیت: Middleware سراسری (Origin+CSRF) + Guardهای مسیر | Accepted | ED-59..62 | پوشش CSRF/Origin بدون بازنویسی ۳۰+ مسیر |
| [ADR-0015](./ADR-0015-privacy-data-rights.md) | حقوق داده شخصی: Consent نسخه‌دار + Export + حذف از طریق Anonymization | Accepted | ED-67..70 | سازگاری حق فراموشی با تعهد مالی ED-49 |

## ساختار هر ADR

قالب استاندارد در [`_TEMPLATE.md`](./_TEMPLATE.md): **Context → Options → Decision → Consequences → Compliance (چگونه قاعده Enforce می‌شود)**.

هر ADR الزاماً بخش **Compliance** دارد — چون طبق منشور پروژه (قاعده ۲) «هر قاعده باید قابل Test باشد»، تصمیمی که نتوان در CI/تست اعتبارسنجی کرد، ADR نیست؛ فقط آرزوست.
