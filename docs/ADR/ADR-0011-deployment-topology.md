# ADR-0011: توپولوژی استقرار — یک Codebase، دو Process، زیرساخت Compose

| فیلد | مقدار |
|---|---|
| شماره | ADR-0011 |
| وضعیت | Accepted |
| تاریخ | 1405/06/14 (2026-09-04) |
| فاز تصمیم | PHASE 03 — System Architecture |
| معادل ED | ED-45 |
| اسناد مرتبط | `ARCHITECTURE.md §10` · `ARCHITECTURE-DIAGRAM.md §11, §12` · قید C4 منشور |

## Context

قید C4: سیستم باید هم در VSCode (توسعه محلی سریع) و هم Docker (Production) کار کند. ADR-0003 (یک Deployable web)، ADR-0005 (Redis/Worker)، ADR-0006 (S3/MinIO)، ADR-0007 (ai Container) اجزای اجرایی را تعیین کردند — این ADR نحوه چیدمان و اجرای آن‌ها را قطعی می‌کند.

## Options

| گزینه | مزایا | معایب |
|---|---|---|
| **A) docker-compose با ۷ سرویس (web/worker/postgres/redis/minio/ai/caddy)** | تطابق dev/prod؛ هر جزء قابل Scale؛ Health-check بومی | Compose برای prod تک-Host (برای مقیاس فعلی کافی) |
| **B) Kubernetes از روز اول** | Scale/HA قوی | Overkill شدید (C1)؛ تیم ۱-۳ نفره |
| **C) سرورهای مدیریت‌شده جدا جدا (PaaSها)** | Ops کم | قفل Vendor؛ پراکندگی؛ حریم داده پزشکی ایران |

## Decision

**توپولوژی استقرار:**

- **Dev:** توسعه‌دهنده می‌تواند (۱) فقط `bun dev` با Adapterهای local (SQLite + local-fs + AI in-process) اجرا کند، یا (۲) کامل `docker compose up` با Postgres/Redis/MinIO/ai — **هر دو حالت باید کار کنند** (Config فقط از Env).
- **Compose سرویس‌ها:** `web` (Next standalone)، `worker` (همان Image، entrypoint `bun src/workers/index.ts`)، `postgres:16`، `redis:7`، `minio`، `ai` (FastAPI)، `caddy` (Reverse Proxy/TLS — در prod).
- **Prod:** Scale افقی `web` (Stateless با JWT — بدون Sticky Session)؛ Worker با دو Pool (notify/sla پر-Concurrency، ai کم-Concurrency)؛ `ai` قابل انتقال به Node/GPU **بدون تغییر بقیه**؛ Postgres + Backup روزانه + تست Restore فصلی.
- **شبکه:** همه سرویس‌ها در شبکه داخلی Docker؛ فقط `web` (و Route Callback پرداخت) از بیرون قابل دسترسی.
- **Release:** Rolling با Readiness Probe (`/api/health`)؛ Migrationها **قبل از** Deploy جدید اجرا می‌شوند (الگوی Expand-Contract برای تغییرات Breaking).
- **مهاجرت SQLite→Postgres** طبق مسیر ۴-گامی `ARCHITECTURE.md §8.4`.

## Consequences

**مثبت:**
- تطابق محیط dev/prod (کاهش «روی سیستم من کار می‌کرد»).
- مسیر رشد روشن: Compose → HA (پایان فاز 06) بدون Redesign.

**منفی/هزینه:**
- نگهد docker-compose + Dockerfile چند-Stage + entrypointهای دوگانه.
- تک-Host در نسخه اول Compose (ریسک R4 — با Restart Policy + Backup مدیریت).

## Compliance

- `docker compose config` در CI (اعتبارسنجی ساختار).
- `/api/health` عمق‌دار (DB/Redis/Storage/AI) در Readiness Probe.
- تست Restore Backup به‌صورت فصلی و مستند در worklog.
