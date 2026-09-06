# ADR-0023 — استقرار تکرارپذیر: Releaseهای تغییرناپذیر + سوئیچ اتمیک + Docker تک-deployable

- وضعیت: **Accepted**
- تاریخ: فاز ۱۹ (PHASE 19 — DevOps & Deployment)
- دامنهٔ تصمیمهای مهندسی: ED-207..216 (کاتالوگ در DEPLOYMENT.md)
- مرتبط: ADR-0004 (SQLite تک-پردازشی) · ADR-0021 (DurableJob) · ADR-0022 (QA)

## Context

فرمان فاز ۱۹: چهار محیط (Development/Testing/Staging/Production)، استانداردسازی Docker/Environment/Secrets/Reverse-Proxy/SSL/DB/Cache/Queue/Storage، CI/CD کامل (۹ مرحله: Lint→TypeCheck→Test→SecurityScan→Build→Artifact→Deploy→HealthCheck→Rollback) و «Deployment باید Repeatable باشد». spec §50-53/§71/§75-77 الزامات دقیق میدهد (nginx/SSL/domain/firewall/backup/logging/monitoring/migration/rollback + چهار اسکن امنیتی CI).

## Options

1. **docker-compose فقط**: تکرارپذیری در محیط dockerized؛ اما سرور bare-metal (تک-VPS اولیه محصول) بدون مسیر میماند و rollback خارج compose دستی است.
2. **Git-pull deploy**: سرور git pull میکند و rebuild میکند — «تکرارپذیر» بهظاهر؛ اما stateهای محلی (db/storage) با source قاطی میشوند (خودش را در این پروژه نشان داد: preflight درخت dirty را رد کرد) و rollback = rebuild (کند و غیراتمیک).
3. **(انتخاب) Releaseهای تغییرناپذیر + سوئیچ symlink اتمیک + سازگاری docker**: هر استقرار = یک release directory ساختهشده از stateِ git-committed (manifest VERSION)، health-gated با /readiness، سوئیچ با ln -sfn (تنها گام mutate)، auto-rollback خودکار در شکست گیت سلامت؛ همان payload در Docker image هم میرود (selective copy).

## Decision

1. **ED-207 Release مدل**: `releases/<timestamp>-<gitsha>/` تغییرناپذیر + `current` symlink؛ نگهداری ۱۰ release (افق rollback).
2. **ED-208 دروازهٔ سلامت + auto-rollback**: readiness باید در پنجره (۹۰s) سبز شود؛ وگرنه release قبلی (خودش health-gated) برمیگردد؛ اگر آن هم شکست خورد current دستنخورده میماند — هرگز بدون سرور نمی‌مانیم.
3. **ED-209 payload انتخابی**: کشف شد Next 16.1.3 در standalone کل snapshot پروژه (حتی releases/ → بازگشت بازگشتی ۱.۳GB!) کپی میکند؛ release فقط server.js + node_modules ردیابی‌شده + .next + public + prisma میگیرد (۱۸۰MB در برابر ۱.۳GB).
4. **ED-210 جداسازی state/source**: db/ و storage/ و releases/ از git خارج شدند (بازسازی dev: db:push+db:seed) — preflight استقرار درخت clean الزام میکند؛ ابزارها (eslint/tsc/bun-test) runtime-state را ignore میکنند.
5. **ED-211 تک-deployable**: worker/scheduler/queue درون همان standalone (ADR-0004/0021) — کانتینرهای جدا فقط برای multi-instance آینده (D-17-1)؛ Redis/MinIO بهصورت compose profile اختیاری آماده.
6. **ED-212 CI دو-سطحی**: GitHub Actions (نهادی: gitleaks+osv+semgrep+trivy+registry+SSH deploy با environment approval) + `scripts/ci-local.sh` (همان ۹ مرحله، اینجا اجراشده) — شکست هر مرحله pipeline را میایستاند (needs-gating).
7. **ED-213 migration**: `prisma migrate deploy` در entrypoint کانتینر + deploy.sh + سرویس migrate؛ baseline یکباره برای DB توسعهٔ db-push-مدیریت‌شده مستند شد.
8. **ED-214 backup/restore آزمون‌شده**: snapshot سازگار WAL-aware + tar storage + چرخش + صحت‌سنجی خودکار (۵۵ جدول) + restore با stop-نویسنده/safety-copy — restore واقعاً اجرا شد.
9. **ED-215 گیت CI DEV1..DEV10**: پوشش env مکانیکی (هر process.env کد در .env.example) · Dockerfile الگوها · compose pinها · nginx TLS/headers/limits · ۹ مرحله CI · repeatable deploy · backup · seamها · runbook.
10. **ED-216 type-check صفر**: گیت tsc در CI فعال شد → ۶۹ خطای latent انباشته (۲ باگ واقعی: کلید تکراری i18n + fixture گلوله‌شده) رفع شد.

## Consequences

- ✅ استقرار تکرارپذیر و اثبات‌شده: deploy→health→rollback→redeploy drill سبز؛ release از git-sha بازتولید میشود.
- ✅ auto-rollback یعنی «استقرار بد» هرگز بیشتر از پنجرهٔ سلامت دوام نمیکند (spec §76).
- ✅ image و release از یک payload واحد — نه دو مسیر متفاوت.
- ⚠️ docker build/trivy در این محیط بدون docker اجرا نشد (فقط ساختار گیت شد) — CI نهادی اجرا میکند (D-19-1).
- ⚠️ symlink-switch تک-اینستنس است؛ blue-green دو-upstream = D-19-3.
- ⚠️ migrate deploy برای DB production نیازمند baseline یکباره (مستند در DEPLOYMENT.md §7).

## Compliance

- گیت CI: `npm run audit:devops` → DEV1..DEV10 (scripts/devops-audit.mjs).
- اجرا: `bash scripts/ci-local.sh` → ۹ مرحله سبز (شامل rollback-drill)؛ `make deploy`/`make rollback`.
- مستند: `docs/DEPLOYMENT.md` (۱۵ بخش، چکلیست حقوقی production طبق spec) + `README.md`/`CONTRIBUTING.md`/`CHANGELOG.md` (spec §52).
