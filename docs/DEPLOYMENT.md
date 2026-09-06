# DEPLOYMENT — استقرار و عملیات (PHASE 19)

> سند فاز ۱۹ طبق فرمان محصول: «آماده‌سازی برای Development/Testing/Staging/Production + استانداردسازی Docker/Environment/Secrets/Reverse Proxy/SSL/Database/Cache/Queue/Storage + CI/CD کامل (Lint→TypeCheck→Test→SecurityScan→Build→Artifact→Deploy→HealthCheck→Rollback) + Deployment تکرارپذیر»
>
> نسخه: 1.0.0 · وضعیت: **اجرا و آزمون‌شده** (deploy→health→rollback drill سبز) · گیت CI: `npm run audit:devops` (DEV1..DEV10)

---

## §1 معماری استقرار (و چرا)

```
                    ┌──────────────────────────────────────────┐
  internet ──TLS──▶ │  nginx (443)  reverse proxy + rate limit │
                    │  deploy/nginx/babahakim.conf             │
                    └───────────────┬──────────────────────────┘
                                    │ app:3000 (internal only)
                    ┌───────────────▼──────────────────────────┐
                    │  babahakim/app:<git-sha>                  │
                    │  Next.js standalone · non-root (bh:1001)  │
                    │  tini PID1 · migrations at boot           │
                    │  API + DurableJob worker + samplers       │
                    │  (یک deployable واحد — ADR-0023)          │
                    └───────────────┬──────────────────────────┘
                                    │ volume
                    ┌───────────────▼──────────────────────────┐
                    │  /data  ·  bh.db (SQLite WAL)             │
                    │         ·  storage/ (media variants)      │
                    │         ·  backups/                       │
                    └──────────────────────────────────────────┘
```

- **یک deployable واحد**: frontend + backend + worker + scheduler در یک standalone Next.js اجرا میشوند — طبق طراحی ADR-0004/0021 (صف DurableJob دیتابی، worker درون-پردازشی با بازیابی کرش در بوت). جداسازی کانتینر worker/scheduler فقط برای multi-instance آینده است (D-17-1) — نه الزام v1.
- **SQLite + volume**: تصمیم ADR-0004؛ Postgres مسیر رشد افقی است (ADR-0005، BR-PERF-09). WAL + busy_timeout در بوت اعمال میشود (فاز ۱۶).
- **Cache**: درون-پردازشی با seam تعویضپذیر (`setCacheStore`) — Redis با `docker compose --profile redis` برای آینده آماده است (D-15-3/D-17-1).
- **Queue**: DurableJob دیتابی (ADR-0021) — کرش-سِیف، بازیابی stale-claim در بوت، DLQ با replay. نیازی به Redis ندارد.
- **Storage**: درایور local روی volume + پورت درایور (S3/MinIO seam — ADR-0006؛ `--profile storage`).

## §2 چهار محیط (Environment Matrix)

| | Development | Testing | Staging | Production |
|---|---|---|---|---|
| فرمان ورود | `bun run dev` / `docker compose up -d` | `bash scripts/qa-run.sh` | مثل Production + دامنهٔ stage | `docker compose -f docker-compose.prod.yml up -d` یا `scripts/deploy.sh` |
| NODE_ENV | development | test | production | production |
| DATABASE_URL | `file:./db/custom.db` (seed شده) | همان dev DB | `file:/data/bh.db` — اسکیمای production + دادهٔ **جعلی** | `file:/data/bh.db` (volume) |
| Secrets | derived (هشدار بلند) | derived | `bash scripts/gen-secrets.sh` | **الزامی** — بدون آن پروسه بوت نمیشود (ED-59) |
| BH_CHAOS | خاموش | **1** (سوئیتهای قابلیت اطمینان) | خاموش (فقط دریل ادمین) | خاموش — مسیر کنسول 404-نامرئی |
| Integrations | mock | mock | mock یا sandbox | LIVE فقط با credential کامل (fail-safe ED-138) |
| TLS | بدون | بدون | self-signed (`gen-self-signed.sh`) | Let's Encrypt (§6) |
| داده | seed (`db:push`+`db:seed`) | همان dev | **هرگز** دادهٔ واقعی بیمار | واقعی + بکاپ روزانه |

**بازسازی محیط dev از صفر**: `bun install && bun run db:push && bun run db:seed && bun run dev` — DB و storage دیگر tracked نیستند (جداسازی state/source فاز ۱۹).

## §3 Docker (spec §50)

- `Dockerfile` سه-مرحلهای: **deps** (bun install --frozen-lockfile) → **build** (prisma generate + next build) → **runner** (فقط standalone + static + public + prisma + CLI مهاجرت؛ کاربر غیر root `bh:1001`؛ tini بهعنوان PID1 برای forward سیگنال → graceful shutdown؛ HEALTHCHECK روی `/liveness`).
- مهاجرتها **در بوت** (`docker-entrypoint.sh`: `prisma migrate deploy` سپس exec server) — idempotent و امن برای هر replica.
- `docker-compose.yml` (dev): یک فرمان `docker compose up -d` (spec §71) + پروفایلهای رشد اختیاری redis/minio.
- `docker-compose.prod.yml`: pin نسخه با `BH_VERSION` (هرگز `:latest`)، expose فقط داخلی 3000، volume `bh-data`، healthcheck با start_period 90s، restart policy، سقف memory 2g (D-16-6)، چرخش لاگ json-file، سرویس یکبار migrate برای «نامرئی شدن» خطای مهاجرت در سطح stack.
- کانتینر scan: Trivy در CI (CRITICAL/HIGH = توقف pipeline — §9).
- `.dockerignore`: git/env/db/storage/logs هرگز وارد image نمیشوند.

## §4 Environment و Secrets (spec §51)

- `.env.example` **تنها** قالب committed است (`.gitignore` با `!.env.example`).
- **هر** متغیری که کد میخواند در قالب مستند است — گیت DEV1 این را مکانیکی enforcement میکند (parse واقعی `process.env.*` از src/ و مقایسه).
- تولید Secretها: `bash scripts/gen-secrets.sh` (JWT_SECRET hex32 · FIELD_ENC_KEY base64 32B).
- تولید واقعی: هرگز در git؛ برای production از secret manager میزبانی (GitHub Actions Secrets + SSH) — کلیدهای deployment از مسیر کد جداست.
- **fail-fast**: بدون JWT_SECRET/FIELD_ENC_KEY معتبر در production، پروسه بوت نمیشود (ED-59؛ تستشده از فاز ۵).
- چرخش: JWT → خروج کاربران از سیستم (invalidation refresh)؛ FIELD_ENC_KEY → نیازمند re-encryption قبل از تعویض (یادداشت در gen-secrets).

## §5 Reverse Proxy (Nginx)

`deploy/nginx/babahakim.conf`:

- **TLS 1.2/1.3** + session cache + modern ciphers؛ HSTS (transport-level؛ CSP واحد در `next.config.ts` باقی میماند — دو منبع CSP ممنوع).
- پورت ۸۰ فقط redirect به ۴۴۳ (بهجز ACME challenge) — هیچ API plaintext پاسخ داده نمیشود.
- **rate limit دو-لایه**: `bh_auth` (۱۰r/m برای مسیرهای auth — خط اول درشت قبل از rate-limiter درون-پردازشیِ دقیقتر فاز ۵) + `bh_api` (۶۰r/m).
- `client_max_body_size 25m` — بودجهٔ آپلود تصویر زبان (سرور خودش MIME/size/quality را validates میکند).
- upstream keepalive + `proxy-common.inc` (X-Forwarded-For/Proto/Host برای CSRF Origin validation فاز ۵).
- health probe از nginx پاس داده میشود اما access_log آن خاموش است (تورم متریک فاز ۱۵).

## §6 SSL / Domain (spec §75)

- **dev/staging**: `bash deploy/nginx/gen-self-signed.sh localhost` → جفت cert در `deploy/nginx/certs/` (mount read-only).
- **production (Let's Encrypt)** — روی سرور:
  ```bash
  sudo apt install certbot
  sudo certbot certonly --webroot -w /var/www/certbot -d babahakim.example --email ops@example -n --agree-tos
  # سپس sym-link:
  sudo ln -s /etc/letsencrypt/live/babahakim.example/fullchain.pem deploy/nginx/certs/fullchain.pem
  sudo ln -s /etc/letsencrypt/live/babahakim.example/privkey.pem  deploy/nginx/certs/privkey.pem
  # تمدید خودکار (cron): certbot renew --webroot -w /var/www/certbot && docker compose -f docker-compose.prod.yml exec nginx nginx -s reload
  ```
- **Domain**: رکورد A به IP سرور؛ `server_name` در conf تنظیم شود؛ `BH_BASE` و `ZARINPAL_CALLBACK_BASE` باید همان origin باشند.

## §7 Database Migration

- منبع واحد: `prisma/schema.prisma` + `prisma/migrations/`.
- **استقرار**: `prisma migrate deploy` — idempotent، در entrypoint کانتینر + سرویس migrate در compose + داخل `scripts/deploy.sh` قبل از serve.
- ⚠️ **پایهٔ یکبارهٔ production**: DB توسعهٔ این پروژه تاریخیاً با `db push` مدیریت میشده؛ اولین استقرار production باید migrationهای موجود را «اعمال‌شده» علامت بزند تا migrate deploy دروازهٔ سخت شود:
  ```bash
  for m in $(ls prisma/migrations); do bunx prisma migrate resolve --applied "$m"; done
  bunx prisma migrate deploy   # از این به بعد: دروازهٔ سخت — شکست = توقف استقرار
  ```
- بکاپ قبل از هر مهاجرت: deploy job در CI قبل از deploy اسکریپت backup را صدا میزند (§8).

## §8 Backup / Restore (spec §75)

```bash
bash scripts/backup.sh          # DB (snapshot سازگار WAL-aware حتی زیر سرور زنده) + storage + manifest
bash scripts/restore.sh         # آخرین بکاپ — نویسندهٔ زنده stop + صحت‌سنجی + safety-copy
bash scripts/restore.sh backups/bh-<stamp>.db backups/storage-<stamp>.tar.gz
```

- cron پیشنهادی production (root): `15 3 * * * bhuser /srv/babahakim/scripts/backup.sh`
- چرخش: `MEDIA_BACKUP_RETENTION_DAYS` (پیش‌فرض ۷).
- **صحت‌سنجی خودکار**: هر بکاپ بعد از ایجاد باز میشود و تعداد جدولها را میشمارد — «بکاپی که restore نمیشود دکور است» (گیت DEV8).
- restore زنده آزمون شد: stop نویسنده → integrity → safety-copy → swap → WAL quiesce → redeploy.

## §9 CI/CD (spec §76 + §77)

**GitHub Actions** (`.github/workflows/ci.yml`) — آیین: «شکست هر مرحله، استقرار را متوقف میکند» (needs-gating):

```
quality (lint → type-check → unit)
   ├──▶ integration (build → qa-run full suite → pentest 45 → smoke) 
   └──▶ security (secret-scan + gitleaks + osv-scanner + semgrep + 10 گیت معماری)
              └──▶ artifact (docker build + trivy CRIT/HIGH=stop + tar+sha256 + ghcr push)   [فقط main]
                        └──▶ deploy (SSH: backup → deploy.sh health-gated + auto-rollback)
                                  └──▶ health-check (readiness از بیرون)
rollback (workflow_dispatch یا پس از deploy ناموفق — rollback.sh)
```

**آینهٔ محلی همان مراحل** (اینجا اجرا شد): `bash scripts/ci-local.sh` — lint · type-check · unit · integration (qa-run) · security (bun pm audit + secret-scan + ۱۰ گیت + SAST اگر نصب باشد) · build · artifact (tar+sha256) · deploy (health-gated) · health-check · rollback-drill · docker-build (اگر runtime موجود باشد).

## §10 استقرار تکرارپذیر (Repeatable) — مدل Release

```
releases/20260906094143-d5cdf14/   ← release تغییرناپذیر (standalone + static + public + prisma + VERSION)
releases/20260906094258-2c551a4/   ← release دوم
current → releases/20260906094143-d5cdf14   ← سوئیچ اتمیک (ln -sfn)
```

- **preflight**: درختِ dirty deploy نمیشود (release = یک stateِ git-committed بازتولیدپذیر).
- **سوئیچ اتمیک**: تنها گام mutate کل استقرار؛ هیچ state نیمه-مهاجرت وجود ندارد.
- **دروازهٔ سلامت**: readiness در پنجرهٔ ۹۰ ثانیه پاسخ ندهد → **auto-rollback به release قبلی** (خودش health-gated است؛ اگر آن هم شکست خورد، current دستنخورده میماند و خطا بلند میشود).
- **حافظهٔ rollback**: ۱۰ release آخر نگه داشته میشود.
- **drill زنده**: deploy A ✓ → deploy B ✓ → rollback به A ✓ → redeploy HEAD ✓ (`scripts/rollback-drill.sh`) — اجرا شد و سبز.

## §11 Monitoring / Logging (spec §75)

- پروبهای عمومی فاز ۱۵: `/liveness` (بدون DB — container healthcheck) · `/readiness` (db/queue/storage/bootstrap — دروازهٔ deploy و compose) · `/health` (ترکیبی).
- متریکها/لاگهای ساختاریافته با correlation-id در stdout کانتینر (json-file driver با max-size 50m×5) — قابل ارسال به Loki/ELK (D-15-5).
- موتور هشدار درون-پردازشی (۱۱ قاعده، CRITICAL→SMS) — نیازی به سرویس خارجی ندارد.
- nginx access/error log با چرخش docker.

## §12 Firewall (production)

```bash
sudo ufw default deny incoming && sudo ufw default allow outgoing
sudo ufw allow 22/tcp           # SSH (ترجیحاً source-restricted)
sudo ufw allow 80/tcp           # ACME + redirect
sudo ufw allow 443/tcp          # TLS
sudo ufw enable                 # 3000 هرگز باز نیست (nginx-only)
```

## §13 Production Checklist (حقوقی/Regulatory — الزام spec §2087)

قبل از استقرار واقعی production:

- [ ] بررسی حقوقی مقررات کشور محل ارائه (حفاظت داده پزشکی، قوانین e-health)
- [ ] مشاوره Regulatory متخصص برای فرایند رضایت بیمار و مالکیت داده
- [ ] تعیین سیاست نگهداری/حذف داده سلامت (زندگی سافت-دلیت فعلی + نگهداری قانونی)
- [ ] قرارداد SMS/پرداخت با تاییدیه فنی (زرین‌پال production merchant)
- [ ] DPO/مسئول حریم خصوصی مشخص شده باشد
- [ ] تست penetration بیرونی قبل از go-live
- [ ] بکاپ restore-drill روی سرور واقعی (نه فقط محیط dev)
- [ ] VPN/بستر مدیریتی برای دسترسی ops

## §14 عیبیابی سریع (Troubleshooting)

| علامت | اولین بررسی |
|---|---|
| بوت نمیشود: `[SECURITY] JWT_SECRET must be set` | درست است — ED-59؛ `.env.production` را mount/prerequire کنید |
| readiness: `db:false` | volume `/data` سوار شده؟ مهاجرت fail کرده؟ (`docker compose logs app`) |
| آپلود 413 | `client_max_body_size 25m` (nginx) — فراتر از بودجهٔ پروژه است؛ سرور خودش reject میکند |
| 429 زیاد از `bh_auth` | rate limit nginx + درون-پردازشی هر دو فعالند — سیاست IP real را با X-Forwarded-For راستیآزمایی کنید |
| deploy رد شد: UNCOMMITTED | state/source — state را به volume منتقل کنید (الگوی فاز ۱۹) |
| rollback هم fail شد | `current` دستنخورده میماند؛ `releases/*/server.log` را ببینید؛ restore از §8 |

## §15 گیت CI و بدهیها

- **DEV1..DEV10** (`npm run audit:devops`): پوشش env · secrets · Dockerfile · compose · nginx · pipeline · repeatable deploy · backup/restore · seamهای زیرساخت · runbook/Makefile.
- بدهیهای صریح (D-19-*): **D-19-1** اجرای docker build/trivy در محیط بدون docker (اینجا فقط SYNTAX/structure گیت شد؛ CI واقعی اجرا میکند) · **D-19-2** multi-instance (replicaهای app + Redis + Postgres — ADR-0005/D-17-1) · **D-19-3** ترتیب اجرای PHP? خیر — **D-19-3** blue-green واقعی با دو upstream (الگوی symlink فعلا single-instance) · **D-19-4** ثبت snapshot ثبت‌شدهٔ staging از production (masking داده) · **D-19-5** فاز ۰۹ remediation همچنان باز.
