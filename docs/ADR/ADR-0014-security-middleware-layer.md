# ADR-0014: لایه اجرای امنیت — Middleware سراسری + Guardهای مسیر

| فیلد | مقدار |
|---|---|
| شماره | ADR-0014 |
| وضعیت | Accepted |
| تاریخ | 1405/06/14 (2026-09-04) |
| فاز تصمیم | PHASE 05 — Security & Privacy |
| معادل ED | ED-59/60/61/62 |
| اسناد مرتبط | `SECURITY.md` · `THREAT-MODEL.md` · `ARCHITECTURE.md §9` |

## Context

۳۰+ مسیر API با احراز هویت کوکی‌محور وجود دارد؛ بازنویسی تک‌تک آن‌ها برای CSRF/Origin/هدرها پرریسک و تکراری است (قاعده ۵ منشور: بدون کد تکراری). همچنین Rate Limit و Secret Management باید قبل از رسیدن به منطق کسب‌وکار اعمال شوند. چالش فنی: middleware در Edge Runtime اجرا می‌شود و Node `crypto` ندارد.

## Options

| گزینه | مزایا | معایب |
|---|---|---|
| **A) Middleware سراسری (Origin+CSRF) + هدرها از next.config + RL درون مسیرها** | پوشش ۱۰۰٪ بدون بازنویسی مسیرها؛ تفکیک مسؤولیت؛ Edge-safe | RL در پروسه Node (تک-Replica) |
| B) Guard در هر مسیر | کنترل دقیق | ۳۰+ بازنویسی؛ فراموشی = حفره؛ نقض DRY |
| C) فقط next.config headers | ساده | بدون CSRF/Origin — ناکافی برای Cookie-Auth |

## Decision

**A**: `src/middleware.ts` روی همه مسیرها (static مستثنا) — (۱) Origin/CORS را برای متدهای تغییردهنده می‌پالاید، (۲) CSRF double-submit را سرور-سایت قبل از هر route اعمال می‌کند (معاف واحد: callback درگاه پرداخت — server-to-server)، (۳) کوکی `ta_csrf` را در نبود صادر می‌کند. ماژول `csrf.ts` عمداً **Edge-safe** (Web Crypto + مقایسه رشته‌ای) نوشته شد. هدرهای ایستا از `next.config.ts`. Rate limit در Node داخل مسیرهای حساس (state قابل‌اتکا) با اینترفیس `RateLimitStore` برای مهاجرت Redis.

## Consequences

**مثبت:** پوشش CSRF/Origin بدون تغییر ۳۰+ مسیر؛ خطای واحد/قابل‌پیش‌بینی 403؛ تست pentest سراسری.
**هزینه:** Edge-safe نگه‌داشتن ماژول‌های مشترک (محدودیت API)؛ RL تک-پروسه تا Redis (بدهی D-2).

## Compliance

- `tests/security-pentest.sh`: POST بدون/با CSRF غلط = 403؛ Origin خارجی = 403؛ GET بدون نیاز = 200.
- `security.test.ts`: tokensMatch/originAllowed/newCsrfToken.
- Headers: ۵ چک pentest.
