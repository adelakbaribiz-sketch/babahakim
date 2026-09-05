# BabaHakim — ماتریس ردیابی نیازمندی‌ها (Requirement Traceability Matrix)

| فیلد | مقدار |
|---|---|
| نسخه | 1.0.0 |
| تاریخ | 1405/06/13 (2026-09-04) |
| فاز | PHASE 01 — Product Requirements & System Specification |
| هدف | ردیابی کامل: **Master Prompt (104§) → FR/NFR → User Story → Use Case → Business Rule → Acceptance Criterion → وضعیت → روش راستی‌آزمایی** |
| راهنمای وضعیت | **I** = پیاده‌سازی‌شده در v1 · **P** = جزئی · **R** = برنامه‌ریزی‌شده (فاز تعریف‌شده) |
| روش راستی‌آزمایی | U=Unit · I=Integration · API=API Test · E2E=End-to-End · SEC=Security · UI=Visual · PERF=Performance · CI=Pipeline · DOC=بازرسی مستند |

---

## 0) یادداشت فازهای ۰۲ و ۰۳ (Workflow Engine + System Architecture)

> ۱۴۰۵/۰۶/۱۳ (2026-09-04) — پیاده‌سازی PHASE 02: موتور گردش کار عمومی (`src/lib/workflow/`) با ۸ ماشین اعلانی (CASE/PRESCRIPTION/ORDER/PAYMENT/SHIPMENT/TICKET/FOLLOWUP/AI_REVIEW)؛ هر Transition دارای Guard نقش/دسترسی/مالکیت + Validation + Cascade اتمیک + AuditLog `WORKFLOW_*` + نوتیفیکیشن. جزئیات: `docs/WORKFLOW.md`. تست: ۵۱ Unit (بایگانی `bun test`) + Smoke ۱۳/۱۳.
>
> ۱۴۰۵/۰۶/۱۴ (2026-09-04) — PHASE 03 (M1 کامل): معماری سیستم — انتخاب **Modular Monolith** (ADR-0001/ED-35)، ۱۵ Bounded Context + قواعد وابستگی Tier و ضد-چرخه (ADR-0002/ED-36)، اجزای ۱۱گانه (Frontend/Backend/Worker/DB/Cache/Queue/ObjectStorage/AI/Notification/Payment/Shipping — ADR-0003..0012، ED-37..46). اسناد: `docs/ARCHITECTURE.md` + `docs/ARCHITECTURE-DIAGRAM.md` + `docs/ADR/`×14. اعتبارسنجی ساختاری: `scripts/validate-phase03-docs.py` (PASS). یادداشت توالی فازها: §12 PRD.

> ۱۴۰۵/۰۶/۱۴ (2026-09-04) — PHASE 04 (بخش D1/D2 نقشه): معماری و پیاده‌سازی کامل پایگاه داده PostgreSQL — ۱۵ Schema = ۱۵ Bounded Context، ۴۹ جدول (۴۰ Entity §47 + ۹ پشتیبان)، ۳۴ FK درون-Context + Soft-Ref بین-Context (D4)، ۱۶۷ Check Constraint، ۱۹۰ ایندکس (Partial/BRIN/trgm)، ۴۴ تریگر امنیتی (Append-Only/Hard-Delete-Forbidden/updated_at)، ۴ Migration با Alembic + ERD ×۱۷. اسناد: `docs/DATABASE.md` + `docs/DATABASE-ERD.md` + ADR-0013. تست: ۸۵/۸۵ PASS (pytest — فقط از مسیر Migration).

> ۱۴۰۵/۰۶/۱۴ (2026-09-04) — PHASE 05: Security & Privacy کامل — لایه اجرای امنیت (Middleware Origin/CSRF سراسری + هدرها ADR-0014)، سخت‌سازی AuthN (چرخش Refresh + کشف Replay ED-64، OTP/MFA ED-63، RL ED-60، Secret fail-fast ED-59)، بستن شکاف Permission تصویر (ED-66)، حقوق داده (Consent/Export/Deletion→Anonymization — ADR-0015). اسناد: `docs/SECURITY.md` + `docs/THREAT-MODEL.md` (STRIDE+DREAD). تست: ۳۵ Unit + ۴۵ Pentest = ۸۰/۸۰ PASS.

> ۱۴۰۵/۰۶/۱۴ (2026-09-04) — PHASE 06 (طبق فرمان محصول، پیش از ساخت UI نهایی): **UX Architecture** — ۶ User Journey (هر نقش) · Sitemap با مدل Routing دو-نسخه‌ای · **Screen Inventory = ۷۳ صفحه با SC-ID و ۹ فیلد اجباری** (هدف/کاربر/اطلاعات/Actions/دسترسی/Empty/Loading/Error/Success — پوشش کامل ۲۷ صفحه فرمان + Operator + Doctor) · Flow Diagram ×۱۰ (ناوبری/Auth/مسیر طلایی ۱۷ مرحله‌ای/Quality Gate/E1+E2+Doctor/پرداخت/فروشگاه/تیکت/Reassessment) · State System با ۸ الگوی استاندارد SP. اسناد: `docs/UX.md` + `docs/SCREEN-MAP.md` + ED-71..ED-80. اعتبارسنجی: `scripts/validate-phase06-docs.py` (PASS).

> ۱۴۰۵/۰۶/۱۴ (2026-09-04) — PHASE 07 (طبق فرمان محصول: «UI System»): **Design System مرکزی** — توکن‌های دو-منبعی CSS+TS با گیت همگام‌سازی (ED-81) · ۸ توکن وضعیت §9 جایگزین ۱۳۳ تخلف Hardcode (ED-82) · Tailwind v4 CSS-first مرجع (ED-83) · ابزارهای منطقی اجباری برای RTL (ED-84) · Style Guide زنده درون-برنامه‌ای (ED-85) · اصلاح WCAG برای muted-foreground (ED-86) · ۳۲ جفت کنتراست تحت گیت E7 · کامپوننت‌های States چهارگانه SP-1..8 (ED-91) · chartTheme توکنی (ED-88) · Toast جهت‌آگاه sonner (ED-89) · ممیزی یکپارچگی `bun run audit:ui` (ED-90) — خط پایه ۱۳۳→۰. اسناد: `docs/DESIGN-SYSTEM.md` + ED-81..ED-92. راستی‌آزمایی: `scripts/validate-phase07-docs.py` + ممیزی UI PASS + ۸۶/۸۶ تست رگرسیون.

> ۱۴۰۵/۰۶/۱۴ (2026-09-04) — PHASE 08 (طبق فرمان محصول: «Backend Engineering»): **Backend لایه‌ای + استانداردسازی** — ممیزی ۱۶ یافته (A2 بحرانی: Checkout غیراتمیک؛ A15: عدم انطباق RBAC `create_invoice`) · معماری چهارلایه `API/Application/Domain/Infrastructure` زیر `src/server/` (ED-93) · ۱۲ استاندارد Cross-cutting: zod (ED-96)، سرویس‌سازی منطق (ED-93/105)، گاردهای AuthZ (ED-97)، تراکنش اتمیک `withTransaction` (ED-103/104)، Envelope خطای واحد (ED-94)، Logger ساختاریافته reqId (ED-95)، Cache TTL ابطال Event-driven (ED-98)، DomainEventBus (ED-99)، نسخه‌بندی + هدر (ED-101)، JobQueue با retry/DLQ و AI async (ED-102)، قرارداد صفحه‌بندی/فیلتر/مرتب‌سازی (ED-100) · ۴۱ مسیر → Controller نازک (گیت CI `bun run audit:backend` E1..E8 = ۰ تخلف، ED-105) · مستند `docs/BACKEND.md` · تست: ۳۵ Unit + ۱۹ Integration جدید + رگرسیون ۵۱+۳۵+۴۵ (جمع ۱۸۵ PASS).

> ۱۴۰۵/۰۶/۱۴ (2026-09-04) — PHASE 09 (نیمه‌کاره، جلسه قطع‌شده): ممیزی Frontend ۱۵ حوزه + هارنس E2E ۱۷ سناریو ساخته شد؛ remediation پیش از تکمیل قطع شد (گزارش `scripts/frontend-audit-report.json`). فاز ۱۰: بازیابی مسیر آپلود گم‌شده + رفع باگ ThemeToggle → E2E ۱۷/۱۷؛ بقیهٔ remediation فاز ۰۹ باز است.

> ۱۴۰۵/۰۶/۱۴ (2026-09-04) — PHASE 10 (طبق فرمان محصول: «File & Media Engineering»): **موتور فایل/رسانه** — ممیزی ۱۲ یافته (F1..F12؛ F2: پردازش همزمان بلاک‌کننده درخواست؛ F6: تصویر محصول همیشه ۴۰۴) · موتور `src/server/infrastructure/media/` (config/driver/scanner/signed-url/processing/pipeline/lifecycle) · طبقه‌بندی PUBLIC/PRIVATE/TEMPORARY (ED-106) + چرخه حیات انقضا/آرشیو/سطل زباله/پاک‌سازی (ED-117) · آپلود ۲۰۲ Async در JobQueue — عدم بلاک درخواست اصلی (ED-114) · اسکن بدافزار L1..L4 + قرنطینه (ED-111) · Signed URL مقید به fileId+version+variant+exp (ED-112) · Versioning تغییرناپذیر (ED-113) · MEDIA_POLICY تک‌منبع حدود/allowlist با 413/415 (ED-107/108) · ناحیه‌های ذخیره‌سازی + کلید محتوا-نشانی + گارد traversal (ED-109/110) · پل MedicalImage/Product (ED-115/118) · مهاجرت ۱۵ رکورد legacy · Backup/Restore + manifest/sha256 (ED-117) · گیت CI `bun run audit:media` (ED-119) · مستند `docs/FILE-MEDIA.md` · تست: ۳۰ Unit + ۱۹ Integration جدید + Golden path async + ۱۷/۱۷ E2E مرورگری + ۴۵/۴۵ Pentest (جمع ۱۸۹ bun test PASS).

> ۱۴۰۵/۰۶/۱۴ (2026-09-04) — PHASE 11 (طبق فرمان محصول: «AI/ML Engineering»): **مهندسی AI/ML** — ممیزی ۲۰-محوری AI Stack (Data · Dataset · Labels · Features · Models · Prompts · Embeddings · Inference · Evaluation · Versioning×۳ · Feedback · Monitoring · Data Leakage · Bias · Drift · AI Security · AI Cost · Human Validation) · موتور `src/server/infrastructure/ai/` با ۱۰ ماژول (ED-120) · رجیستری مدل **DB-محور** — تعویض مدل بدون تغییر کد (ED-121) · Prompt/Dataset/Model/Preprocessing نسخه‌دار (ED-122/123) · حلقهٔ بازخورد بستهٔ رویداد-محور انسانی→دیتاست با تفکیک بیمار-محور ضد-نشت §63 (ED-123/124) · دروازهٔ اعتبارسنجی انسانی سه‌سطحی — AI هرگز نتیجهٔ قطعی بدون بازبینی (ED-125) · ارزیابی متریک-کامل **محاسبه‌شده** (ED-127) · PSI Drift + Bias + Cost/Budget (ED-126/128) · گارد خروجی zod+allowlist (ED-129) · تله‌متری provenance هر استنتاج (ED-130) · ۶ مسیر API + داشبورد ادمین ۴-تبی · **رفع باگ پروداکشن B-11-1 (ED-131/134)**: انتقال‌های AI_REVIEW از فاز ۰۲ بی‌صدا شکست می‌خوردند (row.status≠reviewStatus) — بازبینی‌های انسانی هرگز ثبت نمی‌شد و حلقهٔ یادگیری کاملاً باز بود · مستند `docs/AI-ML.md` + ED-120..134 · تست: ۵۱ Unit + ۱۱ Integration جدید + رگرسیون ۲۵۱ bun test + ۴۵ Pentest + backend/media audit PASS + راستی‌آزمایی مرورگری ۴ تب.

> ۱۴۰۵/۰۶/۱۴ (2026-09-05) — PHASE 12 (طبق فرمان محصول: «Business Workflow Engineering»): ۱۱ ماشین وضعیت با تمام ۱۱ بُعد (Timeout/Retry/Failure/Recovery جدید) · Governance Runtime هر ۲ دقیقه (Drift Detection + SLA Ladder REMIND→ESCALATE→AUTO) · WorkflowState Projection اتمیک · بازیابی سه‌لایه (گذار ماشین/خودکار SLA/فرار اضطراری ADMIN+Audit) · بستن ۷ مسیر bypass موتور (کاسکاد پرداخت، شروع پرداخت، پل مدیا، followup-scan، deletion مستقیم، invoice پراکنده، MARK_PROCESSED) · ۳ ماشین جدید DELETION_REQUEST/MEDICAL_IMAGE/INVOICE · API کنسول `admin/workflow/*` · اسناد `WORKFLOW.md` §12–19 + ADR-0016 + BR-WF-01..10 · تست ۲۸۳ bun test + ۴۵ Pentest.

> ۱۴۰۵/۰۶/۱۴ (2026-09-05) — PHASE 13 (طبق فرمان محصول: «External Integration Architecture»): **لایه Integrations خارجی** — ممیزی ۹ دامنه (Payment/SMS/Email/Maps/AI/Storage/Shipping/CRM/Analytics؛ یافته کلیدی: SMSLog جعلی KAVENEGAR/DELIVERED با صفر فراخوانی شبکه + Payment بدون PaymentProvider نقض spec §27) · هستهٔ Resilience `callIntegration` با ۸ دغدگی (Timeout AbortSignal · Retry طبقه‌بندی‌شده با backoff+jitter · Idempotency دیتابی `unique(provider,operation,key)` · Error Taxonomy ۹کدی · Logging Redacted · تله‌متری Ring+DB · Fallback · Circuit Breaker CLOSED/OPEN/HALF_OPEN) · ۹ Adapter زنده (Zarinpal PG v4/Kavenegar/HTTP Mailer/Nominatim/HttpAI/Courier/CRM/Analytics) + ۹ Mock قطعی با fault-injection · Credential fail-safe ED-138 (LIVE فقط با credential کامل؛ config.ts تنها خوانندهٔ env) + masking ED-137 · **رفع باگ یکپارچگی SMS (ED-143)**: رکورد تحویل صادق + پیامک خوش‌آمد رسیده (phone به UserRegistered) + refNumber قطعی · پل فاز 11↔13 (ED-146): HttpAIProvider در رجیستری مدل — تعویض استنتاج با ردیف DB · `IntegrationCallLog` + retention ۹۰ روزه (ED-139) · notify با تزریق کانال (ED-137b — گراف client ایمن) · کنسول ادمین `/admin/integrations` + smoke-test + Audit · گیت CI `audit:integrations` (I1..I10) · اسناد `INTEGRATIONS.md` + ADR-0017 + BR-INT-01..10 · تست: ۲۵ Unit + ۵ Integration جدید + رگرسیون ۳۱۳/۳۱۳ + Pentest ۴۵/۴۵ + مرورگر صفر-خطای کنسول.

> ۱۴۰۵/۰۶/۱۵ (2026-09-06) — PHASE 14 (طبق فرمان محصول: «Search, Reporting & Analytics»): **موتور جستجو/گزارش Bounded و Permission-Aware** — ممیزی ۱۰ یافته (S-4: getReports هفت جدول کامل در JS reduce؛ S-1: q بعد از صفحه‌بندی post-filter؛ S-5: from/to نادیده) · `infrastructure/search/` (Normalization فارسی سوپرست §25 + Needle Matrix ED-151 + DSL فیلتر Whitelist ED-152 + محافظ‌های Unbounded ED-153: window≤400d/rows≤200-2k-20k/timeout 15s/offset≤10k) · رجیستری **۱۹ گزارش × ۶ دسته** (Operational/Financial/Business/User/Performance/Custom — Custom = ۵ دیتاست Whitelist، بدون SQL خام) با Aggregation push-down (ED-155) + کش رویدادی (ED-158) · **Export CSV/XLSX/PDF** (ED-156): XLSX خودنویس بدون وابستگی، PDF با pdfkit+FreeSerif shaping فارسی، مسیر async JobQueue→StoredFile TEMPORARY 24h→اعلان REPORT_EXPORT_READY · Permission-aware سه‌لایه: کاتالوگ (PATIENT=صفر/DOCTOR=فقط AI/EXPERT_1 بدون مالی) + اجرا (403/404) + artifact owner-only (ED-157) · جستجوی سراسری ۶-کاناله IDOR-بسته · UI: ReportsCenter + GlobalSearchDialog · گیت CI SR1..SR10 · **رفع باگ‌ها**: ED-161 (پارامتر ISO در raw-SQL بی‌صدا صفر ردیف — Prisma SQLite epoch-ms) + ED-162 (دو مسیر گم‌شده بازگردانی شد — golden-path فاز 08/11 FAIL بود) · اسناد `SEARCH-REPORTING.md` + ADR-0018 + BR-SRCH/BR-RPT §9 · تست: ۴۳ Unit + ۱۹ Integration جدید + رگرسیون ۳۷۵/۳۷۵ + Pentest ۴۵/۴۵ + مرورگر (کاتالوگ/اجرای/خروجی/جستجو EN-FA).
> ۱۴۰۵/۰۶/۱۵ (2026-09-06) — PHASE 15 (طبق فرمان محصول: «Logging, Monitoring & Observability»): **رصد و پایش کامل** — ممیزی O-1..O-10 (بدون پروب §57/متریک/correlation/جستجوی لاگ/موتور هشدار؛ Redaction فقط کلیدمحور) · Trace-first ALS + W3C traceparent + ادامهٔ trace در شغل‌ها (ED-164/169) · Logger v2 **Redaction دو-لایه** کلید+مقدار (موبایل/JWT/کدملی/BLOB/URL-secret، ED-166) + sink batch + IP-hash (ED-173) · موتور متریک مقید ED-167/168 (سقف labelset 256، routePattern :id، api_errors فقط 5xx) + DB $extends (ED-174) + Queue + Business رویداد-محور + CPU/Memory/Disk/Event-loop (ED-176) · پروبهای عمومی دقیق spec §57: `/health` `/readiness` `/liveness` (liveness بی-DB، ED-175) · موتور هشدار واحد ۱۱ قاعده با آستانههای جدول واحد (ED-177/178) + چرخهٔ OPEN→RESOLVED خودکار + cooldown 15min + SMS فقط CRITICAL + تاشدن integrations-monitor فاز ۱۳ (ED-179) · ۳ جدول ops فقط-الحاقی ServiceLog/MetricPoint/AlertEvent با hard-purge 3d/7d/90d (ED-171/172) · کنسول ADMIN «رصد و پایش» (ED-180) · گیت CI OBS1..OBS10 (نقض console واقعی در ai/security.ts یافته و اصلاح شد) · **دو باگ واقعی توسط خود موتور در چرخهٔ Test→Fix**: فیلد ناموجود paidAt در aggregate پرداخت + نرخ خطای کاذب 4xx · اسناد OBSERVABILITY.md + ADR-0019 + BR-OBS §10 · تست: ۴۴ Unit + ۱۶ Integration + رگرسیون ۴۳۵/۴۳۵ + Pentest ۴۵/۴۵ + مرورگر.
> ۱۴۰۵/۰۶/۱۵ (2026-09-06) — PHASE 16 (طبق فرمان محصول: «Performance Engineering»): **کارایی Measurement-First** — پنج هارنس tagدار (API×12 با db/req سمت سرور · EXPLAIN×۲۷ کوئری + مقیاس ۵۰k · Frontend wire-size خام روی production · پایپ‌لاین File/AI/Queue · سناریوی کامل بیمار) · **Baseline: ۲۴/۲۷ full-scan، DELETE-journal، getAuth=۱ کوئری/درخواست، داشبورد=۲۱ کوئری** · اصلاح: ۲۸ ایندکس EXPLAIN-محور (full-scan ۲۴→۲) · WAL+NORMAL (نوشتن ×۷٫۵) · کش هویت ۱۰s با ابطال ۵ مسیر (p95 auth/me −۶۵٪، تست ۴۰۱ فوری) · Batching داشبورد ۲۱→۹+۱ · CDN seam + compress ۶۸٫۳٪ · الزام §58 Horizontal Scaling مستند (§6 PERFORMANCE.md) · «Optimization بدون Measurement» → BR-PERF-01 + گیت PERF9 · اسناد PERFORMANCE.md + ADR-0020 + BR-PERF §11 · ED-181..186 · تست: ۶ Integration جدید + ۴۴۱/۴۴۱ + گیت PERF1..PERF10.

## 1) ماتریس اصلی — Functional Requirements

### دامنه AUTH / PROF / MIZAJ

| FR | User Story | Use Case | Business Rule | AC | وضعیت | راستی‌آزمایی |
|---|---|---|---|---|---|---|
| FR-AUTH-01 | US-AUTH-01, US-REF-02 | UC-01 | BR-AUTH-01, BR-PRV-08 | AC-AUTH-01 | I | API, E2E |
| FR-AUTH-02 | US-AUTH-02 | UC-01 | BR-PRV-04, BR-MED-11 | AC-AUTH-02 | P | API, UI (صفحه متون: R) |
| FR-AUTH-03 | US-AUTH-03, US-AUTH-06 | UC-02 | BR-AUTH-02 | AC-AUTH-03, AC-AUTH-06 | I | API, SEC |
| FR-AUTH-04 | US-AUTH-04 | UC-02 | BR-AUTH-03 | AC-AUTH-04 | I | API, SEC |
| FR-AUTH-05 | US-AUTH-05 | UC-02 (E1) | BR-PRV-08 | AC-AUTH-05 | I | SEC |
| FR-AUTH-06 | US-AUTH-08 | — | BR-PRV-09 | AC-AUTH-08 | P | SEC (پوشش کامل: Phase 03) |
| FR-AUTH-07 | — | UC-01/02 | NFR-SEC-01 | AC-AUTH-03/07 | I | SEC |
| FR-AUTH-08 | US-AUTH-08 | — | BR-PRV-09 | — | R | SEC (Phase 06) |
| FR-PROF-01 | US-PROF-01..03 | UC-03 | BR-PRV-01 | AC-PROF-01..03 | I | API, UI |
| FR-PROF-02 | US-PROF-05, US-MIZAJ-05 | UC-03/07 | — | AC-PROF-05 | I | UI, E2E |
| FR-PROF-03 | US-PROF-04 | UC-03 | BR-PRV-10, BR-AUD-01 | AC-PROF-04 | I | API, I |
| FR-PROF-04 | US-PROF-06 | UC-07..20 | BR-WF-06 | AC-PROF-06 | I | UI, I |
| FR-PROF-05 | US-PROF-07 | UC-05b | BR-IMG-01 | AC-PROF-07 | P | API |
| FR-PROF-06 | US-PRV-01/02 | UC-30 | BR-PRV-05 | AC-PRV-01/02 | R | API, I (Phase 06) |
| FR-MIZAJ-01 | US-MIZAJ-03 | UC-27 | BR-CAT-03 | AC-MIZAJ-03, AC-ADM-07 | I | API, UI |
| FR-MIZAJ-02 | US-MIZAJ-03 | UC-27 | BR-CAT-03 | AC-MIZAJ-03 | I | API, I |
| FR-MIZAJ-03 | US-MIZAJ-01 | UC-04 | ED-09 | AC-MIZAJ-01 | I | UI, E2E |
| FR-MIZAJ-04 | US-MIZAJ-02, US-MIZAJ-05 | UC-04 | BR-CAT-03 | AC-MIZAJ-02/05 | I | API |
| FR-MIZAJ-05 | US-MIZAJ-04 | UC-04 (A1) | BR-CAT-03, BR-HIST-01 | AC-MIZAJ-04 | I | API |
| FR-MIZAJ-06 | US-MIZAJ-02 | UC-04 | ED-09 | AC-MIZAJ-02 | I | U, API |

### دامنه IMG / AI

| FR | User Story | Use Case | Business Rule | AC | وضعیت | راستی‌آزمایی |
|---|---|---|---|---|---|---|
| FR-IMG-01 | US-IMG-01 | UC-05 | — | AC-IMG-01 | I | API, E2E |
| FR-IMG-02 | US-IMG-02 | UC-05 (E1..E3) | BR-IMG-01 | AC-IMG-02 | I | API, SEC |
| FR-IMG-03 | US-IMG-03 | UC-05 (A1) | BR-IMG-01 | AC-IMG-03 | I | U, E2E |
| FR-IMG-04 | US-IMG-03, US-EC-10 | UC-05 (A1) | BR-IMG-01 | AC-IMG-03, AC-EC-10 | I | E2E |
| FR-IMG-05 | US-IMG-04 | UC-05 | — | AC-IMG-04 | I | U, I |
| FR-IMG-06 | US-IMG-04 | UC-05 | — | AC-IMG-04 | I | I |
| FR-IMG-07 | US-IMG-02/07, US-EC-14 | UC-05 (E1) | BR-PRV-02 | AC-IMG-02/07, AC-EC-14 | I | SEC |
| FR-IMG-08 | US-IMG-05/06 | UC-05/30 | BR-PRV-02/10 | AC-IMG-05/06 | I | SEC, I |
| FR-IMG-09 | US-IMG-08 | UC-05b | — | AC-IMG-08 | I | API |
| FR-IMG-10 | US-EC-14 (Orientation) | UC-05 | — | AC-IMG-01 | I | U |
| FR-AI-01 | US-AI-01 | UC-06 | ED-25 | AC-AI-01 | I | I, U |
| FR-AI-02 | US-AI-01/07 | UC-29 | BR-MED-09 | AC-AI-07, AC-ADM-08 | I | API, UI |
| FR-AI-03 | US-AI-05 | UC-06 | BR-MED-10 | AC-AI-05 | I | I |
| FR-AI-04 | US-AI-02/03 | UC-06/08 | BR-MED-01 | AC-AI-02/03 | I | E2E |
| FR-AI-05 | US-AI-04 | UC-06 | BR-MED-01 | AC-AI-04 | I | U |
| FR-AI-06 | US-AI-03 | UC-08 | BR-MED-02 | AC-AI-03 | I | API, E2E |
| FR-AI-07 | US-AI-02 | UC-06/08 | BR-MED-01/07 | AC-AI-02 | I | UI |
| FR-AI-08 | US-AI-06, US-EC-07 | UC-06 (E1) | ED-29 | AC-AI-06, AC-EC-07 | I | I |
| FR-AI-D-01 | US-FUP-05 | UC-19/29 | — | AC-FUP-05 | I | I |
| FR-AI-D-02 | US-AI-07 | UC-29 | — | AC-ADM-08 | I | UI |
| FR-AI-D-03 | US-EXP2-06 | UC-11 (A1) | BR-MED-04 | AC-EXP2-06 | P | I (فلگ خودکار: Phase 06) |
| FR-AI-D-04 | US-PRV-04 | UC-29 | BR-PRV-06 | AC-PRV-04 | R | I (MLOps: Phase 06+) |
| FR-AI-D-05 | US-FUP-04/05 | UC-19 | BR-MED-08 | AC-FUP-04/05 | I | API |
| FR-AI-D-06 | US-FUP-05 | UC-19 | BR-MED-08 | AC-FUP-05 | I | I |
| FR-AI-D-07 | US-PRV-04 | UC-29 | BR-PRV-11 | — | R | I (MLOps) |
| FR-AI-D-08 | US-AI-07 | UC-29 | BR-MED-09 | — | R | DOC + I (MLOps) |
| FR-AI-D-09 | US-AI-07 | UC-29 (G7) | BR-MED-09 | AC-AI-07 | I | API |

### دامنه CASE / QUEUE / EXP1 / EXP2 / DR / RX

| FR | User Story | Use Case | Business Rule | AC | وضعیت | راستی‌آزمایی |
|---|---|---|---|---|---|---|
| FR-CASE-01 | US-CASE-01 | UC-05/06 | — | AC-CASE-01 | I | E2E |
| FR-CASE-02 | US-CASE-02 | §4 Transitions | BR-WF-01 | AC-CASE-02 | I | API, SEC |
| FR-CASE-03 | US-CASE-03 | همه UCها | BR-WF-02 | AC-CASE-03 | I | I, UI |
| FR-CASE-04 | US-CASE-02 | UC (هر Transition) | BR-WF-01 | AC-CASE-02, AC-EC-16 | I | API, SEC |
| FR-CASE-05 | US-CASE-06 | UC-09/14 | BR-WF-07 | AC-CASE-06 | I | API |
| FR-CASE-06 | US-PROF-06 | — | BR-WF-06 | AC-PROF-06 | I | UI |
| FR-QUEUE-01 | US-CASE-07 | UC-07 | — | AC-CASE-07 | I | UI |
| FR-QUEUE-02 | US-CASE-04/05 | UC-07 (E1) | BR-WF-03/04 | AC-CASE-04/05, AC-EC-02 | I | I (همزمانی) |
| FR-QUEUE-03 | US-CASE-07 | UC-07 | — | AC-CASE-07 | I | UI |
| FR-QUEUE-04 | US-CASE-08, US-EC-02 | UC (Escalation) | BR-WF-10 | AC-CASE-08 | P | I (اعلان خودکار: Phase 03/06) |
| FR-QUEUE-05 | — | UC-07 | — | — | P | API (UI تنظیم: Phase 06) |
| FR-QUEUE-06 | US-CASE-09 | UC-07 | NFR-PERF-01 | AC-CASE-09 | I | UI, PERF |
| FR-EXP1-01 | US-EXP1-01, US-CASE-04 | UC-07 | BR-WF-03 | AC-CASE-04 | I | API |
| FR-EXP1-02 | US-EXP1-05, US-MIZAJ-05 | UC-07/08 | — | AC-EXP1-05 | I | UI |
| FR-EXP1-03 | US-EXP1-01 | UC-08 | BR-PRV-10 | AC-EXP1-01 | I | API |
| FR-EXP1-04 | US-EXP1-02 | UC-08 | BR-MED-02 | AC-EXP1-02 | I | API, E2E |
| FR-EXP1-05 | US-EXP1-03 | UC-10 | BR-MED-06 | AC-EXP1-03 | I | API, E2E |
| FR-EXP1-06 | US-EXP1-04, US-EC-06 | UC-10/11 | BR-MED-06, ED-24 | AC-EXP1-04, AC-EC-06 | I | I |
| FR-EXP1-07 | US-EXP1-06 | UC-10/20 | ED-13 | AC-EXP1-06 | I | API |
| FR-EXP1-08 | US-EXP1 (صوت) | UC-10 | ED-19 | — | P | DOC (صوت: Phase 06) |
| FR-EXP1-09 | US-EXP1-07 | UC-28 | — | AC-EXP1-07 | I | API |
| FR-EXP2-01 | US-EXP2-01 | UC-11 | — | AC-EXP2-01 | I | UI |
| FR-EXP2-02 | US-EXP2-01 | UC-11 | — | AC-EXP2-01 | I | UI |
| FR-EXP2-03 | US-EXP2-02 | UC-11 | BR-MED-06 | AC-EXP2-02 | I | API, E2E |
| FR-EXP2-04 | US-EXP2-03, US-EC-13 | UC-11/13 (A1) | ED-06 | AC-EXP2-03, AC-EC-13 | I | API, I |
| FR-EXP2-05 | US-EXP2-04 | UC-11 | ED-05 | AC-EXP2-04 | I | API |
| FR-EXP2-06 | US-EXP2-02, US-DR-01 | UC-11/12 | BR-MED-02 | AC-EXP2-02, AC-DR-01 | I | API, E2E |
| FR-EXP2-07 | US-EXP2-05, US-ORD-01/02 | UC-13 | BR-FIN-07/09 | AC-EXP2-05, AC-ORD-01/02 | I | API, E2E |
| FR-EXP2-08 | US-EXP2-01 | UC-11 | — | AC-EXP2-01 | I | UI |
| FR-DR-01 | US-DR-01 | UC-12 | — | AC-DR-01 | I | UI |
| FR-DR-02 | US-DR-01 | UC-12 | — | AC-DR-01 | I | UI |
| FR-DR-03 | US-DR-02..04 | UC-12 | BR-MED-05, BR-WF-05 | AC-DR-02..04 | I | API, E2E |
| FR-DR-04 | US-DR-05 | UC-12/19 | — | AC-DR-05, AC-FUP-01 | I | API |
| FR-DR-05 | — | UC-12 | BR-PRV-10 | AC-DR-02..04 | I | SEC, I |
| FR-DR-06 | US-DR (تیکت) | UC-23 | ED-18 | AC-TKT-01..03 | I | API |
| FR-RX-01 | US-EXP1-03 | UC-10 | BR-MED-06 | AC-EXP1-03 | I | I |
| FR-RX-02 | US-EXP1-03 | UC-10 | — | AC-EXP1-03 | I | API |
| FR-RX-03 | US-DR-03, US-EXP2-06 | UC-11/12 | BR-MED-05 | AC-DR-03, AC-EXP2-06 | I | API |
| FR-RX-04 | US-EXP1-04 | UC-10/11 | — | AC-EXP1-04 | I | I |
| FR-RX-05 | US-EXP1-04, US-EC-06 | UC-10/11 | BR-MED-06, ED-24 | AC-EXP1-04, AC-EC-06 | I | I |
| FR-RX-06 | US-SHOP-03 | UC-21 (E1) | BR-MED-03 | AC-SHOP-03 | I | API, SEC |

### دامنه SHOP / ORD / PAY / SHIP

| FR | User Story | Use Case | Business Rule | AC | وضعیت | راستی‌آزمایی |
|---|---|---|---|---|---|---|
| FR-SHOP-01 | US-SHOP-05/07 | UC-21 | BR-CAT-01 | AC-SHOP-05/07 | I | UI, API |
| FR-SHOP-02 | US-SHOP-01 | UC-21 | BR-I18N-01, EC-SRCH-01 | AC-SHOP-01 | I | U, API |
| FR-SHOP-03 | US-SHOP-02 | UC-21 | — | AC-SHOP-02 | I | UI |
| FR-SHOP-04 | US-SHOP-04 | UC-21/22 | BR-CAT-06 | AC-SHOP-04 | I | UI, API |
| FR-SHOP-05 | US-SHOP-03 | UC-21 (E1) | BR-MED-03, BR-CAT-07 | AC-SHOP-03 | I | API, SEC |
| FR-SHOP-06 | US-SHOP-06 | UC-21/22 | BR-FIN-08 | AC-SHOP-06 | P | API (Coupon مستقل: Phase 06) |
| FR-SHOP-07 | US-SHOP-07 | UC-21 | — | AC-SHOP-07 | I | UI |
| FR-ORD-01 | US-ORD-01 | UC-13 | ED-06/07 | AC-ORD-01 | I | API, I |
| FR-ORD-02 | US-ORD-02 | UC-13/14 | BR-FIN-09/10, ED-30 | AC-ORD-02 | I | API, E2E |
| FR-ORD-03 | US-ORD-02 | UC-14 | BR-WF-09 | AC-ORD-02 | I | E2E |
| FR-ORD-04 | US-ORD-03 | UC-15/16 | BR-FIN-07 | AC-ORD-03 | I | I |
| FR-ORD-05 | US-ORD-06 | — | — | AC-ORD-06 | I | UI |
| FR-ORD-06 | US-ORD-04 | UC-21/22 | BR-MED-03 | AC-ORD-04 | I | E2E |
| FR-ORD-07 | US-ORD-05, US-EC-01 | UC-22 | BR-FIN-01 | AC-ORD-05, AC-EC-01 | I | I (همزمانی) |
| FR-PAY-01 | US-PAY-01 | UC-15 | ED-28 | AC-PAY-01 | I | I |
| FR-PAY-02 | US-PAY-01 | UC-15 | — | AC-PAY-01 | I | API, E2E |
| FR-PAY-03 | US-PAY-02, US-EC-03 | UC-15 (E3) | BR-FIN-01 | AC-PAY-02, AC-EC-03 | I | I (Idempotency) |
| FR-PAY-04 | US-PAY-03 | UC-16 | BR-FIN-02 | AC-PAY-03 | I | API, E2E |
| FR-PAY-05 | US-PAY-04/08 | UC-16 | BR-FIN-02 | AC-PAY-04/08 | I | API, I |
| FR-PAY-06 | US-PAY-05/06 | UC-28 | BR-FIN-01 | AC-PAY-05/06 | P | API (Reconciliation خودکار: Phase 05) |
| FR-PAY-07 | US-PAY-07 | UC (Refund) | BR-FIN-05 | AC-PAY-07 | P | API, I |
| FR-SHIP-01 | US-SHIP-01 | UC-17 | — | AC-SHIP-01 | I | API |
| FR-SHIP-02 | US-SHIP-01/02 | UC-17 | ED-27 | AC-SHIP-01/02 | I | API |
| FR-SHIP-03 | US-SHIP-04 | UC-18 | — | AC-SHIP-04 | P | API |
| FR-SHIP-04 | US-SHIP-03 | UC-17/18 | — | AC-SHIP-02/03 | I | UI |
| FR-SHIP-05 | US-SHIP-05 | UC-18 | BR-WF-08 | AC-SHIP-05 | I | I, E2E |

### دامنه FUP / TKT / NTF / FIN / REF / ADM / AUD

| FR | User Story | Use Case | Business Rule | AC | وضعیت | راستی‌آزمایی |
|---|---|---|---|---|---|---|
| FR-FUP-01 | US-FUP-01 | UC-19 | — | AC-FUP-01 | I | API |
| FR-FUP-02 | US-FUP-02 | UC-19 | BR-NTF-03 | AC-FUP-02 | I | I, E2E |
| FR-FUP-03 | US-FUP-03 | UC-19 | — | AC-FUP-03 | I | UI |
| FR-FUP-04 | US-FUP-04/05 | UC-19 | BR-MED-08 | AC-FUP-04/05 | I | API |
| FR-FUP-05 | US-FUP (Operator Reminder) | UC-19/23 | ED-08 | AC-FUP-03 | P | I (Cron خودکار: Phase 05) |
| FR-TKT-01 | US-TKT-01 | UC-23 | — | AC-TKT-01 | I | API, E2E |
| FR-TKT-02 | US-TKT-02 | UC-23 | ED-18 | AC-TKT-02 | I | API |
| FR-TKT-03 | US-TKT-03/05 | UC-23 | BR-NTF-01 | AC-TKT-03/05 | P | I (SLA رنگ‌بندی: Phase 03) |
| FR-TKT-04 | US-TKT-04 | UC-23 (A1) | — | AC-TKT-04 | I | API, SEC |
| FR-NTF-01 | US-NTF-01 | همه | BR-NTF-01 | AC-NTF-01 | I | UI |
| FR-NTF-02 | US-NTF-02 | همه | BR-NTF-01/02/04 | AC-NTF-02 | I | I, E2E |
| FR-NTF-03 | US-NTF-03 | UC-28 | BR-NTF-02 | AC-NTF-03 | I | UI |
| FR-NTF-04 | US-NTF-04, US-EC-08 | — | ED-17, BR-NTF-02 | AC-NTF-04, AC-EC-08 | P | I (Queue مستقل: Phase 02) |
| FR-NTF-05 | US-NTF (قالب) | UC-28 | — | — | P | DOC (پنل قالب: Phase 06) |
| FR-FIN-01 | US-FIN-01/05/07 | UC-28 | BR-FIN-11 | AC-FIN-01/05/07 | I | UI, I |
| FR-FIN-02 | US-FIN-01 | UC-28 | BR-FIN-11 | AC-FIN-01 | I | I |
| FR-FIN-03 | US-FIN-06 | UC-28 | BR-FIN-11 | AC-FIN-06 | I | API |
| FR-FIN-04 | US-FIN-02 | UC-28 | — | AC-FIN-02 | I | API |
| FR-FIN-05 | US-FIN-03 | UC-28 | — | AC-FIN-03 | I | API |
| FR-FIN-06 | US-FIN-04 | UC-28 | BR-FIN-06 | AC-FIN-04 | P | API (Excel/PDF: Phase 05) |
| FR-FIN-07 | US-PAY-05 | UC-28 | — | AC-PAY-05 | I | UI, API |
| FR-REF-01 | US-REF-01/02 | UC-01 | — | AC-REF-01/02 | I | API, I |
| FR-REF-02 | US-REF-03 | UC-28 | ED-10 | AC-REF-03 | I | I |
| FR-REF-03 | US-REF-03 | UC-28 | ED-10 | AC-REF-03 | P | API (قواعد کمیسیون: Phase 06) |
| FR-ADM-01 | US-ADM-01 | UC-24 | BR-RBAC-03/04 | AC-ADM-01 | I | API, SEC |
| FR-ADM-02 | US-ADM-02, US-AUTH-07 | UC-24 | BR-RBAC-01/02/04 | AC-ADM-02 | I | API, SEC, I |
| FR-ADM-03 | US-ADM-03 | UC-24 | BR-CAT-01/02 | AC-ADM-03 | I | API |
| FR-ADM-04 | US-ADM-04 | UC-24 | BR-CAT-06/07 | AC-ADM-04 | I | API |
| FR-ADM-05 | US-ADM-05 | UC-25 | BR-CAT-04, BR-FIN-04, EC-ADM-01 | AC-ADM-05 | I | API, I, E2E |
| FR-ADM-06 | US-ADM-06 | UC-26 | BR-FIN-03, BR-CAT-05 | AC-ADM-06 | I | I |
| FR-ADM-07 | US-SHOP-07 | UC-25/26 | BR-FIN-03 | AC-ADM-06/07 | I | UI, I |
| FR-ADM-08 | US-ADM-07 | UC-27 | BR-CAT-03 | AC-ADM-07 | I | API, I |
| FR-ADM-09 | US-ADM-08 | UC-29 | BR-MED-09/10 | AC-ADM-08 | I | UI, API |
| FR-ADM-10 | US-NTF-03 | UC-28 | BR-NTF-02 | AC-NTF-03 | I | UI |
| FR-ADM-11 | US-FIN-05 | UC-28 | BR-MED-12 | AC-FIN-05 | I | UI |
| FR-ADM-12 | — | UC-24/29 | — | — | P | DOC (پنل تنظیمات: Phase 06) |
| FR-AUD-01 | US-PRV-03 | UC-30 | BR-PRV-10 | AC-PRV-03, AC-ADM-09 | I | SEC, I |
| FR-AUD-02 | US-ADM-09 | UC-30 | BR-PRV-10 | AC-ADM-09 | I | API, UI |
| FR-AUD-03 | US-PRV-05 | — | BR-PRV-03 | AC-PRV-05 | I | SEC |
| FR-AUD-04 | US-ADM-09 | UC-30 | — | AC-ADM-09 | I | API, UI |

---

## 2) ماتریس NFR

| NFR | US/AC | وضعیت | راستی‌آزمایی |
|---|---|---|---|
| NFR-SEC-01 | AC-AUTH-03/06 | I | SEC |
| NFR-SEC-02 | AC-IMG-05/07, AC-PRV-05 | I | SEC, API |
| NFR-SEC-03 | AC-NFR-02/07 | P (Phase 03) | SEC, CI |
| NFR-SEC-04 | AC-NFR-07 | I | CI |
| NFR-SEC-05 | AC-AUTH-08 | P (Phase 03) | SEC, API |
| NFR-SEC-06 | AC-EC-14, AC-IMG-02 | P (Phase 03) | SEC |
| NFR-PERF-01 | AC-CASE-09, AC-NFR-01 | I | PERF |
| NFR-PERF-02 | AC-IMG-01, AC-NTF-04 | I | PERF, I |
| NFR-SCAL-01 | — | R (Phase 02/05) | DOC, PERF |
| NFR-SCAL-02 | ED-22 | P | DOC |
| NFR-I18N-01 | AC-NFR-05, AC-SHOP-01 | I | UI, U, E2E |
| NFR-I18N-02 | AC-NFR-08 | I | U |
| NFR-A11Y-01 | AC-NFR-06 | P (Phase 03) | UI |
| NFR-REL-01 | — | R (Phase 05) | DOC, I |
| NFR-REL-02 | AC-EC-01..06, AC-CASE-04, AC-ORD-05, AC-PAY-02 | I | I (همزمانی) |
| NFR-OBS-01 | AC-NFR-04 | P (Phase 05) | OBS |
| NFR-OBS-02 | AC-NFR-02/03 | P (Phase 05) | OBS, CI |
| NFR-OBS-03 | AC-NFR-03/04 | R (Phase 05) | OBS |
| NFR-CMP-01 | AC-PRV-01..05 | P | SEC, I |
| NFR-CMP-02 | AC-AI-02 | I | UI |
| NFR-MAINT-01 | AC-NFR-02 | I | CI, DOC |
| NFR-MAINT-02 | AC-NFR-02 | I | API |
| NFR-API-01 | AC-NFR-02 | I | API |
| NFR-DEV-01 | — | I | DOC, E2E (دستور اجرا) |
| NFR-CICD-01 | AC-NFR-07 | R (Phase 05) | CI |

> **پوشش کامل Edge Criteria:** کل کاتالوگ `AC-EC-01..16` (سند ACCEPTANCE-CRITERIA) به استوری‌های `US-EC-01..16` نگاشت یک‌به‌یک است و در تست‌های Integration/Chaos فاز 04 اجرا می‌شود؛ زیرمجموعه‌های بحرانی (AC-EC-01..06) به NFR-REL-02 متصل‌اند.

---

## 3) پوشش Master Prompt — ۱۰۴ بخش

| § | موضوع | محل پوشش | وضعیت مستند |
|---|---|---|---|
| 1 | هدف اصلی و چرخه ۳۰ مرحله‌ای | PRD §1/§9 · UC §2 · BR §4 | ✅ |
| 2 | اصل AI-Assisted CDS | PRD P1/P2 · BR-MED-01/02 · ED-01 | ✅ |
| 3 | معماری کلان Stack | ED-25 · NFR-SCAL (جزئیات: Phase 02) | ✅ (تصمیم ثبت) |
| 4 | خروجی‌های پیش-Implementation | همین فاز 01 (۵ سند + RTM) | ✅ |
| 5 | نقش‌ها و Permission | PRD §2 · BR §2 (ماتریس RBAC) | ✅ |
| 6 | مدیریت کاربر/بیمار | FR-PROF · UC-03 · ED-21 | ✅ |
| 7 | مزاج‌شناسی Versioning | FR-MIZAJ · UC-04/27 · ED-09 | ✅ |
| 8 | خط لوله تصویر ۱۰ مرحله‌ای | FR-IMG-02/03 · UC-05 | ✅ |
| 9 | فشرده‌سازی ۴ نسخه‌ای | FR-IMG-05/06 · AC-IMG-04 | ✅ |
| 10 | AI Pipeline و Provider | FR-AI-01..03 · ED-25 | ✅ |
| 11 | سیستم یادگیری + Data Pipeline | FR-AI-D-04 · BR-MED-08 | ✅ |
| 12 | Dataset Management + Disagreement | FR-AI-D-02/03 · BR-MED-04 | ✅ |
| 13 | سیستم بیماری‌ها | FR-ADM-03 · BR-CAT-01/02 | ✅ |
| 14 | محصولات | FR-SHOP-01 · FR-ADM-04 | ✅ |
| 15 | Import Excel قیمت | FR-ADM-05/06 · UC-25/26 · BR-CAT-04/05 | ✅ |
| 16 | Prescription Engine | FR-RX · BR-MED-06 | ✅ |
| 17 | Workflow Engine | BR §3/§4 (۲۱ وضعیت، ۱۹ Transition) | ✅ |
| 18 | صف و SLA | FR-QUEUE · UC-07 | ✅ |
| 19 | کارشناس اول | FR-EXP1 · UC-07/08/10 | ✅ |
| 20 | اپراتور + Reminder | BR §2 (PERM) · FR-FUP-05 · ED-08 | ✅ |
| 21 | کارشناس دوم | FR-EXP2 · UC-11/13 | ✅ |
| 22 | دکتر + Audit | FR-DR · UC-12 · BR-MED-05 | ✅ |
| 23 | پنل کاربر | FR-PROF/SHOP · UC-09/21 | ✅ |
| 24 | فروشگاه | FR-SHOP · UC-21 | ✅ |
| 25 | جستجوی فارسی | FR-SHOP-02 · BR-I18N-01 | ✅ |
| 26 | وضعیت‌های سفارش | BR §3.2 | ✅ |
| 27 | پرداخت + Idempotency | FR-PAY · BR-FIN-01 | ✅ |
| 28 | کارت‌به‌کارت | FR-PAY-04/05 · UC-16 | ✅ |
| 29 | ارسال | FR-SHIP · UC-17/18 | ✅ |
| 30 | تیکت | FR-TKT · UC-23 · BR §3.4 | ✅ |
| 31 | Notification Engine | PRD §7 (کاتالوگ ۳۱+ رخداد) | ✅ |
| 32 | SMS Log | FR-NTF-03 · BR-NTF-02 | ✅ |
| 33 | Follow-up Engine | FR-FUP · UC-19 | ✅ |
| 34 | سیستم مالی | FR-FIN · UC-28 | ✅ |
| 35 | گزارشات زرین‌پال | FR-FIN-07 · AC-PAY-05 | ✅ |
| 36 | Referral System | FR-REF · ED-10 | ✅ |
| 37 | Dashboard | FR-ADM-11 · AC-FIN-05 | ✅ |
| 38 | Dynamic Reports + Export | FR-FIN-05/06 | ✅ |
| 39 | تقویم شمسی | NFR-I18N-02 · BR-I18N-02 | ✅ |
| 40 | UI/UX + وضعیت رنگ‌ها | PRD C3 · DESIGN-SYSTEM (BRANDING.md) | ✅ |
| 41 | Patient Timeline | FR-PROF-04 · BR-WF-06 | ✅ |
| 42 | Audit Log | FR-AUD · BR-PRV-10 | ✅ |
| 43 | امنیت | NFR-SEC-* · BR-PRV-* | ✅ |
| 44 | Medical Data Security | BR-PRV-02 · ED-14 | ✅ |
| 45 | API Design | NFR-MAINT-02/API-01 (Spec کامل: Phase 02) | ✅ |
| 46 | Background Jobs | FR-NTF-04 · ED-17 (پیاده‌سازی Queue: Phase 02) | ✅ |
| 47 | Database Entities | Phase 02 (DATABASE.md) — اشاره PRD §5 | ⏳ فاز 02 |
| 48 | Soft Delete | BR-PRV-01 | ✅ |
| 49 | Backup | NFR-REL-01 (Phase 05) | ✅ (تعریف) |
| 50 | Docker | NFR-DEV-01 (Phase 05) | ✅ (تعریف) |
| 51 | Environment/Secrets | NFR-SEC-04 · C · AC-NFR-07 | ✅ |
| 52 | ساختار GitHub | Phase 05 | ⏳ فاز 05 |
| 53 | Git Strategy | قاعده Commit چارتر + PRD | ✅ |
| 54 | Testing | AC کامل + فاز 04 Test Plan | ✅ (طرح) |
| 55 | تست Workflow E2E | UC §4 GP-1..GP-6 | ✅ |
| 56 | Failure Handling | UC §5/§6 (۳۲ EC + ۱۱ Failure) | ✅ |
| 57 | Observability | NFR-OBS-* | ✅ (تعریف) |
| 58 | Performance/Scaling | NFR-PERF/SCAL | ✅ |
| 59 | Privacy/Compliance | FR-PROF-06 · BR-PRV-04/05/12 · PRD C1 | ✅ |
| 60 | AI Evaluation | FR-AI-D-08 | ✅ |
| 61 | AI Versioning | FR-AI-03 · BR-MED-10 | ✅ |
| 62 | Explainability | PRD P2 · FR-AI-03/06 | ✅ |
| 63 | جلوگیری Leakage | BR-PRV-11 | ✅ |
| 64 | Admin Controls | FR-ADM-* | ✅ |
| 65 | Pricing Rules | BR-FIN-03/08 · FR-ADM-06/07 | ✅ |
| 66 | Prescription Restrictions | BR-MED-03 · ED-07 | ✅ |
| 67 | Search Engine Scale | ED-23 | ✅ |
| 68 | Multi-Tenant Readiness | ED-22 | ✅ |
| 69 | Internationalization | NFR-I18N-01 · BR-I18N-03 | ✅ |
| 70 | Accessibility | NFR-A11Y-01 | ✅ |
| 71 | Local Development | NFR-DEV-01 | ✅ |
| 72 | VSCode | NFR-DEV-01 (پیکربندی موجود) | ✅ |
| 73 | Seed Data | BR-PRV-07 | ✅ |
| 74 | Documentation | فاز 01 + برنامه فازها | ✅ |
| 75 | Deployment | Phase 05 | ⏳ فاز 05 |
| 76 | CI/CD | NFR-CICD-01 | ✅ (تعریف) |
| 77 | Security Scanning | AC-NFR-07 · NFR-SEC-03 | ✅ (تعریف) |
| 78 | Database Migration | PRD C4 | ✅ |
| 79 | Concurrency | BR-WF-03 · BR-FIN-01 · ED-24 · EC | ✅ |
| 80 | UX کارشناسان سه‌ستونی | FR-QUEUE-06 · AC-CASE-09 | ✅ |
| 81 | AI Human Review Interface | FR-AI-06 · UC-08 | ✅ |
| 82 | Data Feedback Loop | FR-FUP-04 · UC-19 | ✅ |
| 83 | ضد خودآموزی خطرناک | BR-MED-08 | ✅ |
| 84 | کیفیت کد | NFR-MAINT-01 | ✅ |
| 85 | API Contract/Versioning | NFR-MAINT-02 | ✅ |
| 86 | Error Response | NFR-API-01 · AC-NFR-02 | ✅ |
| 87 | Request ID | NFR-OBS-02 | ✅ |
| 88 | Logging | NFR-OBS-02 · BR-PRV-03 | ✅ |
| 89 | Rate Limiting | BR-PRV-09 | ✅ |
| 90 | File Security | FR-IMG-07 | ✅ |
| 91 | Data Retention | BR-PRV-12 | ✅ |
| 92 | Final Deliverables | PRD §12 Roadmap | ✅ |
| 93 | GitHub Repo Clean | Phase 05 · قاعده Commit | ⏳ فاز 05 |
| 94 | Local VSCode Validation | فاز 05 چک‌لیست | ⏳ فاز 05 |
| 95 | Production Checklist | فاز 05 + PRD C1 | ⏳ فاز 05 |
| 96 | ممنوعیت «باید پیاده شود» | RTM وضعیت صادقانه (I/P/R) | ✅ |
| 97 | تصمیم‌گیری ابهام | ED-01..ED-163 (فاز 01: 01..30 · فاز 02: 31..34 · فاز 03: 35..46 · فاز 04: 47..58 · فاز 05: 59..70 · فاز 06: 71..80 · فاز 07: 81..92 · فاز 08: 93..105 · فاز 10: 106..119 · فاز 11: 120..134 · فاز 12: 121..129 (تصادم ثبت‌شده) · فاز 13: 135..150 · فاز 14: 151..163 · فاز 15: 164..180) | ✅ |
| 98 | ۱۸ Milestone | PRD §12 | ✅ |
| 99 | AI Model Strategy | ED-01/25 · FR-AI-01 | ✅ |
| 100 | عدم جعل پزشکی | BR-MED-07 · ED-15 | ✅ |
| 101 | هدف نهایی | PRD P8 | ✅ |
| 102 | نحوه گزارش کار | قالب گزارش فاز | ✅ |
| 103 | معیار اتمام ۳۰گانه | AC DoD + فاز 04/05 | ✅ |
| 104 | دستور نهایی (ترتیب) | PRD §12 فازها | ✅ |

---

## 4) خلاصه پوشش و آمار

| سنجه | مقدار |
|---|---|
| بخش‌های Master Prompt پوشش‌شده در Phase 01 | ۹۸/۱۰۴ کامل · ۶ مسیر فاز 02/05 (معماری DB، استقرار، Repo، Validation — طبق نقشه فازها) |
| Functional Requirements | ۱۵۴ FR در ۲۳ دامنه (شامل ۹ FR-AI-D) |
| Non-Functional Requirements | ۲۵ NFR |
| User Stories | ۱۲۶ + ۱۶ Edge |
| Use Cases | ۳۰ + ۶ Golden Path |
| Business Rules | ۶۹ |
| Engineering Decisions | ۳۰ |
| Acceptance Criteria | ۱۵۰ (۱۲۶ دامنه‌ای + ۱۶ AC-EC + ۸ AC-NFR) |
| Edge/Exception Cases | ۳۲ EC + ۱۱ Failure Scenario |
| وضعیت کلی v1 | **I:** ~۷۲٪ · **P:** ~۲۰٪ (سرویس فازهای 02–06) · **R:** ~۸٪ (مستند و مسیر مشخص) |

**قواعد نگهداشت RTM:**

1. هر تغییر FR/US/UC/BR/AC/ED باید هم‌زمان این ماتریس را به‌روز کند (Commit واحد).
2. وضعیت‌ها فقط با شواهد تست به I ارتقا می‌یابند (فاز 04).
3. هیچ نیازمندی «یتیم» مجاز نیست: هر FR حداقل یک US یا UC و یک AC دارد.
4. بدهی‌های شناخته‌شده v1 (صداقت مهندسی — رعایت §96): پیشوند قدیمی `TC-` در داده Seed؛ قالب‌های SMS با پیشوند `TongueAI` — پاکسازی در فاز 02 (ED-27).
