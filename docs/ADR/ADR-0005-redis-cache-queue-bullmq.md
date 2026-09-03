# ADR-0005: Redis برای Cache و Queue (BullMQ)

| فیلد | مقدار |
|---|---|
| شماره | ADR-0005 |
| وضعیت | Accepted |
| تاریخ | 1405/06/14 (2026-09-04) |
| فاز تصمیم | PHASE 03 — System Architecture |
| معادل ED | ED-39 |
| اسناد مرتبط | `ARCHITECTURE.md §3, §7` · `ARCHITECTURE-DIAGRAM.md §9, §11` · ADR-0008 |

## Context

معماری هدف به دو قابلیت زیرساختی نیاز دارد که در کد فعلی نیستند:
1. **Queue/Worker** — تحلیل AI، ارسال اعلان، تایمر SLA (ED-08)، تجمیع گزارش، Retry پرداخت؛ حال حاضر همه Sync در request اجرا می‌شوند.
2. **Cache** — RBAC matrix، تنظیمات (ConfigService)، کاتالوگ پرخوانش + شمارنده Rate Limiting (فاز Hardening).

همچنین Delayed Jobs لازم است: انقضای Proforma (ED-30، ۷ روز)، پیگیری‌ها، یادآورهای SLA.

## Options

| گزینه | مزایا | معایب |
|---|---|---|
| **A) Redis + BullMQ** (یک Redis، دو نقش) | Delayed Job و Rate-limit بومی؛ اکوسیستم JS بالغ؛ یک زیرساخت برای دو نیاز | Redis باید Backup/مدیریت شود؛ persistence صف فقط AOF |
| **B) RabbitMQ + Redis-cache جدا** | Queue تخصصی قوی | دو زیرساخت؛ Docker-compose سنگین‌تر؛ Delayed Job پله‌ای (DLX) پیچیده |
| **C) Kafka** | Replay/Ordering قوی | Overkill؛ Ops سنگین؛ تیم کوچک (C1) |
| **D) pg-boss (Postgres queue)** | بدون زیرساخت جدید | Polling روی DB اصلی؛ فشار بر OLTP |

## Decision

**Redis 7 به‌صورت دوتایی استفاده می‌شود: Cache و Queue — با BullMQ به‌عنوان کتابخانه Queue.**

- **کاربردهای Cache:** RBAC matrix (کلید `rbac:{role}`، TTL با Event ابطال)، تنظیمات ConfigService، نتایج Catalog پرخوانش، شمارنده Rate Limit (فاز بعد).
- **Queueها به ازای Consumer:** `ai.analyze` (concurrency پایین، CPU/GPU-bound)، `notify.dispatch` (concurrency بالا)، `sla.check` (periodic)، `reporting.aggregate` (periodic)، `payment.verify-retry`.
- **Delayed Jobs:** انقضای Proforma، سررسید FollowUp، یادآورهای SLA.
- **DLQ:** صف `events.dlq` پس از N=5 Retry؛ هشدار Observability (ADR-0012) روی غیر-خالی بودن DLQ.
- **قرارداد پیام** از ADR-0008: `{ id, name, occurredAt, context, payload, correlationId }` + تحویل At-least-once ⇒ Consumerها Idempotent (کلید `eventId`).

## Consequences

**مثبت:**
- یک زیرساخت کم‌قطعه (C1) برای دو نیاز؛ Delayed Job بومی برای ED-08/ED-30.
- Worker جدا ⇒ Long-runningها از Event Loop وب خارج می‌شوند (تکمیل ADR-0003).

**منفی/هزینه:**
- یک SSI (Single Point) جدید — با Backup RDB+AOF و Restart Policy مدیریت می‌شود.
- Semantics At-least-once ⇒ هر Consumer باید Idempotent طراحی شود (تست الزامی).

## Compliance

- تست Idempotency در سوئیت هر Consumer (اجرای دوبل پیام = یک اثر).
- تست معماری: عدم import مستقیم `ioredis`/`bullmq` بیرون از Kernel/Worker (فقط از طریق abstraction صف در Kernel).
- Health-check Redis در `/api/health` (عمق) + مانیتور DLQ.
