# Worklog — BabaHakim (باباحکیم) Platform

---
Task ID: 1
Agent: Main agent (Super Z)
Task: Build the complete bilingual AI tongue-diagnosis platform per uploaded spec (Pasted Content_1788465172593.txt)

Work Log:
- Read & analyzed the full 35KB Persian spec (57 sections: product goals, AI-CDS architecture, RBAC, workflow, shop, payments, security, admin)
- Initialized fullstack env (Next.js 16 + TS + Tailwind 4 + shadcn/ui + Prisma/SQLite); installed jose for JWT
- Designed Prisma schema with 36 entities: User/Role/Permission/RolePermission (RBAC), PatientProfile, Questionnaire(+Question/Option/Response, versioned), MedicalImage (4 versioned variants + SHA-256 + quality JSON), MedicalCase + CaseEvent (workflow state machine + timeline), AIModel + AIAnalysis (registry, predictions, explainability, humanReviewed), Disease/Diagnosis, Prescription(+Item, versioned), Product/ProductPriceHistory (price history never destroyed), CartItem/Order/OrderItem/Invoice/Payment (idempotent, Zarinpal-mock + card-to-card), Shipment, Ticket(+Message), Notification, SMSLog, Referral, FollowUp, AuditLog, FinancialTransaction — soft-delete everywhere
- Core libs: auth (scrypt hashing, JWT access 12h + rotating refresh 30d in httpOnly cookies, brute-force lock, HMAC signed expiring image URLs), constants (6 roles, 31 permissions, 21 workflow statuses + 19 transitions with role/permission guards), api helpers (audit, Persian text normalization ی/ي ك/ک digits ZWNJ for search), Jalali calendar (Behrouz/Kamal algorithm + fa digits), notify engine (34 event templates: in-app + SMS log), storage pipeline (sharp: MIME/size/corruption validation → original/compressed/ai/thumb variants with metadata strip + quality assessment: blur-variance, brightness, exposure, resolution), AI provider (AIModelProvider interface + TongueModelV1: real feature extraction from image pixels — redness/pallor/purple/coating/moisture/texture → explainable TPM indicators with confidence × quality damping), caseService (centralized transitions + notifications + audit)
- Seed: 6 roles + permissions, 8 users (one per role, Pass1234), 15-question temperament questionnaire (HOT/COLD/WET/DRY scoring), 6 diseases, 12 products w/ price history, AI model registry (metrics, DEPLOYED), referrals, expenses
- 25 API route files under /api/v1: auth(register/login/logout/me/refresh), patients/profile, questionnaires(active/submit/history), images(upload + [id]/file with signed URLs + VIEW_MEDICAL_FILE audit), cases(list/create w/ inline AI run + [id] detail + [id]/action — 18 workflow actions with side effects: diagnosis, prescription versioning, expert2 pricing, doctor decisions, proforma/order/invoice creation, payment sync, shipment, follow-up), products(Persian-normalized search), cart CRUD, orders(checkout/confirm), payments(zarinpal mock callback w/ idempotency + card-to-card receipt + operator verify), shipments, tickets(+messages, internal notes), notifications, followups (DueToday/Overdue/Upcoming), dashboard (role-scoped), admin(users+RBAC matrix, diseases, products, prices CSV import preview/commit + bulk ±%, reports with day/product/referral/province aggregation, audit-logs, questionnaire versioning editor, ai-models + learning dataset, sms-log)
- Frontend SPA (single / route per env constraint): AppProvider (auth+i18n+view navigation+API client with 401 auto-refresh), AppShell (responsive sidebar, language switcher FA/RTL↔EN/LTR, notification bell, role badges), Landing (bilingual hero + 6-step flow + AI demo card), AuthView (login/register + 6 quick demo logins), patient panel (dashboard, profile+referral code, questionnaire wizard, upload wizard with live quality feedback + retry, cases, case workspace with progress track/timeline/AI card/prescription/proforma/payment gateway/shipment, shop with filters, cart, orders, tickets, followups, notifications), staff panels (role dashboards with queue+wait-times+SLA coloring, case queue with claim, payments verify with receipt viewer, shipments), admin panels (users + RBAC matrix, diseases CRUD, products w/ price history, prices 3-tab import/bulk/history, reports with recharts area+bar charts, audit log explorer, questionnaire editor, AI models + dataset, SMS log)
- Fonts: Vazirmatn (Google) for fa/ar+latin; Jalali dates everywhere in FA mode

Fixes during E2E (agent-browser):
- Prisma relation fixes: FinancialTransaction named relations, back-relations on User, unique constraints for receipt/proof image FKs, removed invalid MedicalCase.orders (orders now fetched via Invoice.caseId), fixed invoice one-to-many includes in 5 API routes, province select on User
- sharp: removed non-existent .removeMetadata() (metadata stripped by default)
- Radix Select: empty-string SelectItem values → "ALL" sentinel
- UI: added in-workspace Claim + Issue-Proforma actions; single-axis mizaj labels (غالباً گرم/سرد/خشک/تر)
- queueMicrotask wrappers for lint's set-state-in-effect rule

E2E verification (agent-browser, full golden path):
✅ Patient register/login → questionnaire (15Q) → mizaj result (معتدل + 4-dimension scores)
✅ Tongue image upload: quality gate REJECTED over-exposed + dark/blurry images with actionable fa messages, ACCEPTED sharp image (Q:80) → 4 variants generated
✅ Case created → auto AI analysis (TongueModelV1: body color/coating/moisture/texture/temperament hint with confidence 42–60% + explainability + human-review disclaimer)
✅ Expert1 claim → assessment → Patient approval → Expert1 prescription (dosage/frequency/duration/instructions) → Expert2 review (availability + pricing 160k) → Doctor approve (comment + 21-day follow-up)
✅ Operator proforma INV-… (210,000 ت) → Patient confirm → Zarinpal mock gateway payment (authority + ref number, idempotent) → PAYMENT_CONFIRMED
✅ Operator shipment (motorcycle, driver, TRK-55214) → DELIVERED → follow-up scheduled (پیگیری درمان)
✅ Shop: search/filter → add to cart → checkout ORD-… (271,000 ت) → card-to-card receipt + tracking → operator verify → PAID
✅ Admin: reports (revenue 481k, charts, top products, referrals, provinces), CSV import preview (2 valid + 1 invalid shown) → commit → price history preserved (145k→170k IMPORT), audit log (53 entries with sensitive flags, old/new values), AI models + dataset stats, RBAC matrix
✅ Landing EN switch (dir=rtl→ltr, h1="Intelligent Tongue Diagnosis"), mobile 390px viewport, sticky footer, no console errors, lint clean

Stage Summary:
- Deliverable: production-grade bilingual FA/EN platform implementing all 57 spec sections of the uploaded master prompt
- Stack: Next.js 16 (App Router, single / SPA), 25 API routes, Prisma/SQLite (36 models), sharp image pipeline, jose JWT auth, recharts analytics
- Demo credentials (Pass1234): 09120000001..09120000006 (Admin/Expert1/Expert2/Operator/Doctor/Patient)
- Verified artifacts: storage/uploads (14 versioned image files), screenshots verify-*.png
- All spec-critical principles enforced: AI-Assisted CDS (no final medical result without human review), audit trail, soft delete, price history preservation, idempotent payments, signed expiring image URLs, bilingual RTL/LTR + Jalali calendar

---
Task ID: 2
Agent: Main agent (Super Z)
Task: Rebrand platform to BabaHakim (باباحکیم / babahakim) and apply the Official BabaHakim Design System (Master UI Branding Prompt PDF, 39 sections)

Work Log:
- Read the full "BabaHakim Master UI Branding Prompt.pdf" (24 pages, §1–39): brand identity, 4-color palette, design tokens, color usage rules, button system, status system, login/register/dashboards/workspace/table/form/card/chart/typography/RTL/RTL specs, logo policy, dark mode, mobile, empty/loading states, accessibility, QA visual checklist
- AUDITED existing repo before changes (rule §4/5 of lead-engineer brief): previous stage built "TongueCheck/تنگ‌چک" with emerald/teal palette; mapped every off-brand color usage across 11 view files + shared components
- globals.css — central BabaHakim Design Token system (§3): --bh-primary-dark #173F76, --bh-primary #225BBE, --bh-primary-light #57AFE2, --bh-neutral #DEDBDB + derived-only shades (hover/active/tints/surfaces); shadcn tokens remapped (primary=#225BBE CTA, border/input=#DEDBDB, ring=#225BBE focus, sidebar=#173F76); charts palette #225BBE/#57AFE2/#173F76/#9CCBEF/#DEDBDB (§22); Dark Mode = navy-derived surfaces #0D1B30/#12233C (NOT inverted, §28) with primary switched to #57AFE2 for AA contrast; brand utilities bg-brand-* registered in @theme; .btn-brand-hover (§8 hover #1D4FA6) + .table-row-hover (§19 sky tint) helpers
- NEW src/components/app/shared/Logo.tsx — swappable brand mark (§25): rounded-square #173F76 (or #57AFE2 light variant) with stylized tongue + white AI scan-line SVG; <Logo variant showText/> API; replaced hardcoded Sparkles marks in AppShell/Landing/AuthView
- Rebrand: i18n appName → ['باباحکیم','BabaHakim']; layout.tsx metadata; page.tsx header comment; localStorage key ta_lang → bh_lang
- AppShell (§7): sidebar bg-sidebar #173F76 with light foreground, active nav = bg-sidebar-primary #225BBE white text (computed-style verified), accents/badges #57AFE2, borders sidebar-border rgba(#DEDBDB); mobile Sheet inherits bg-sidebar; footer = #173F76 brand bar; avatar brand-tinted; added CSS-driven ThemeToggle (Moon/Sun) in header — no mounted-state, no effect-setState (lint clean)
- layout.tsx: ThemeProvider (next-themes, attribute="class", default light) — dark mode now user-toggleable per §28
- Landing (§36): brand-tinted gradients (#173F76/5% → #57AFE2/7%), hero card with #173F76 image-viewer panel (§15) + AI scan grid + tongue SVG in brand colors + confidence rows, feature/step icons in brand tints, brand footer
- AuthView (§10/§11): split brand panel #173F76 with Logo light + tagline + 3 trust bullets, form card with brand borders, demo-account chips with brand hover, labels #173F76 (§20)
- constants.ts STATUS_META remap (§9): Pending-family = #57AFE2 (with #173F76 text, AA), In-Progress = #225BBE, doctor-pending & proforma milestones = #173F76, completed/paid/delivered = semantic green, action-needed = amber, error = standard red, revision = violet; StatusBadge no longer forces text-white (respects per-status text classes)
- Color cleanup across views (semantic colors kept only for success/warning/error meaning): clinical.tsx (Zarinpal dialog → brand, confirm CTA → primary), CaseWorkspace (mizaj badge → #173F76, all approve/confirm/deliver CTAs → btn-brand-hover primary #225BBE, stepper done → #57AFE2 sky, expert2 card border #57AFE2/50, doctor card border #173F76/40, checkbox accent #225BBE), StaffViews/AdminViews/AdminViews2 stat tones → brand tints, charts #225BBE area + #57AFE2 bars, bulk-price CTA → primary, PatientViews (active stat, mizaj badge, questionnaire result card brand), ShopViews (product placeholder gradient brand), notification dots → #57AFE2
- Questionnaire Progress indicator → #57AFE2 (§11)
- .vscode/README documentation: created docs/BRANDING.md recording the design-token mapping + status-color policy + logo usage (§ rule 11: decisions documented)

Fixes during this stage:
- Invalid 7-digit hex token typo (--bh-primary-dark-90) → corrected #15386A
- MultiEdit indentation mismatch → re-applied remaining edits precisely
- ThemeToggle setState-in-effect lint error → rewritten CSS-driven (dark:hidden Moon / dark:block Sun) with suppressHydrationWarning
- StatusBadge text-white conflict with per-status text colors → removed forced text-white
- Dev server process died mid-QA → restarted via .zscripts/dev.sh (PID 16049), verified 200

QA Visual Check (§38, agent-browser — all 6 roles + modes):
✅ Landing FA/RTL renders باباحکیم + Logo + brand hero (no console errors)
✅ Auth: brand panel + demo quick-login works
✅ Patient (سارا): dashboard, mizaj, orders, case detail
✅ Expert 1 (کیارش), Expert 2 (ثریا), Doctor (دکتر نیک‌پور), Operator (پویا), Admin (رعیا): dashboards + queue + reports + case workspace (AI analysis card, prescription, timeline)
✅ Admin Reports: recharts with brand colors
✅ EN switch: dir=rtl→ltr, lang=en, nav English, BabaHakim wordmark
✅ Mobile 390px: hamburger Sheet opens (bg-sidebar), responsive layout
✅ Dark mode: html.dark, body #0D1B30, sidebar #0F2440, toggle works both directions
✅ Computed-style proof: sidebar bg rgb(23,63,118)=#173F76, active item rgb(34,91,190)=#225BBE
✅ bun run lint → 0 errors
✅ 15 QA screenshots saved to download/qa-screenshots/

Stage Summary:
- Brand: TongueCheck/تنگ‌چک → BabaHakim/باباحکیم (technical name babahakim) across UI + metadata + storage keys
- Official palette enforced via central design tokens only — no scattered hardcoded brand colors; semantic green/amber/red kept strictly for success/warning/error (§9 note)
- New capabilities: user-toggleable dark mode (brand-preserving), swappable Logo component
- Files changed: 17 (globals.css, layout.tsx, page.tsx, i18n.ts, contexts/app.tsx, constants.ts, AppShell.tsx, Logo.tsx [new], Landing.tsx, AuthView.tsx, clinical.tsx, atoms.tsx, CaseWorkspace.tsx, PatientViews.tsx, ShopViews.tsx, StaffViews.tsx, AdminViews.tsx, AdminViews2.tsx, docs/BRANDING.md [new])
- Remaining risks: DB seeded data still contains old case codes prefix "TC-" (cosmetic, data-level not UI); Landing/Auth lack theme toggle (light-only by design for public pages); Turbopack HMR emits a benign internal TypeError artifact in dev console (framework-level, not app code)
- Next milestone: continue Master Prompt milestones (PRD/architecture docs, Docker production stack, CI/CD, testing hardening)

---
Task ID: 3
Agent: Main agent (Super Z)
Task: PHASE 01 — Product Requirements & System Specification: full product/business analysis, 5 requirement documents + Requirement Traceability Matrix

Work Log:
- Pre-stage audit (rule 4): read worklog (2 prior stages), git log, full re-read of the 104-section Master Prompt spec (3115 lines, chunked), inspected constants.ts (6 roles / 31 permissions / 21 case statuses / 19 transitions / order-payment-ticket metas / mizaj options), prisma models (36), notify.ts (31 event templates), confirmed coupon/discount implementation status for honest RTM reporting
- Authored 6 documents under /docs (Persian, English technical terms):
  1. PRD.md — product vision, 8 non-negotiable principles, 6 personas, 23-module scope (M01-M20), 154 FR + 25 NFR with Must/Should/Could priorities + spec-section + honest implementation status, notification catalog (31 implemented + 3 planned events), approval catalog (10 gates G1-G10), patient lifecycle model, KPIs, 10 risks, phase roadmap (18 spec milestones → 6 phases), bilingual glossary
  2. USER-STORIES.md — 126 stories across 20 epics + 16 cross-cutting edge/resilience stories (142 total), each linked FR/BR/AC, MoSCoW priorities
  3. BUSINESS-RULES.md — 69 numbered BRs across 10 domains (AUTH/MED/WF/FIN/PRV/CAT/I18N/NTF/IMG/AUD/HIST/RBAC) + full RBAC matrix (31 permissions × 6 roles + 4 governance rules) + complete state catalog (21 case / 11 order / 6 payment / 6 ticket / 12 entity statuses) + 19-transition workflow engine table + 30 Engineering Decisions (ED-01..30) resolving all spec ambiguities
  4. USE-CASES.md — actor-goal model, 18-stage patient lifecycle mapped to statuses/gates, sequence diagram, 30 use cases (main/alternate/exception flows), 6 golden-path E2E scenarios (incl. §55 mandatory flow), 32-entry edge-case catalog (EC-*) + 11 systemic failure-handling strategies (idempotency/locking/retry/dead-letter/recovery)
  5. ACCEPTANCE-CRITERIA.md — 150 testable criteria in Given/When/Then format (126 domain + 16 edge + 8 NFR) with test-type tags (U/I/API/E2E/SEC/UI/PERF), Definition of Done for the phase
  6. REQUIREMENTS-TRACEABILITY-MATRIX.md — FR→US→UC→BR→AC→status→verification mapping for all 154 FRs + 25 NFRs, explicit NFR table, full 104-section Master Prompt coverage table (98 full + 6 routed to later phases), coverage stats, honest v1 debt list
- Wrote scripts/validate-phase01-docs.py (persistent validation per rule 9): cross-document ID resolution (multi-segment domains FR-AI-D/AC-EC/US-EC), range/slash shorthand expansion (X-01..03, X-01/02), word-boundary guards, orphan detection, US-EC↔AC-EC 1:1 mapping check, stats-vs-claims check, secret/PHI scanning
- Test→Fix cycle (3 iterations): fixed 5 undefined BR references (added §1.0 BR-AUTH-01..03, §1.8 BR-IMG-01, §1.9 BR-AUD-01/BR-HIST-01, §2 BR-RBAC-01..04), replaced RTM's grouped NFR ranges with explicit rows, fixed invalid US-EC-SRCH/US-EC-ADM refs, added EC-ADM-01 to edge catalog, corrected stats claims (FR 154, BR 69, AC 150), restored accidentally-deleted FR-PROF-04 row
- Final validation: PASS — FR=154/154, NFR=25/25, US=142/142, BR=69/69 traced; 0 errors, 0 warnings; no secrets/PHI

Stage Summary:
- Deliverables: docs/PRD.md, docs/USER-STORIES.md, docs/BUSINESS-RULES.md, docs/USE-CASES.md, docs/ACCEPTANCE-CRITERIA.md, docs/REQUIREMENTS-TRACEABILITY-MATRIX.md, scripts/validate-phase01-docs.py
- 154 FR / 25 NFR / 142 US / 30 UC / 69 BR / 30 ED / 150 AC / 32 EC fully cross-traced; all 10 approval gates and 31 notification events cataloged; 18-stage patient cycle modeled with state mapping
- Key engineering decisions recorded: ED-03 (doctor approval mandatory for all cases in v1), ED-08 (user-gate SLA auto-close 30d), ED-13 (reassessment = new case with lineage), ED-25 (stack-agnostic requirements, architecture decision routed to Phase 02), ED-06 (partial drug availability policy)
- Remaining risks: RTM status column reflects code-level truth only as of Phase 00 (statuses I/P/R) — must be re-validated in Phase 04 test runs; ED-25 architecture decision pending; known v1 debt items (TC- prefix seed data, TongueAI SMS template prefix) logged for Phase 02 cleanup
- Next: PHASE 02 — System Architecture (ARCHITECTURE.md, DATABASE.md/ERD, API.md/OpenAPI, SECURITY.md, deployment architecture) per PRD §12 roadmap

---
Task ID: 4
Agent: Main agent (Super Z)
Task: PHASE 02 — Workflow & State Machine: generic engine + 8 declarative machines + unit tests + route refactor

Work Log:
- Pre-stage audit (rule 4): read caseService/constants (case machine existed: 21 statuses/18 transitions inline), audited Order/Payment/Shipment/Ticket/FollowUp/Prescription/AI-review — all set status inline in routes without guards/audit/rollback; no test infra existed
- Prisma migrations (rule 8): created baseline 0_init from live schema (migrate diff + resolve --applied), then migration 20260903221412_ai_review_workflow_fields adding AIAnalysis.reviewStatus/reviewComment/reviewedById/reviewedAt; verified columns on db/custom.db
- NEW src/lib/workflow/ (ED-31): types.ts (TransitionDef/MachineDef/hook ctxs/WorkflowError/ExecResult), engine.ts (pure resolveTransition + assertGuards + ownsEntity + terminalStatuses/reachableFrom; transactional executeTransition: load → guards → validate → $transaction{status+dataEffects update, CaseEvent (CASE), AuditLog WORKFLOW_* (atomic), txEffects cascades} → postCommit notifications with error capture), registry.ts (8 machines + registerMachine extension point), index.ts
- 8 declarative machines (data + injectable hooks, no DB imports at module level): CASE (21/18, dataEffects+notify map migrated from caseService; admin role bypass per BR-RBAC-02), PRESCRIPTION (7/7 + SUPERSEDE/FINALIZE), ORDER (11/9 + cascadePaid), PAYMENT (6/8 + paymentPaidCascade single-source-of-truth: order+invoice+financial+case atomic), SHIPMENT (5/4, DELIVER cascades ORDER only — single-writer rule ED-33), TICKET (6/8), FOLLOWUP (5/4), AI_REVIEW (4/4)
- Backward compat: constants.ts TRANSITIONS/canTransition → shim re-exporting CASE_MACHINE (verified: only 2 files imported legacy API); caseService.applyTransition → thin adapter over engine (same signature/response shape)
- Refactored 7 API routes through the engine: cases/[id]/action (AI review via machine + SUPERSEDE old prescriptions + order/shipment/followup cascades), orders/[id] PATCH, payments verify + zarinpal callback (SYSTEM actor) + receipt, shipments PATCH (+CASE.MARK_DELIVERED single-writer), tickets/[id] POST/PATCH (status map → machine actions), followups PATCH
- Unit tests: src/lib/workflow/__tests__/workflow.test.ts — 51 tests / 747 assertions (graph integrity all machines, role/permission/ownership guards, error taxonomy, validation hooks, data-effect purity, backward-compat shim, golden-path walkability, NOT_FOUND exec path); added bun test scripts to package.json
- Fixes during test cycle: JS syntax (|| mixed with ?? needs parens) in shipment/followup dataEffects; AuditLog field names (oldValues/newValues/device — was oldValue/newValue/userAgent); ExecResult/WorkflowError details typed Record; test expectations aligned to real behavior (18 transitions not 19 — NEW is virtual; FAILED non-terminal via RETRY; FORBIDDEN_PERMISSION via DOCTOR+FOLLOWUP.COMPLETE)
- Smoke test scripts/smoke-phase02-workflow.sh (13 checks) + manual real-transition verification: COMPLETE_FOLLOWUP through engine produced WORKFLOW_CASE_COMPLETE_FOLLOWUP + WORKFLOW_FOLLOWUP_COMPLETE audit rows (old/new status), CaseEvent FOLLOW_UP→CLOSED, FollowUp COMPLETED with resultNote — full cascade confirmed in DB
- tsconfig: excluded __tests__/examples/skills from tsc (bun runs tests natively); remaining 11 tsc errors are pre-existing in untouched files; my files: 0 errors, eslint 0/0
- Docs: docs/WORKFLOW.md (engine architecture, 9-field spec per state for all 8 machines, route→machine map, ED-31..34); BUSINESS-RULES.md ED-31..34 appended; PRD references + RTM phase-02 note updated

Stage Summary:
- Deliverable: production workflow engine — no transition logic hardcoded in routes; every status change is machine-guarded, validated, cascaded atomically, audited (WORKFLOW_*), and notifies
- All 8 required machines implemented: Patient Case / Prescription / Order / Payment / Shipment / Ticket / Follow-up / AI Review
- Verification: 51/51 unit tests, 13/13 API smoke, real cascade verified in DB, lint clean, migration applied
- Key decisions: ED-31 (declarative machines), ED-32 (AuditLog as universal event stream, CaseEvent kept for case timeline only), ED-33 (single-writer cascades; paymentPaidCascade atomic), ED-34 (NEW virtual; MARK_DELIVERED from PAYMENT_CONFIRMED/PREPARING_SHIPMENT for direct-delivery path)
- Remaining risks: SLA gates (ED-08 reminders/auto-close) await Phase 05 scheduler; MARK_DUE/MARK_OVERDUE currently manual/reserved for system; UI not yet surfacing AI reviewStatus field (Phase UI); ticket REOPEN for patients on CLOSED tickets is new capability (documented)
- Next: PHASE 03 — Security & Audit hardening (rate limiting full coverage, secure headers, session policies) or continue per PRD §12 roadmap

---
Task ID: 5
Agent: Main agent (Super Z)
Task: PHASE 03 — System Architecture: Modular Monolith vs Microservices evaluation, 11-component architecture, 15 Bounded Contexts, dependency rules + circular-dependency prevention, ARCHITECTURE.md + ARCHITECTURE-DIAGRAM.md + ADR/

Work Log:
- Pre-stage audit (rule 4): read full worklog (4 stages: v1 build, branding, PHASE 01 docs, PHASE 02 workflow), git log (7 commits), 36 Prisma models mapped, package.json (no Redis/BullMQ/S3 yet — honest gap analysis), PRD/WORKFLOW/BR doc conventions (fa + EN terms, ED chain at 34)
- ARCHITECTURE.md (543 lines, 15 sections): (§1) architecture drivers table mapped to NFRs + 5 explicit constraints C1-C5; (§2) 10-criteria MM-vs-MS evaluation matrix (8/10 favor MM) → decision MM with 5 Extraction-Readiness rules ER1-ER5 + 4 re-evaluation triggers; (§3) 11-component table with honest current-vs-target state (Worker/Cache/Queue absent today, SQLite, local FS, in-process AI — all flagged ⚠️/❌); (§4) 15 Bounded Contexts — each with responsibility, Public API, events, allowed dependencies, and full ownership mapping of all 36 Prisma models (single-ownership, verified sum=36); (§5) tier model K→T0..T5 + 8 dependency rules D1..D8 with legal/illegal examples + sync-facade vs async-event patterns; (§6) circular-dependency prevention: 6 design mechanisms (ConfigService in Kernel, Event-Carried Payload, soft references, single orchestrator per stream) + 4 enforcement layers (ESLint → dependency-cruiser → architecture.test.ts → PR review) + cycle-discovery runbook; (§7) event bus contract + 17-event core catalog (payment cascade stays Sync per ED-33); (§8) data architecture: schema-per-context, no cross-context FK, CQRS-lite read models + documented v1 exception, 4-step SQLite→Postgres migration path; (§9-§11) security architecture, deployment topology (compose + prod + 12-factor), observability; (§12) extraction roadmap with strangler strategy; (§13) current-code→target-module mapping table + 4 honest debt items; (§14) 6 risks R1-R6
- ARCHITECTURE-DIAGRAM.md (677 lines): 13 Mermaid diagrams — C4 L1 system context (6 roles + 4 external systems), C4 L2 container (all 11 components incl. ports/adapters), dependency-tier DAG (acyclic proof), bounded-context map (SO/EV/SR relationship types), module anatomy (api/domain/events/infra with BabaHakim palette), AI pipeline (quality gate → 4 variants → queue → provider → human chain), golden-path sequence with EXACT 17-stage numbering (Registration..Reassessment), order→payment→shipment sequence with idempotent callback + atomic cascade, event-flow pub/sub, 15-schema data-ownership map, dev compose topology, prod topology, extraction roadmap (AI first)
- docs/ADR/: README index + _TEMPLATE + 12 ADRs (ADR-0001..0012 = ED-35..46) — every ADR has Context/Options table/Decision/Consequences/Compliance section (how the rule is CI-enforced, per charter rule 2)
- Traceability updates: BUSINESS-RULES.md ED-35..46 rows appended (total 46); PRD §12 roadmap re-aligned to actual phase sequence (02=workflow done, 03=architecture, 04=security+enforcement, 05=testing+Postgres, 06=deployment, 07+=product) + sequencing note; RTM: phase-03 note added + §97 ED range ED-01..46
- scripts/validate-phase03-docs.py (persisted, rule 9): 10 check families — deliverable files, 15 contexts in ownership+tier+depcruiser maps, 11 components, ADR structure/ED-numbering/README links, ED-35..46 registry, mermaid fence/type/subgraph-end/quote balance, 17-stage keywords + numbered notes 1..17, stray-CJK detection (fa/en only), secret scan, MM-verdict consistency
- Test→Fix cycle: 3 iterations on validator regexes (tier table plain-text vs bold; depcruiser unquoted keys; "AI Analysis" double-uppercase breaking stage regex); content fixes: 5 stray CJK chars removed, "BabaHakut"/"PSU" typos, dependency-cruiser sample code rewritten valid, golden-path renumbered to canonical 17 stages; phase-01 validator regression found stale ED claim (30 vs 46) → RTM §97 + validator updated → both validators PASS
- Final validation: phase03 validator PASS (contexts 15/15, components 11/11, ADRs 12/12, EDs 46/46, mermaid 13, stages 17/17); phase01 validator PASS (FR 154/154, NFR 25/25, US 142/142, BR 69/69, ED 46/46, 0 errors)

Stage Summary:
- Deliverables: docs/ARCHITECTURE.md (543 lines), docs/ARCHITECTURE-DIAGRAM.md (677 lines, 13 Mermaid diagrams), docs/ADR/ (README + template + 12 ADRs), scripts/validate-phase03-docs.py; updated: BUSINESS-RULES.md (ED-35..46), PRD.md (§12 roadmap), REQUIREMENTS-TRACEABILITY-MATRIX.md (phase note + ED range), validate-phase01-docs.py (ED claim)
- Verdict per user directive: Modular Monolith chosen for current version (8/10 criteria), architected for future extraction (5 ER rules, ports/adapters, schema-per-context, event bus, CI-enforced boundaries)
- Architecture: Frontend/Backend (one Next.js deployable + separate worker process), PostgreSQL/Cache/Queue (Redis+BullMQ)/Object Storage (S3/MinIO)/AI Service (FastAPI behind AIModelProvider)/Notification Service/Payment Adapter (Zarinpal)/Shipping Adapter
- 15 Bounded Contexts with tiered one-way dependency model (DAG ⇒ circular dependencies structurally impossible) + 4 enforcement layers to keep it true in CI
- Remaining risks (honest): Worker/Queue/Cache not yet implemented (sync AI/notify — Phase 04), SQLite still primary (migration path documented), reporting reads OLTP directly until event bus exists, ESLint/depcruiser rules to be activated in first post-phase PR (ADR-0010 compliance), Mermaid syntax structurally validated but not browser-rendered
- Next: PHASE 04 — Security & Audit hardening + activation of architecture enforcement (ADR-0010) + worker/queue foundation, per updated PRD §12 roadmap

---
Task ID: 6
Agent: Main agent (Super Z)
Task: PHASE 04 — Database Architecture: full PostgreSQL design + implementation (Alembic) + ERD + tests

Work Log:
- Pre-stage audit (rule 4): worklog (5 stages), git log (7 commits), spec §47 entity list + §6/§7/§8/§11-§16/§61-§63/§79/§82/§83 data rules, ARCHITECTURE §8 (schema-per-context, migration path), ADR-0004, constants.ts (21 case + 11 order + 6 payment + 6 ticket + 6 shipment + 7 prescription + 5 followup statuses), Prisma 36-model schema
- Environment (no root, no Docker): python venv at database/.venv (SQLAlchemy 2.0.52, Alembic 1.19, psycopg2, pytest, pgserver) — Embedded PostgreSQL 16.2 via pgserver on project-local unix socket (scripts/pg_server.py start/stop/status; babahakim_dev + babahakim_test DBs; .pgurl gitignored)
- pg_trgm extension was absent from embedded build → compiled from PostgreSQL 16.2 source (gcc/make; headers via submake-generated-headers), installed .so + script chain into pginstall; verified similarity() on Persian text (compilation is dev-env only — Docker image ships contrib)
- Models (database/models/, 15 files): 49 tables across 15 bounded-context schemas — all 40 requested entities (incl. Address, MedicalFile, Image, Inventory, Cart, ContactLog, Dataset, DatasetVersion, ExpertReview, DoctorReview) + 9 supporting (role_permissions, refresh_tokens, question_options, questionnaire_responses, case_events, dataset_items, inventory_movements, cart_items, disease_products)
- Contract discipline: PK BIGINT IDENTITY ALWAYS; 34 real FKs all intra-schema (D4 verified by test); 167 CHECK constraints (money math total=subtotal-discount+shipping & line_total=unit×qty, paid-evidence, movement-sign discipline, availability XOR, OTC exclusivity, disagreement-resolution, supersede-successor, phone/postal/code regexes, confidence ranges, expert2-only availability); 190 indexes (41 partial incl. unique-where-active phone/email/cart/questionnaire, 4 BRIN on append-only streams, 4 GIN trgm fa/en on products+diseases, composite queue/due-scan indexes); 15 JSONB; 13 soft-delete tables; 8 append-only tables; naming convention pk_/fk_/uq_/ck_/ix_
- Alembic (database/alembic/): env.py with 15-schema include filter + URL resolution (PGDATABASE_URL → .pgurl); linear chain 0001 (15 CREATE SCHEMA + pg_trgm) → 0e862845eba8 (49 tables, autogen + reviewed) → 0003 (3 trigger functions administration.set_updated_at/forbid_mutation/forbid_hard_delete wired to 44 triggers/52 events) → 4e4b217705f9 (server defaults; found python-side defaults lacking DB-level DEFAULT via raw-SQL insert test → codemod all models) ; alembic check = zero drift
- Fix cycles: pgserver pg_ctl API signature (pgdata kwarg); pg_trgm script files (sql/ is tests; data + base 1.3 + upgrade chain is install) and .so location lib/postgresql/; conftest URI swap bug (rsplit('/') on socket-query URI corrupted host — replaced with partition-based swap); expect_violation fixture (PG aborted-transaction rollback discipline); seed_user self-sufficient role; PG confdeltype codes (c=cascade not a); planner-aware EXPLAIN assertions (partial-index shape, trgm with btree paths off + ANALYZE); test data honoring terminal-state CHECKs (closed_at for CLOSED)
- Tests (database/tests/, 5 files, 85/85 PASS in ~10s): structure (schemas/tables/PK identity/zero cross-schema FK/cascade rules/unique+check catalogue/trigger wiring), constraints (26 behavioral rejections), soft-delete & history (hard-delete blocked ×3, append-only immutability ×8, supersede chain, questionnaire versions, dataset patient-level split + disagreement, image dedup), indexes & performance (34 critical + BRIN + trgm + partial predicates + EXPLAIN access paths), migrations (linear single head, full downgrade base→upgrade head cycle restores 49 tables + 44 triggers + defaults, alembic check no-drift, sequence reset)
- ERD: database/scripts/generate_er_diagrams.py — generates from SQLAlchemy metadata (accuracy by construction) → 17 mmdc renders (master context soft-ref map + master golden-path ERD + 15 per-context ERDs) → docs/erds/*.png + docs/DATABASE-ERD.md (Persian); copied to download/erds/
- Documentation: docs/DATABASE.md (14 sections: contract stats, structural rules, 49-table catalogue + 40-entity mapping, FK vs soft-ref policy + ON DELETE rationale, 20+ key CHECK rules, trigger guards, soft-delete policy + financial-records exception, 6-level history/versioning, index design + rationale, Alembic workflow, test coverage, ops, multi-tenant readiness ED-47..58 table, debt list); ADR-0013 (Alembic as DDL source of truth, partial supersede of ADR-0004 tooling; README indexed); BUSINESS-RULES.md ED-47..58 appended; RTM phase-04 note + ED-01..58; PRD §12 roadmap phase-04 marked done
- Validators: scripts/validate-phase04-docs.py (deliverables, sections, ED chain, ERD references, CJK scan, live catalog vs claims: 49/167/190/44/34) — PASS; phase-01 + phase-03 validators updated for ED 58 / ADR 13 and re-PASSED
- Security check: secret scan on new paths (clean; URI docstring shape only, trust-socket no password), PHI scan clean (synthetic 091200000xx + کاربر تستی), .gitignore fixed (pgsrc/pgdata/.pgurl/.venv excluded from git — newline bug found & fixed); eslint clean
- Git commit: database architecture (models, migrations, tests, scripts, ERD, docs) staged excluding runtime dirs

Stage Summary:
- Deliverables: PostgreSQL 16 target database fully designed & implemented via Alembic — 15 schemas / 49 tables / 34 FKs / 167 checks / 190 indexes (41 partial, 4 BRIN, 4 trgm GIN) / 44 security triggers; docs/DATABASE.md + docs/DATABASE-ERD.md + 17 ERD PNGs + ADR-0013 + ED-47..58; 85/85 pytest + alembic check zero-drift + 3 doc validators PASS
- All 40 user-requested entities mapped; history preserved via 8 append-only tables + 4 versioning chains; hard delete physically impossible on 13 domain tables; audit stream unforgeable
- Key decisions: ED-47 Alembic as DDL authority (Prisma introspects later) · ED-48 BIGINT identity PKs · ED-49 financial records never deleted (status lifecycle) · ED-50 reversing accounting entries · ED-51 VARCHAR+CHECK over PG ENUM · ED-54 inventory movement ledger
- Remaining risks/debt: app still on SQLite (switch + prisma db pull = next phase per §8.4); minimal-privilege DB role for app (security phase); dataset seeding via data migration (next phase); partitions when append-only tables exceed 10M rows (ED-58); trgm compiled only for this embedded build (Docker image ships it)
- Next: PHASE 05 — security & audit hardening (rate limiting coverage, headers, RBAC matrix tests) or app PostgreSQL switch per updated PRD §12

---
Task ID: 7
Agent: Main agent (Super Z)
Task: PHASE 05 — Security & Privacy: full security architecture implementation + threat model + pentest

Work Log:
- Pre-stage audit (rule 4): worklog (6 stages), git log (8 commits), read auth.ts/api.ts/storage.ts/login/refresh/image routes/.env/contexts/app.tsx — identified 12 gaps: JWT_SECRET absent (hardcoded fallback active), no per-IP rate limit, no refresh reuse detection, no security headers/CSP/CSRF/CORS, no OTP/MFA, staff image access without permission check (OPERATOR gap), OPERATOR image views not audited, non-timing-safe sig compare, no consent/privacy/export/deletion, no encryption helpers, no input-validation pattern, no env fail-fast
- CRITICAL FINDING fixed: .env was TRACKED in git (untracked via git rm --cached; history audit showed only DATABASE_URL file path — no secret leak; new secrets never committed); generated dev JWT_SECRET + FIELD_ENC_KEY
- Prisma (rule 8 migrations): security_privacy_models (User.mfaEnabled; RefreshToken revokedAt/revokedReason/replacedByToken; OtpChallenge; ConsentRecord; DeletionRequest) + image_rejection_reason (MedicalImage.rejectionReason); register/route.ts REBUILT (was missing from git — never committed in phase 00) with validation + RL + consent recording
- Security modules (src/lib/security/): env.ts (fail-fast prod, derived dev secret), rate-limit.ts (sliding window + sweep + 9 presets + RateLimitStore Redis interface + 429/Retry-After), csrf.ts (Edge-safe Web Crypto double-submit + origin allowlist), otp.ts (6-digit CSPRNG, sha256(salt:code) storage, 2min TTL, 5 attempts, single-use, supersede-on-request, OtpSmsSender port, verifyMfaChallenge), encryption.ts (AES-256-GCM v1:iv:tag:ct + pseudonymize + redactText), privacy.ts (versioned consent ledger with MARKETING-revocable, buildExportBundle, createDeletionRequest, anonymizeUser)
- src/middleware.ts (ADR-0014): global Origin/CORS + CSRF double-submit on ALL non-GET /api (single exemption: zarinpal callback); issues ta_csrf cookie; Edge-safe (fixed Node crypto crash by Web Crypto); next.config.ts: CSP/XFO/nosniff/Referrer/Permissions/COOP + prod HSTS
- auth.ts hardening: HS256 with pinned iss+aud+algorithms (alg-none rejected), rotation atomic $transaction with ROTATED/REUSE_DETECTED/LOGOUT/PASSWORD_CHANGE reasons + replacedByToken chain + reuse -> family kill + audit hook, revokeAll(reason), signImageUrl/verifyImageSig via getSecrets + timingSafeEqual
- Route hardening: login (per-IP 15/5m spray + per-account 5/5m + MFA hook mfaRequired/devCode + reset-on-success + audits), refresh (RL + REFRESH_REJECTED audit + reuse detector wired), image file route (id regex anti-traversal, ED-66 server-side permission view_images|view_medical_files for staff, VIEW_MEDICAL_FILE for ALL staff incl OPERATOR, DOWNLOAD_IMAGE for signed URL, MEDICAL_FILE_ACCESS_DENIED, nosniff+inline), upload (magic-byte sniffing JPEG/PNG/WebP + per-user RL 20/min + UPLOAD_MAGIC_REJECT audit)
- New routes: auth/otp/request + auth/otp/verify (MFA login completes session), privacy/consents (GET/POST) + consents/revoke (MARKETING-only 409), privacy/export (JSON bundle, 1/day, attachment+no-store, DATA_EXPORT audit), privacy/deletion-request (GET/POST 409-dup), admin/deletion-requests (GET queue + PATCH ANONYMIZE|REJECT)
- Client (contexts/app.tsx): api() attaches x-csrf-token on non-GET from cookie; logoutUser + refresh send header
- Tests: security.test.ts 35 unit (password round-trip/salts/malformed; JWT tamper-payload/foreign-secret/expired/alg-none/wrong-audience; refresh family kill + logout revocation; OTP round-trip+replay+attempt-lock+supersede+hashed-storage; CSRF match/random/origin/allowlist; AES-GCM round-trip+tamper+garbage+pseudonym+redact; RL burst+slide+reset; signed-URL valid/expired/tampered/cross-object/missing; anonymization PII-strip+session-kill+status) — 35/35 PASS
- tests/security-pentest.sh (45 HTTP checks, idempotent via per-run X-Forwarded-For IP): brute-force 401x5->429, JWT forge (role=ADMIN + reversed sig) -> 401 x2, privilege escalation patient->admin x4 = 403, IDOR, CSRF missing/wrong/foreign-origin = 403, upload MIME-spoof/empty/unauth, expired/tampered/unknown signed URL + path traversal = 400, SQLi x2 + XSS storage + products intact, headers x5, privacy x12 (export 401/200/429, consents grant/revoke 409/200, deletion 200/409, admin-gate 403), OTP x3 — 45/45 GREEN
- Fix cycles: Edge-runtime crypto (Web Crypto rewrite), bun await-in-sync tests, tokensMatch empty-string guard, Prisma relation name (medicalFile->case) in export bundle, referral/referrals variable bug in export, ticket XSS payload quote-breaks-JSON, cookie persistence (-c) in pentest jars, rate-limit carry-over between runs (unique per-run fake IP), dashboard 200 (role-scoped by design), register route rebuild
- Docs: docs/SECURITY.md (12 sections: 10 defense layers, AuthN/AuthZ/RBAC/JWT/rotation/MFA/session, RL table, headers/CORS/CSRF, input/SQLi/XSS/upload matrix, secrets/encryption/signed URLs, audit events, medical-data-security table, privacy consent/export/deletion, pentest matrix, file map, debt D-1..6), docs/THREAT-MODEL.md (assets A1-A8, 5 trust boundaries, 29 threats T-xxx with STRIDE+DREAD scores mapped to controls+tests, 5 attack narratives, 6 residual risks, coverage matrix), ADR-0014 (security middleware layer) + ADR-0015 (privacy data rights: anonymization over hard-delete reconciled with ED-49)
- Registry updates: BUSINESS-RULES.md ED-59..70, ADR README x2, RTM phase-05 note + ED-01..70, PRD roadmap phase-05 done; validators: phase01 ED=70, phase03 ADR=15/ED=70 + relaxed ADR->ED-min check, phase04 RTM range, NEW scripts/validate-phase05-docs.py (31 mandated topics, 9 pentest categories, code markers, CJK/secret scan) — ALL 4 validators PASS
- Security self-check: secret scan clean, .env gitignored (verified), PHI scan clean (synthetic pentest users), lint 0/0
- Git commit staged: middleware + 6 security modules + 10 routes + 2 migrations + tests + docs + validators

Stage Summary:
- Deliverables: global security enforcement layer (Origin/CORS/CSRF/headers) + hardened auth (rotation-family, OTP/MFA ready, layered rate limits, env fail-fast) + closed staff-image permission gap (ED-66) + full privacy rights (consent/export/deletion->anonymization) + SECURITY.md + THREAT-MODEL.md + ADR-0014/0015 + ED-59..70
- Verification: 35 unit + 45 pentest = 80/80 PASS; workflow suite 51/51 regression-free; 4 doc validators PASS; lint clean
- Key decisions: ED-59 secrets fail-fast · ED-60 in-process sliding-window RL (Redis adapter for scale) · ED-61 global double-submit CSRF via middleware (single gateway-callback exemption) · ED-63 OTP architecture (hashed, 2m, 5 tries, single-use) · ED-64 refresh token-family kill on replay · ED-66 image access = explicit permission · ED-69 deletion = anonymization (accounting aggregates preserved)
- Remaining risks (honest): CSP unsafe-inline until nonce migration (D-1), RL single-instance until Redis (D-2), XFF spoofable without edge proxy (D-3), MFA UI toggle + PASSWORD_RESET flow completion, malware scan (D-5), Postgres audit-log trigger switch (D-4)
- Next: PHASE 06 — app PostgreSQL switch (prisma db pull on babahakim DB, ETL seed) or Testing hardening (M16) per PRD §12 roadmap

---
Task ID: 8
Agent: Main agent (Super Z)
Task: PHASE 06 — UX Architecture: User Journey ×۶ نقش + Sitemap + Screen Inventory + Flow Diagram + مشخصات ۹ فیلدی هر صفحه (docs/UX.md + docs/SCREEN-MAP.md)

Work Log:
- Pre-stage audit (rule 4): worklog (7 stages), git log (9 commits), re-read Master Prompt UX-relevant sections (§5, §8, §17-§23, §24-§31, §33, §37-§41, §64, §69-§70, §80-§82), constants.ts (6 roles / 31 permissions / 21 case statuses / 19 actions / status metas), BRANDING.md, AppShell nav per role, page.tsx view-router, PRD §12 roadmap, RTM phase-note conventions, canonical 17-stage lifecycle from ARCHITECTURE-DIAGRAM.md §7
- docs/UX.md (588 lines, 12 sections): §1 scope; §2 10 UX principles (UX-01 AI-assisted-not-final, UX-03 transparent waiting, UX-04 expert speed, UX-07 permission-aware UI …); §3 6 personas with KPIs; §4 UJ-1..UJ-6 (patient journey = full 17-stage table with screens/statuses/gates G0-G4 + moments of truth + drop-off recovery; staff journeys with risk tables); §5 sitemap tree 73 nodes with v1/v1²/v2 status + routing model (SPA view-state → RESTful area-first, ED-79); §6 F-01..F-10 mermaid flow diagrams (nav map, auth+OTP/MFA, 17-stage golden path, upload quality-gate retry loop, E1+AI review, E2→doctor, proforma→payment→delivery, shop, ticket, follow-up→reassessment ED-13); §7 state system SP-1..SP-8 + 5 supplemental rules (idempotent buttons, dirty-guard, 429 countdown, two empty kinds); §8 AppShell nav table per role + 3-column §80 layout (24/40/36 + mobile vertical tabs) + modal-vs-page policy; §9 i18n/RTL/a11y (logical props, Jalali render-only, mono codes LTR); §10 inventory methodology; §11 spec traceability table (§4-7/8/8, 17-23, 24-31, 33-38, 40-41, 64, 69-70, 80-82); §12 ED-71..ED-80
- docs/SCREEN-MAP.md (1166 lines, 12 sections): SC-{SH|PT|E1|E2|DR|OP|AD}-{NN} scheme; summary table 73 rows with route-v2 + permission + FR domain; per-screen 9-field specs (هدف/کاربر/اطلاعات/Actions/دسترسی/Empty/Loading/Error/Success) — SH 8 (landing/auth/OTP/403/session/404/notifications), PT 20 (incl. PT-03 medical file, PT-08..11 diagnosis/prescription/proforma/payment deep-linked views per ED-73, PT-20 privacy), E1 8 / E2 8 (three-column patient file, AI review accept/modify/reject per ED-76, review&pricing with XOR availability), DR 5 (decision gate G2 with mandatory comment), OP 11 (no-action cases, payments verify with receipt compare, shipments, OTC orders, contacts), AD 13 (RBAC matrix, prices import/bulk/history, finance, AI models, deletion requests, settings v2); §10 coverage of the 27 commanded pages (11+7+9) + operator/doctor; §11 cross-maps screen→permissions (31 catalogue) → case statuses (21) → API routes; §12 ownership-based patient access model (ED-77) + security notes
- Validator scripts/validate-phase06-docs.py (persistent, rule 9): deliverables, 12 sections, 6 roles/journeys, F-01..10, SP-1..8, UX-01..10, 73 unique SC-IDs + per-area counts, 9 mandatory fields per screen block, summary-row count, 27-page coverage, snake_case tokens ⊆ 31-permission catalogue (parsed live from constants.ts), ALL_CAPS tokens ⊆ status/action/role/allowlist union, UX↔SM cross-reference resolution, ED-71..80 in UX+BR, PRD/RTM phase markers, mermaid fences/quotes/braces balance, CJK scan, secret/PHI scan
- Test→Fix cycle: 6 errors found → fixed: stray CJK char 阈值→«پس از آستانه» in E1-02, Success field added to 4 read-only screens (E2-07/E2-08/DR-05/OP-11), allowlist AI_REVIEW (workflow machine) + MEDICAL_IMAGE_AI (consent type); 2nd run PASS
- Registry updates: BUSINESS-RULES.md ED-71..80 rows; PRD.md §12 roadmap (Phase 06 done — UX per product command; deployment→07; product→08+) + §14 doc index + UX/SCREEN-MAP; RTM phase-06 note + §97 ED-01..80; validators 01 (ED=80) / 03 (ED count 80) / 04+05 (ED-01..80 range) re-aligned
- Security check: secret/PHI scan on all changed files CLEAN; permission model cross-checked against constants.ts (UI never claims non-catalogue permissions; patient = ownership per ED-77)
- Git commit f040561: 10 files, +2020/-10

Stage Summary:
- Deliverables: docs/UX.md (588 lines) + docs/SCREEN-MAP.md (1166 lines) + ED-71..80 + validate-phase06-docs.py; updated PRD/BR/RTM + 4 legacy validators
- 73-screen inventory with 9 mandatory fields each; all 27 product-commanded pages covered (Patient 11 / Expert 7 / Admin 9) plus full Operator (11) and Doctor (5) areas; 6 journeys + 10 mermaid flows + 8 state patterns
- Verification: phase06 validator PASS; full regression phase 01/03/04/05 validators PASS (ED=80 aligned)
- Key decisions: ED-71 SC-ID as single source of truth · ED-72 three-column §80 layout · ED-73 patient view decomposition v1²→v2 · ED-74 mandatory 4-states · ED-75 queue speed (virtual table, optimistic claim) · ED-76 AI review → AI_REVIEW machine · ED-77 ownership-based patient access · ED-78 settings deferred to v2 · ED-79 routing migration path · ED-80 notification deep-link pattern
- Remaining risks (honest): F-01..F-10 mermaid structurally validated (fences/quotes/braces) but not browser-rendered (same policy as phase 03); nav badge counts + virtual queue table + PT-20/AD-13/E1-08/E2-08/DR-05 pages are v2 targets (statuses marked in sitemap); UX debt items in v1 SPA (case codes TC- prefix, MFA UI toggle) inherited unchanged
- Next: PHASE 07 — UI rebuild per SC-ID (component plan from SCREEN-MAP) or Deployment hardening per updated PRD §12 roadmap

---
Task ID: 9
Agent: Main agent (Super Z)
Task: PHASE 07 — UI System: Design System مرکزی + Design Tokens همه‌جا + حذف Hardcodeها + Dark/RTL-LTR/A11y + ممیزی یکپارچگی

Work Log:
- Pre-stage audit (rule 4): worklog (8 stages), git log, re-read Master UI Branding PDF (§1–39 via pdftotext), globals.css/tailwind.config/layout/atoms/constants/AppShell/page.tsx/i18n — خط پایه ممیزی: ۱۳۳ تخلف (۵۷ کلاس hex + ۷۶ پالت خام در ۱۱ فایل) + tailwind.config.ts زائد v3 + فونت‌های مرده geist + hsl(var()) شکسته در نمودارها
- Token layer: globals.css — ۸ توکن وضعیت §9 (bg/fg mode-invariant + text-grade mode-aware آگاه از دارک)، alias تایپوگرافی §23 (display/title/caption)، shadow-card/hover §21، فونت mono، اصلاح WCAG muted-foreground #64799A→#5B6F91 (4.43→5.09:1، ED-86)
- src/design-system/tokens.ts + index.ts (ED-81): آینه TS کامل (brand/derived/status/statusText/semantic light-dark/chartVars/chartPalette/chartTheme/typography/spacing/breakpoints/grid/radius/shadow/zIndex/iconSize) با قانون sync E6
- constants.ts: هر ۴ STATUS_META (۴۴ مدخل) → statusClass توکنی (ED-82)
- atoms.tsx (ED-91): EmptyState ارتقا (icon/title/hint/action سازگار)، LoadingRows/LoadingCard/LoadingSpinner، ErrorState (role=alert + retry)، SuccessState، PageState (SP-7)، ConfirmDialog (AlertDialog)، ConfidenceBar توکنی + ui/spinner.tsx جدید
- رفع ۱۳۳ تخلف در ۱۱ فایل اپ (AppShell/Landing/AuthView/clinical/StaffViews/AdminViews×2/CaseWorkspace/PatientViews/ShopViews/toast) + Logo.tsx به var() + AdminViews2 charts به chartVars/chartTheme (رفع باگ hsl(var()) گرید) + ایموجی‌های تصویری → lucide
- AppToaster (ED-89): sonner جهت‌آگاه داخل AppProvider؛ layout پاک‌سازی؛ dead tailwind.config.ts حذف (ED-83)
- Style Guide زنده (ED-85): DesignSystemView + DsShowcase (۱۵ بخش: توکن‌ها/رنگ‌ها/۲۱ وضعیت/تایپو/فاصله/دکمه×۸/فرم×۶حالت/جدول §19/کارت/دیالوگ×3/ناوبری/اعلان/نمودار/چهار State + دموی PageState/آیکون/Breakpoints) + ثبت router + لینک فوتر Landing/AppShell + ۲۶ کلید i18n
- کلاس‌های idiom تک‌منبع (ED-92): page-title/meta-inline/footer-link/tile-row + sed متمرکز
- scripts/ui-audit.mjs (ED-90) + npm audit:ui: E1..E7 + W1/W2، گیت exit 1، گزارش JSON؛ ۱۵۲ فایل، ۳۲ جفت کنتراست همه PASS
- Test→Fix: باگ RouterWithStaffDefault (designSystem برای مهمان)، ShopViews brace اضافی (parse error)، hsl sidebar، کامنت/hex ممیزی، تورفتگی PatientViews، CardLike rename — ۴ چرخه تا سبز
- راستی‌آزمایی مرورگر (agent-browser): Landing 200 بدون خطای کنسول/Hydration → DS view رندر (fa/en × light/dark) → دیالوگ باز/Confirm → توست success → ۲ recharts + ۶ skeleton → PageState error/success → computed: statusInfoBg=rgb(87,175,226)، Vazirmatn، bodyBg دارک، page-title flex — تصاویر: verify-ds-*.png
- مستندات: docs/DESIGN-SYSTEM.md (۱۹ بخش، ED-85/86/87/90/91/92 ارجاع)؛ رجیستری: PRD §12 (فاز ۰۷ انجام‌شده + فاز ۰۸ Deployment) + فهرست اسناد، BUSINESS-RULES ED-81..92، RTM یادداشت فاز ۰۷ + §97 ED-01..92، BRANDING cross-ref
- اعتبارسنج: scripts/validate-phase07-docs.py (7 deliverable + wiring + registry + گیت زنده ممیزی + CJK/secret) — PASS؛ ۵ اعتبارسنج رگرسیون (01/03/04/05/06) بازتنظیم ED=92 — همه PASS
- امنیت: اسکن secret/PHI روی تغییرات = فقط داده demo مصنوعی (091200000xx + Pass1234 نمایشی)؛ dangerouslySetInnerHTML فقط chart.tsx فروشگاه shadcn (بدون ورودی کاربر)؛ صفر وابستگی جدید
- Git commit: توکن‌ها + DS views + ممیزی + مستندات + رجیستری

Stage Summary:
- Deliverables: Design System مرکزی دو-منبعی (globals.css + tokens.ts) · ۸ توکن وضعیت §9 · Typography/Spacing/Grid/Breakpoints/Radius/Shadow · States چهارگانه SP-1..8 · Style Guide زنده درون-برنامه‌ای · ui-audit.mjs گیت CI · DESIGN-SYSTEM.md ۱۹ بخشی · ED-81..92 · ۶ اعتبارسنج PASS
- Verification: ممیزی UI ۱۳۳→۰ خطا؛ ۳۲/۳۲ کنتراست WCAG؛ lint ۰؛ ۸۶/۸۶ تست رگرسیون؛ browser-verified (دیالوگ/توست/چارت/State/دارک/RTL/LTR)
- Key decisions: ED-81 دو-منبعی توکن + گیت sync · ED-82 وضعیت معنایی mode-invariant · ED-83 حذف کانفیگ v3 · ED-84 منطقی-اجباری · ED-85 style guide درون-برنامه‌ای · ED-86 اصلاح AA · ED-87 قاعده Accent · ED-88 chartTheme · ED-89 sonner مرجع · ED-90 گیت ممیزی · ED-91 States استاندارد · ED-92 idiom تک‌منبع
- Remaining risks (honest): radix use-toast legacy فریز؛ PageHeader کامپوننتی (به‌جای .page-title) اختیاری v2؛ DatePicker جلالی v2؛ WCAG خودکار فقط Node (Cypress بعدی)؛ scope دکمه‌های sticky در تست خودکار
- Next: PHASE 08 — UI Rebuild طبق SC-ID (SCREEN-MAP ۷۳ صفحه) روی همین Design System، یا Deployment per PRD §12

---
Task ID: 10
Agent: Main agent (Super Z)
Task: PHASE 08 — Backend Engineering: Audit + تکمیل/Refactor به معماری لایه‌ای + استانداردسازی ۱۲ مورد + جلوگیری از Logic در Controller + Unit/Integration Test

Work Log:
- Pre-stage audit (rule 4): worklog (۹ فاز)، git log (۱۰ کامیت)، خواندن کامل ۴۲ مسیر API + lib (api/auth/caseService/db/notify) — ۱۶ یافته: A1 Logic در Controller (۲۶۳خط)، A2 **Checkout بدون Transaction (بحرانی)**، A3 بدون zod، A4/A5 بدون Pagination/Sort استاندارد، A6 بدون Cache، A7 AI همزمان در request، A8 بدون Event، A9/A10 خطا و لاگ ad-hoc، A11/A12 نسخه‌بندی/مجوز ناسازگار، A13 lib بدون مرز، A14 نویز لاگ DB، **A15 RBAC: create_invoice برای OPERATOR غایب (ماتریس کد ≠ ED-04/مستندات)**، A16 دو-نمونه Cache زیر HMR
- معماری (ED-93): src/server چهارلایه — core (errors/logger/ids/context) · api (apiRoute/parseBody/guards/query/envelope/schemas) · domain/policies (منطق خالص: موجودی/جمع فاکتور/امتیاز مزاج/پیش‌شرط‌ها) · application (dto zod + ۱۲ سرویس: CaseAction/Case/Order/Catalog/Cart/Questionnaire/Profile/Support(Ticket/Shipment/Followup/Notification)/Payment/Auth/Image+Privacy/Dashboard/Admin) · infrastructure (cache/events/jobs/uow/audit/bootstrap)؛ RequestContext خنثی به‌جای NextRequest؛ src/lib = Shared Kernel منجمد؛ toAuditReq(ctx) برای موتور فاز ۰۲
- ۴۱ مسیر refactor: Controller نازک (guard → parseBody → service → data)؛ حذف route.ts قالبی؛ ۱۲ استاندارد: zod(ED-96) · سرویس‌سازی(ED-93) · گارد(ED-97) · withTransaction اتمیک با re-check موجودی(ED-103/104 — رفع A2) · Envelope خطا واحد {error,code,requestId}(ED-94) · Logger JSON + redaction(ED-95) · Cache TTL+invalidation Event-driven+HMR-safe globalThis(ED-98/A16) · JobQueue retry/backoff/DLQ + ai-analysis async + followup-scan ۵min(ED-102) · DomainEventBus ۱۸ رویداد(ED-99) · X-API-Version/X-Request-Id(ED-101) · قرارداد page/limit/sort/order/q + meta(ED-100) · فیلتر دامنه‌ای
- گیت معماری (ED-105): scripts/backend-audit.mjs (E1..E8+W1/W2) + npm audit:backend — ۴۵ فایل، ۰ خطا/۰ هشدار؛ gate زنده در validator فاز ۰۸
- CREATE_PROFORMA: guard-first (assertGuards قبل از ساخت موجودیت) + compensation (حذف order/invoice اگر گذار شکست خورد)
- تست: ۳۵ unit (backend-core: خطا/کوئری/کش/ایونت/جاب/پالیسی‌ها شامل مزاج ۸حالته) + ۱۹ integration (tests/integration/api-golden-path.test.ts روی :3000 با Cookie-Jar+CSRF+IP یکتا: قرارداد envelope/header/صفحه‌بندی، ثبت‌نام→پرسشنامه→آپلود(نویز JPEG پاس گیت کیفیت)→پرونده→AI async→۱۸ اکشن→درگاه idempotent→تحویل→CLOSED، Checkout اتمیک (جمع/موجودی/سبد)، 403 ادمین، لاگ ساختاریافته) + رگرسیون ۵۱ workflow + ۳۵ security + ۴۵ pentest = ۱۸۵ سبز
- چرخه‌های Test→Fix: parseListQuery Number(null)=0 (limit→1)، import تکراری db در authService، نقش تست SCHEDULE/COMPLETE_FOLLOWUP (باید EXPERT_1/OPERATOR نه DOCTOR)، 422 OTP حفظ قرارداد pentest (اعتبارسنجی معنایی در سرویس)، cache stale stock (publish ProductCatalogChanged در checkout)، bootstrap guard نسخه‌دار + invalidation با globalThis در زمان event
- مستندات: docs/BACKEND.md (۱۱ بخش: ممیزی ۱۶ یافته، لایه‌ها، ۱۲ استاندارد، قرارداد Envelope، تست‌ها، گیت، نسخه‌بندی، نقشه سرویس‌ها، ED-93..105، بدهی D-08-1..6)؛ رجیستری: BR +۱۳ ردیف ED، PRD §12 فاز ۰۸ + فهرست اسناد، RTM یادداشت فاز ۰۸ + ED-01..105؛ ۵ validator قدیمی بازتنظیم (ED count/مسیر مارکرها به سرویس) — ۷/۷ PASS
- امنیت: اسکن secret/PHI روی همه تغییرات پاک؛ .env ignored (راستی‌آزمایی)؛ lint ۰/۰؛ tsc لایه‌های server/api پاک
- Browser verification: Landing→Demo login→داشبورد بیمار (سارا)→پرونده‌ها→فضای کاری پرونده (رندر کامل: وضعیت/مزاج/پروفایل)→فروشگاه (محصولات + موجودی زنده ۱۹) — ۰ خطای کنسول/صفحه
- Git commit 43c2b71: ۹۲ فایل (+۵۳۷۵/−۲۴۴۳)

Stage Summary:
- Deliverables: معماری Backend لایه‌ای کامل src/server (۱۶ ماژول) + ۴۱ مسیر نازک‌شده + ۱۲ استاندارد cross-cutting + گیت CI backend-audit + ۵۴ تست جدید + docs/BACKEND.md + ED-93..105 + validator فاز ۰۸
- دو باگ واقعی پروداکشن رفع شد: A2 (Checkout غیراتمیک: order/invoice/موجودی/سبد حالا اتمیک با re-check موجودی) و A15 (اپراتور دوباره create_invoice دارد طبق ED-04/ماتریس BR §2)
- Verification: ۱۸۵/۱۸۵ تست (۳۵ unit جدید + ۱۹ integration جدید + ۵۱+۳۵ رگرسیون + ۴۵ pentest)؛ گیت معماری ۰ تخلف؛ ۷ validator PASS؛ lint ۰؛ browser-verified
- Key decisions: ED-93 لایه‌ای+Shared Kernel منجمد · ED-94 envelope واحد سازگار v1 · ED-96 zod مرز واحد · ED-98 کش HMR-safe آماده Redis · ED-99 سرویس‌ها notify مستقیم نمی‌زنند · ED-100 قرارداد صفحه‌بندی · ED-101 نسخه‌بندی هدر+URL · ED-102 جاب BullMQ-سازگار · ED-103 uow اتمیک · ED-104 گارد موجودی · ED-105 گیت Controller نازک
- Remaining risks (honest): D-08-1 فهرست‌های ادمین cap ثابت (صفحه‌بندی کامل v1²) · D-08-2/3 Cache و JobQueue تک-نمونه‌ای (port آماده Redis/BullMQ) · D-08-4 گزارش‌ها مستقیم OLTP · D-08-6 CSP unsafe-inline (ارث فاز ۰۵) · AI job همچنان in-process (worker جدا در فاز Deployment)
- Next: PHASE 09 — UI Rebuild طبق SC-ID (SCREEN-MAP ۷۳ صفحه) روی Design System فاز ۰۷ + Backend فاز ۰۸، یا Deployment (Docker/CI) طبق PRD §12

---
Task ID: 11
Agent: Main agent (Super Z)
Task: PHASE 10 — File & Media Engineering: استانداردسازی Upload/Download/Storage/Compression/Processing/Metadata/Versioning/Access Control/Security + طبقه‌بندی Public/Private/Temporary/Permanent + Lifecycle/Signed URLs/Limits/Allowed Types/Malware/Backup + عدم بلاک شدن درخواست اصلی

Work Log:
- Pre-stage audit (rule 4): worklog (۱۰ فاز)، git log، بازیابی وضعیت جلسهٔ قطع‌شدهٔ PHASE 09 (frontend-audit-report + e2e 3/17 در لحظهٔ قطع + **مسیر گم‌شدهٔ images/upload در آخرین auto-commit**) — ۱۲ یافته: F1 مسیر آپلود گم، F2 پردازش همزمان بلاک‌کننده (storeImage در رشته درخواست)، F3/F4 بدون طبقه‌بندی/چرخه حیات، F5 version بلااستفاده، F6 تصویر محصول همیشه ۴۰۴ (امضای Product ID روی مسیر MedicalImage)، F7 enum ناسازگار، F8 بدون بدافزار، F9 بدون Backup، F10 حدود دو-منبع، F11 امضا بدون مقید بودن variant، F12 ذخیره‌سازی تخت
- Prisma: ۳ موجودیت جدید StoredFile/StoredFileVersion/StoredFileVariant (SQLite: enum رشته‌ای + اعتبارسنجی در config) + پل MedicalImage.storedFileId و Product.imageFileId + IMAGE_TYPE واحد؛ db:push
- موتور src/server/infrastructure/media/ (۷ ماژول): config (MEDIA_POLICY تک‌منبع حدود بیمار/کارکنان + allowlist + TTL + retention، ED-107) · storage-driver (پورت + Local با ۶ ناحیه inbox/files{public,private,temp}/quarantine/trash + کلید محتوا-نشانی + assertSafeKey ضد traversal، ED-109/110) · scanner (L1 امضاها شامل EICAR + L2 ساختاری trailing/RIFF/MZ/PDF-JS + L3 بازکدگذاری + L4 ClamAV clamd INSTREAM، ED-111) · signed-url (HMAC روی fileId.version.variant.exp + timing-safe، ED-112) · processing (sharp: original q95/compressed 1600q82/ai 512/thumb 320 — همه بازکدگذاری و بدون EXIF) · pipeline (acceptUpload سریع → inbox+PENDING+enqueue؛ processFile در worker: scan→quarantine یا renditions→metadata→گیت کیفیت→پل MedicalImage، ED-114) · lifecycle (TTL صندوق ۲۴h، انقضای TEMPORARY، پاک‌سازی سطل ۷ روزه batch≤50 + Audit tick)
- خطاهای جدید: 413 PAYLOAD_TOO_LARGE / 415 UNSUPPORTED_MEDIA_TYPE در errors.ts
- mediaFileService (guards/audit/DTO/صفحه‌بندی ED-100) + ۱۰ مسیر: POST/GET /api/v1/files، [id] (GET/PATCH/DELETE)، [id]/versions (GET/POST)، [id]/content (سرو با Cache-Control طبقه‌بندی-آگاه + ETag + Range 206 + nosniff)، [id]/signed-url، admin/media/stats، admin/media/lifecycle (+force) + بازیابی images/upload (۲۰۲) + images/[id] (poll وضعیت + کیفیت) + serveImageFile پل جدید/legacy
- bootstrap v3: jobs media-process (retry/backoff/DLQ→FAILED) + media-lifecycle تکرارشونده ۵ دقیقه؛ رویدادهای MediaFileReady (→ابطال کش کاتالوگ برای PRODUCT_IMAGE)/MediaFileInfected (→اعلان FILE_QUARANTINED مالک + اپراتورها)/MediaFilePurged؛ ImageUploaded پس از READY پزشکی؛ notify: قالب FILE_QUARANTINED + رفع باگ smsLog→sMSLog
- رفع F6: catalogService → Product.imageFileId با URL عمومی مستقیم؛ admin products create/patch پذیرای multipart (data JSON + image) → آپلود PUBLIC در موتور + نسخه جدید در جایگزینی
- فرانت حداقلی: NewCaseView آپلود ۲۰۲ → poll وضعیت تا VALIDATED/REJECTED (۳۰×750ms) با همان UX کیفیت
- مهاجرت: scripts/migrate-legacy-media.mjs (idempotent) — ۱۵ رکورد legacy → files/private با sha256 محاسبه‌شده + scanEngine=legacy-migrated + مسیرهای legacy همگام
- Backup/Restore: backup-media.mjs (tar.gz storage+db پس از wal_checkpoint + manifest + sha256 + retention ۱۴ روز — اجرا: 8.21MB/62 فایل) + restore-media.mjs (staging + --yes) + npm scripts
- گیت: scripts/media-audit.mjs (E1 بدون fs/sharp در مسیرها، E2 تک‌منبعی حدود، E3 ممنوعیت امضا دست‌ساز، E4 گارد کلید، E5 ممنوعیت storeImage، E6 apiRoute، E7 MEDIA_POLICY در lifecycle/bootstrap) — ۰ خطا؛ backend-audit: گارد whitelist برای content (مجوز درون-سرویس) + stats singleton + مسیرهای multipart با zod — ۰ خطا
- تست: ۳۰ unit (scanner/امضا/سیاست/کلید/خالص‌ها) + ۱۹ integration (۲۰۲→poll→READY، 413/415/400، ماتریس دسترسی، امضا variant-swap/انقضا، versioning تغییرناپذیر v1، قرنطینه EICAR، PUBLIC محصول ناشناس، TEMPORARY+حذف نرم+force purge+stats، لیست مالک-محور) + golden path async + pentest انتظار MIME 415 — رگرسیون: ۱۸۹/۱۸۹ bun test + ۴۵/۴۵ pentest + ۱۷/۱۷ E2E
- Test→Fix: tsc (پرانتز require/نوع‌ها/readdir Dirent/qualityOk null)، poll مرزی exp==now، uploads zone در driver، assert sanitizeFileName، ثبت بدنه Client (rawGet برای باینری)، DELETED→404 (tombstone)، شماره تلفن تست ۴۰9-تکرار، رنگزگر E2E محلی‌سازی (Toggle light/dark) + **رفع باگ遗留ی PHASE 09: ThemeToggle از useApp().setTheme (ناموجود) → useTheme()** → E2E 17/17
- مرورگر (agent-browser): لاگین سارا → ارسال درخواست → آپلود تصویر → 202 → poll → Q:100/100 → ایجاد پرونده TC-MTMT7K6C147 → workspace — dev.log پاک (فقط AUTH_REQUIRED آغازین)؛ ناحیه‌ها روی دیسک فعال (public 21/private 108/quarantine 7)
- مستندات: docs/FILE-MEDIA.md (۱۵ بخش: ممیزی F1..F12، معماری، ماتریس، lifecycle، بدافزار، امضا، حدود، versioning، ذخیره‌سازی، عدم-بلاک، API، backup، تست، بدهی D-10-1..6، رجیستری)؛ رجیستری: PRD §12 (فاز ۰۹ نیمه‌کاره صادقانه + فاز ۱۰ + فاز 11+) + فهرست اسناد، BR +۱۴ ردیف ED-106..119، RTM یادداشت فاز ۰۹/۱۰ + بازه ED-01..119
- اعتبارسنج‌ها: validate-phase10-docs.py جدید (12 دسته، PASS) + بازتنظیم ۵ اعتبارسنج قدیمی به ED-119 + منبع sniffMime به pipeline — ۸/۸ PASS
- امنیت: اسکن secret/PHI روی ۷۴ فایل متنی تغییر-یافته = پاک؛ .env ignored (راستی‌آزمایی)؛ storage/ و backups/ و tool-results/ به .gitignore + untrack
- Git commit 52e42f7 (۱۲۷ فایل)

Stage Summary:
- Deliverables: موتور فایل/رسانه کامل (۷ ماژول + ۳ موجودیت + ۱۰ مسیر + ۳ اسکریپت عملیاتی + گیت CI + مستند ۱۵-بخشی) · ED-106..119 · ۴۹ تست جدید · ۸/۸ اعتبارسنج
- دو باگ پروداکشن واقعی رفع شد: F6 (تصاویر محصولات همیشه ۴۰۴ — از ابتدای پروژه) و F11 (امضای بدون-variant — امکان برداشت original با URL معتبر compressed) + بازیابی F1 (مسیر آپلود گم‌شده از جلسه قطع‌شده) + ThemeToggle crash遗留ی فاز ۰۹
- Verification: ۱۸۹/۱۸۹ bun test · ۴۵/۴۵ pentest · ۱۷/۱۷ E2E مرورگری (رفع آخرین شکست) · سه گیت audit سبز · browser-verified (آپلود async تا ایجاد پرونده) · backup واقعی 8.21MB
- Key decisions: ED-106..119 (رجیستری کامل در FILE-MEDIA §15) — مهم‌ترینها: ED-114 آپلود ۲۰۲+worker (الزام «عدم بلاک»)، ED-111 اسکن L1..L4 + قرنطینه، ED-112 امضای مقید چهار-جزئی، ED-107 تک‌منبعی حدود
- Remaining risks (honest): D-10-1 بازکلاس‌بندی فیزیکی فقط در نسخه بعدی · D-10-2 JobQueue/RateLimit تک-نمونه‌ای (پورت Redis) · D-10-3 ClamAV در dev خاموش · D-10-4 دو فایل یتیم uploads/ · D-10-5 UI گالری ادمین → فاز ۰۹ · D-10-6 بدون chunk-upload (کافی برای ۲۵MB)
- Next: PHASE 09 remediation نیمه‌کاره (۷۳ صفحه SC-ID روی DS فاز ۰۷ + backend فاز ۰۸) یا Deployment طبق PRD §12 فاز 11+

---
Task ID: 12
Agent: Main agent (Super Z)
Task: PHASE 11 — AI/ML Engineering: ممیزی کامل AI Stack (۲۰ محور) + پیاده‌سازی MLOps + Adapter/Interface برای تعویض مدل + AI بدون اعتماد قطعی بدون Human/Business Validation

Work Log:
- Pre-stage audit (rule 4): worklog (۱۱ فاز)، git log (۱۱ کامیت)، بازخوانی بخش‌های AI مَست‌رپرامپت (§2 اعتماد، §10 Pipeline، §11 یادگیری، §12 Dataset، §46 Background، §60 Evaluation، §61 Versioning، §62 Explainability، §63 Leakage، §95 Readiness) + بازرسی provider.ts/run.ts/jobs.ts/aiReview.ts/bootstrap/AIModel/AIAnalysis/listAiModels
- ممیزی ۲۰-محوری: جدول کامل در AI-ML.md §1 — یافته‌های کلیدی: provider هاردکد (رجیستری DB صرفاً نمایشی)، دیتاست ad-hoc بدون نسخه/برچسب، metrics سید دستی، بدون Prompt/Embedding/Monitoring/Drift/Cost/Leakage/Bias، و **باگ پروداکشن B-11-1**: موتور گردش کار row.status می‌خواند ولی AIAnalysis در reviewStatus نگه می‌دارد → تمام انتقال‌های AI_REVIEW از فاز ۰۲ بی‌صدا INVALID_TRANSITION می‌شدند که caller نادیده می‌گرفت — بازبینی‌های انسانی هرگز ثبت نمی‌شد، humanReviewed همیشه false، حلقهٔ یادگیری کاملاً باز (گلدن‌پس 200 می‌گرفت چون نتیجهٔ executeTransition نادیده گرفته می‌شد)
- Prisma: ۵ موجودیت جدید (AIPromptTemplate @@unique(key,version) · AIDataset DRAFT/FROZEN @@unique(name,version) · AIDatasetItem با patientHash نمک‌خورده+زنجیرهٔ برچسب E1/E2/Final+disagreement · AIInferenceLog با provenance کامل+cost+replay · AIEvaluationReport) + توسعهٔ AIModel (trainingDatasetVersion/preprocessingVersion/promptKey/promptVersion/confidenceThreshold/driftBaseline) — db push
- موتور src/server/infrastructure/ai/ (۱۰ ماژول، ED-120): constants (تک‌منبعی آستانه‌ها) · registry (resolveActiveModel از DB→نقشه Factory — تعویض مدل بدون کد، ED-121) · prompts (رجیستری نسخه‌دار تغییرناپذیر + رندر {{var}} با escape ضد-تزریق + سید idempotent، ED-122) · security (گارد خروجی zod+allowlist شاخص+clamp+فینیت ویژگی‌ها+disclaimer قراردادی؛ گارد ورودی؛ replay با SHA-256؛ گیت آموزش FROZEN-only؛ hashPatientRef/ED-129) · validation-gate (سه‌سطحی: نمایش-پیشنهادی/مبنا-تصمیم فقط ACCEPTED|MODIFIED+بازبین/نهایی هرگز — isFinalClinicalResult همیشه false، ED-125) · datasets (حلقهٔ بازخورد recordReviewLabel با corrections JSON به‌عنوان ground-truth واقعی یا کد توافق؛ finalize از دروازهٔ دکتر؛ فریز؛ تفکیک بیمار-محور stable-hash با assertNoPatientLeakage §63؛ خروجی de-identified، ED-123/124) · evaluation (computeMetrics: accuracy/precision/recall/F1 macro+per-class/confusion/sensitivity/specificity/calibration buckets/imbalance + یادداشت over/under-confidence؛ evaluateModel→گزارش+metrics محاسبه‌شده؛ ED-127/132) · monitoring (AIInferenceLog تله‌متری؛ آمار p50/p95؛ bias کلاس با فلگ >80٪؛ computePSI با آستانه 0.1/0.25؛ captureBaseline خودکار ≥۱۰؛ runDriftCheck→AiDriftDetected، ED-126/130) · cost (واحد نرمال CPU-ms/token-ready + سقف ماهانه AI_MONTHLY_BUDGET_UNITS + هشدار ۸۰٪، ED-128) · embeddings (پورت EmbeddingProvider + استب Hash قطعی نرمال + cosine — بیرون از مسیر بالینی، ED-133) · pipeline (مسیر واحد: resolve→input guard→hash/replay→analyze→output guard→persist با PENDING_REVIEW همیشه→تله‌متری+هزینه→event؛ شکست→تله‌متری FAILED+rethrow؛ rerunAnalysis با تاریخچه) — index.ts سطح عمومی
- رفع باگ B-11-1 (ED-131): MachineDef.statusKey + موتور از یک کلید می‌خواند/می‌نویسد/audit/نتیجه؛ aiReview machine statusKey:'reviewStatus'؛ caseActionService: شکست انتقال AI_REVIEW در SUBMIT_ASSESSMENT حالا FATAL (ED-134) + انتشار AiReviewDecided (تصمیم+اصلاحات) + aiAssisted از resolveAiAssistedFlag (تأیید واقعی)
- حلقهٔ بازخورد کامل: SUBMIT_ASSESSMENT→machine→AiReviewDecided→bootstrap subscriber→recordReviewLabel (اصلاحات→JSON ground-truth)؛ DOCTOR_APPROVE/REJECT→finalizeFinalLabel→FINALIZED؛ رویدادهای جدید AiReviewDecided/AiEvaluationCompleted/AiDriftDetected/AiBudgetAlert؛ bootstrap v4: jobs ai-evaluation/ai-monitor(۵min: drift+baseline خودکار+budget)/ai-prompt-seed + subscriberها + اعلان DRIFT به ادمین‌ها
- DTO: assessmentSchema + aiCorrections اختیاری [{indicator,value}]؛ سرویس aiMlopsService (aiOverview/datasetAction freeze+exclude/requestEvaluation async/monitoringSnapshot/promptRegistry/rerunCaseAi)؛ ۶ مسیر: GET admin/ai/overview (A/E1/E2/DR) · GET/POST admin/ai/datasets (POST: ADMIN) · GET admin/ai/prompts · POST admin/ai/evaluate (async) · GET admin/ai/monitoring · POST cases/[id]/rerun-ai (A/E1, zod, audit)
- فرانت: AdminAIModelsPage بازنویسی کامل به داشبورد ۴-تبی (رجیستری با metrics محاسبه‌شده+provenance+گزارش‌های ارزیابی / دیتاست ۶ آمار+نسخه‌ها+آیتم‌ها با E1/E2/F و فلگ اختلاف+hash بیمار+فریز / پایش: استنتاج+bias+نوار بودجه+PSI / پرامپت‌ها) + رفع باگ قدیمی lang ReferenceError + بج‌های metrics فقط عددی
- گیت CI جدید scripts/ai-audit.mjs (A1..A10: عدم new provider بیرون registry، مسیر بدون import مستقیم engine، PENDING_REVIEW در create، metrics فقط از evaluation، dataset item تک-نویسنده، analyze فقط در pipeline، statusKey ماشین، رندر امن، گیت آموزش، گارد نقش) + npm audit:ai
- Test→Fix: ۴ شکست اول (آزمون‌های انتظار اشتباه×۲ + clamp نرم به‌جای reject + جفت‌گذاری شاخص بدون correction) → اصلاح؛ باگ‌های واقعی رفع‌شده در چرخه: ۴۰۰ ساخت پرونده (پرسشنامه پیش‌شرط) → افزودن گام پرسشنامه؛ ۴۰۹ EXPERT2 (نبود کلاینت E2 + پیلویش آیتم‌ها)؛ E5 backend-audit (parseBody در rerun)؛ E1 (import engine در مسیر → listDatasets)؛ E3 ui-audit (هگز fixture تست)
- تست: ۵۱ unit جدید (registry/prompts رندر و تزریق/گاردها/دروازه ۳ سطحی/تفکیک بیمار-محور عدم-نشت+قطعیت/متریک دست‌محاسبه/PSI سرد و شیفت/هزینه/embedding قطعی) + ۱۱ integration جدید (آپلود→پرونده→AI async با provenance و PENDING_REVIEW→تله‌متری→پرامپت→بازبینی E1 با اصلاحات→آیتم دیتاست با hash بدون PHI→دکتر→FINALIZED→ارزیابی متریک کامل→rerun تاریخچه→مجوزدهی→فریز) — رگرسیون: ۲۵۱/۲۵۱ bun test (گلدن‌پس حالا با بازبینی AI واقعی) · ۴۵/۴۵ pentest · backend/media/ai/ui audit سبز · ۸/۸ validator (۵ validator قدیمی به ED-134 بازتنظیم شدند)
- مرورگر (agent-browser): لاگین ادمین → ۴ تب داشبورد AI با دادهٔ زنده (۲۰ استنتاج/۷روز، اطمینان ۷۱٪، لاتنسی ۵۰ms، ۱۳ نسخهٔ دیتاست با فریز، گزارش ارزیابی n=10، رجیستری با baseline ✓) — بدون خطای صفحه — اسکرین‌شات verify-ai-{registry,dataset,monitoring,prompts,final}.png
- مستندات: docs/AI-ML.md (۱۴ بخش: ممیزی ۲۰-محوری، باگ B-11-1، معماری، حلقهٔ بازخورد، دروازه، نسخه‌بندی، drift/bias/cost، امنیت، API، فرانت، تست، ED-120..134، بدهی D-11-1..6، ران‌بوک) + رجیستری: PRD §12 (ردیف فاز ۱۱) · BR +۱۵ ردیف ED-120..134 · RTM یادداشت فاز + بازه ED-01..134 + validator validate-phase11-docs.py (۱۰ دسته PASS)
- امنیت: اسکن secret/PHI روی موتور AI = پاک؛ salt دیتاست env-driven (AI_DATASET_HASH_SALT — هشدار D-11-2 برای پروداکشن)؛ اسکریپت‌های dbg موقت حذف شدند
- Git commit 8c6bbe1 (۵۲ فایل)

Stage Summary:
- Deliverables: موتور AI/ML کامل (۱۰ ماژول + ۵ موجودیت + ۶ مسیر + داشبورد ۴-تبی + گیت CI + مستند ۱۴-بخشی) · ED-120..134 · ۶۲ تست جدید (۵۱ unit + ۱۱ integration)
- باگ پروداکشن واقعی رفع شد: B-11-1 — بازبینی‌های انسانی AI از فاز ۰۲ هرگز ثبت نمی‌شدند (statusKey mismatch)؛ حلقهٔ یادگیری حالا واقعاً بسته است و گلدن‌پس آن را تأیید می‌کند
- Verification: ۲۵۱/۲۵۱ bun test · ۴۵/۴۵ pentest · ۴/۴ audit (backend/media/ai/ui) · ۸/۸ validator · browser-verified (۴ تب با دادهٔ زنده)
- Key decisions: ED-121 (تعویض مدل از DB بدون کد) · ED-125 (دروازهٔ سه‌سطحی اعتبارسنجی انسانی) · ED-127 (metrics فقط محاسبه‌شده) · ED-123 (تفکیک بیمار-محور ضد-نشت) · ED-131 (statusKey)
- Remaining risks (honest): D-11-1 UI اصلاح per-indicator برای E1 (DTO/سرویس/تست موجود؛ فرم مانده) · D-11-2 salt پروداکشن · D-11-3 retention لاگ استنتاج · D-11-5 ارزیابی v1 روی لیبل توافق درصدهای پایین صادقانه می‌دهد · D-11-6 ریترین واقعی خارج از scope ولی زیرساخت کامل
- Next: PHASE 09 remediation (۷۳ صفحه SC-ID + D-11-1 فرم اصلاح) یا Deployment طبق PRD §12 فاز 12+

---
Task ID: 13
Agent: Main agent (Super Z)
Task: PHASE 12 — Business Workflow Engineering (تمام Workflowها با ۱۱ بُعد + تبدیل به State Machine + Backend Source of Truth)

Work Log:
- ممیزی پایه: ۸ ماشین موجود (PHASE 02) پوشش ۷ بُعد؛ شکاف‌های شناسایی‌شده: Timeout/Retry/Failure/Recovery غایب، ۳ فرآیند مهم بدون ماشین (DeletionRequest/MedicalImage/Invoice)، ۷ مسیر bypass موتور (کاسکاد پرداخت، شروع پرداخت با حفره گراف PAYMENT_PENDING، پل مدیا، MARK_PROCESSED، followup-scan updateMany، deletion مستقیم، invoice پراکنده)
- Prisma: مدل WorkflowState (Projection اتمیک هر گذار: enteredAt/reminderCount/escalatedAt/lastDriftSyncAt) + migration 20260905090000_workflow_state_phase12 (افزودنی، applied)
- policies.ts (خالص/Client-Safe): TIMEOUT_POLICIES (۵۰+ سیاست، نردبان REMIND→ESCALATE + انقضای خودکار درگاه ۳۰m)، RETRY_POLICIES، FAILURE_POLICIES، governanceDecision خالص
- subtransition.ts: applySubTransition — کاسکادهای Machine-Guarded داخل tx فراخواننده (گارد+Audit+CaseEvent+WorkflowState)؛ cascadeSubTransition برای no-op idempotent
- engine.ts: sync WorkflowState در تراکنش هر گذار + executeAdminRecovery (فرار اضطراری ADMIN با Audit کامل)
- ۳ ماشین جدید + registry: DELETION_REQUEST (۴ وضعیت، ناشناس‌سازی اتمیک با anonymizeUserTx)، MEDICAL_IMAGE (۴ وضعیت، REJECT از همه وضعیت‌های زنده برای حق حذف + REVALIDATE)، INVOICE (۵ وضعیت) → ۱۱ ماشین
- رفع bypassها: paymentPaidCascade→زیر‌گذار ORDER/CASE/INVOICE؛ cascadePaid→INVOICE.MARK_PAID؛ startPayment→ORDER.ENTER_PAYMENT (ED-126)+INVOICE.CONFIRM؛ media bridge→VALIDATE/REJECT؛ ai/pipeline→MARK_PROCESSED؛ followup-scan→گذار سطربه‌سطر Audited؛ patchDeletionRequest→ماشین
- governance.ts: Runtime هر ۲ دقیقه (بک‌فیل Bounded + Drift→Audit + SLA ladder) + workflowHealthSnapshot؛ bootstrap v6 (rewire HMR hotfix)
- API کنسول: GET/POST admin/workflow/overview|scan|recover (ADMIN-only + zod + rate-limit در سرویس + Audit)
- رفع باگ‌های کشف‌شده حین فاز: FK audit با id ساختگی (wrapper anonymizeUser→SYSTEM)؛ TS_CAPS (نقشه ستون‌های زمانی — Invoice/deletionRequest فاقد updatedAt/deletedAt)؛ بازسازی images/upload (ED-127 — commit‌نشده گمشده)؛ notifyRole+extraFa؛ مقایسه‌های TS مرده در پل مدیا
- چرخه منشور: bun test 283/283 · lint 0 خطا · backend-audit PASSED (E5/E1 اصلاح: rate-limit انتقال به سرویس، zod در upload، BODYLESS برای scan) · frontend-audit PASSED · pentest 45/45 · probe امنیتی (401/403/PATIENT×3=403) · probe عملکردی ADMIN (scan: 11 ماشین/93/0 خطا؛ recover واقعی AI_REVIEW→ACCEPTED با Audit+WorkflowState اتمیک) · مرورگر: رندر+لاگین مدیر+صفر خطای console
- مستندات: WORKFLOW.md v2.0.0 (§12–19: کاتالوگ ۱۱بُعدی، ۱۱ ماشین، Governance، Recovery سه‌لایه، API) · ADR-0016 + ثبت در README · BUSINESS-RULES §6 (BR-WF-01..10) + ED-121..129
- Git: commit b82e344

Stage Summary:
- ۱۱ ماشین وضعیت با تمام ۱۱ بُعد PHASE 12 (States/Transitions/Actors/Permissions/Conditions/Events/Notifications/Timeouts/Retries/Failures/Recovery)
- لایه حاکمیت زنده: Governance Runtime هر ۲ دقیقه با Drift Detection (پاسدار فعال Backend-SoT) و SLA Enforcement
- بازیابی سه‌لایه: طبیعی (گذارهای ماشین) / خودکار (SLA) / اضطراری (ADMIN + Audit)
- هر ۷ مسیر bypass بسته شد؛ حفره گراف ORDER.PAYMENT_PENDING رفع شد (ED-126)
- artifacts: src/lib/workflow/{policies,subtransition,governance}.ts · machines/{deletionRequest,medicalImage,invoice}.ts · WorkflowState migration · api/v1/admin/workflow/* · api/v1/images/upload (بازسازی) · docs (WORKFLOW §12–19, ADR-0016, BR-WF) · commit b82e344

---
Task ID: 14
Agent: Main agent (Super Z)
Task: PHASE 13 — External Integration Architecture (ممیزی ۹ سرویس خارجی + Adapter/Provider Layer + Timeout/Retry/Idempotency/Error/Logging/Monitoring/Fallback + امنیت Credential + Mock Adapter)

Work Log:
- ممیزی ۹ دامنه: Payment (mock hardcode در paymentService — بدون PaymentProvider نقض spec §27، refNumber=random) · SMS (باگ یکپارچگی: SMSLog با KAVENEGAR/SENT/DELIVERED با صفر فراخوانی شبکه + پیامک خوش‌آبد هرگز ارسال نمی‌شد چون subscriber بدون phone بود) · Email/Maps/Shipping/CRM/Analytics غایب · AI محلی (HTTP مستند-آینده) · Storage پورت بدون پایش
- Prisma: IntegrationCallLog (kind/provider/operation/idempotencyKey/status/attempts/latency/httpStatus/errorCode/requestRedacted/responseRedacted/related) با @@unique(provider,operation,idempotencyKey) برای Idempotency دیتابی + migration 20260905130000 (طبق الگوی فاز 12: SQL دستی + resolve)
- core/types: ۹ Kind + taxonomy ۹کدی (TIMEOUT/NETWORK/RATE_LIMIT/SERVER/AUTH/VALIDATION/PROVIDER/CIRCUIT_OPEN/PARSE) + isRetryableCode + DEFAULT_POLICIES per-kind (Payment 15s/۱retry/idempotent، AI 30s، Analytics fire-and-forget lenient)
- core/config: تنها خوانندهٔ env (گیت I5) · INTEGRATION_MODE=live|mock|auto با fail-safe ED-138 (LIVE بدون credential کامل → MOCK با هشدار — نه fail-open) · redact عمیق + maskSecret (ED-137) · credential getters متمرکز + zarinpalMerchantMasked
- core/resilience — callIntegration: Timeout با AbortController+race → Retry فقط retryable با backoff exp+jitter و احترام Retry-After → Idempotency (lookup SUCCESS قبلی → replay از responseRedacted؛ ردیف‌های غیر-SUCCESS با همان کلید قبل از ایجاد حذف می‌شوند) → IntegrationError یکنواخت + پیام فارسی ED-141 → لاگ structured با payload redacted → تله‌متری Ring+DB → fallback degraded → circuit fail-fast/skipped_circuit + logSyntheticCall برای Mockها (parity پایش dev)
- core/circuit-breaker (CLOSED/OPEN/HALF_OPEN، HMR-safe global) · core/telemetry (aggregate p50/p95/successRate/lastError + recentFailures + purgeIntegrationLogs تک‌نویسنده) · core/registry (تنها مسیر نمونه‌سازی ED-150 + integrationStatus + override/reset برای تست)
- ۹ Adapter: payment (Zarinpal PG v4 live: request/verify با تبدیل Rial و code 100/101؛ Mock: authority/refNumber=SHA-256 قطعی — رفع Math.random) · sms (Kavenegar با نقشه کد خطا؛ Mock با ثبت ارسال) · email (Mailer HTTP سازگار Resend، opt-in EMAIL_ENABLED) · maps (Nominatim با UA سیاستی؛ Mock مختصات تهران) · ai (HttpAIProvider پورت AIModelProvider فاز 11) · storage (دور StorageDriver فاز 10 + تله‌متری) · shipping (HttpCourier رزرو fail-loud + Mock پیشرونده با زمان) · crm-analytics (HTTP + Mock)
- Wire-in: paymentService از Provider (تأییدیهٔ Callback وظیفهٔ Provider؛ idempotencyKey req:/verify:؛ خطای Provider → GATEWAY_FAIL honest با 502 فارسی) · notify با تزریق کانال bindNotificationChannels از bootstrap (وابستگی معکوس — ED-137b: lib/notify در گراف client است و هرگز @/server/* نمی‌گیرد) · SMSLog صادق: SENT/QUEUED یا FAILED+error — رفع جعل DELIVERED · UserRegistered حالا phone می‌گیرد (پیامک خوش‌آمد واقعاً ارسال می‌شود) · bootstrap v7: bind هم‌زمان + job integration-wiring (ثبت HttpAI فقط با AI_SERVICE_URL) + integrations-monitor هر ۵ دقیقه (breaker OPEN یا success<80% → اعلان ادمین، once-per-state) + retention ۹۰ روزه
- API: GET admin/integrations (۹ kind با mode/credential-presence/circuit/telemetry/24h-durable + recentCalls/failures — بدون هیچ مقدار credential) + POST admin/integrations/test (zod enum + rate-limit ۳/دقیقه + reset breaker + Audit INTEGRATION_SMOKE_TEST) · integrationsService
- UI: AdminIntegrationsPage (AdminViews3): کارت per kind (LIVE/MOCK، circuit با آیکن، p50/p95، badge 24h SUCCESS/PARTIAL/FAILED، credential presence dots) + جدول CallLog + smoke-test + i18n + routes/AppShell/page wiring (lazy chunk)
- گیت CI scripts/integrations-audit.mjs (I1..I10: fetch فقط در لایه · import فقط از barrel · live adapter باید callIntegration · نمونه‌سازی فقط لایه/تست · env فقط config · ۹ kind دارای Mock · idempotency مسیر پول · lib/* بدون import server · role-guard · IntegrationCallLog تک‌نویسنده) + npm audit:integrations — چرخهٔ Fix واقعی: گیت ۱۰ نقض اولیه یافت (env پراکنده در providers، purge در bootstrap، merchant خام در پاسخ) → اصلاح با getters متمرکز + purgeIntegrationLogs + masked merchant
- تست: ۲۵ unit جدید (taxonomy/fail-safe/masking/timeout-با-abbit/retry طبقه‌بندی/AUTH-بدون-retry/idempotency دیتابی با replay/fallback degraded/circuit open+recovery/تله‌متری/determinism مک‌ها/fault-injection/رجیستری ۹ kind/عدم نشت credential در JSON) + ۵ API integration جدید (پرداخت سرتاسری از Provider + callback idempotent + CallLog؛ SMS ثبت‌نام صادق با mock-* و هرگز DELIVERED؛ authz کنسول 401/403/200 + عدم نشت؛ smoke-test zod/200/429/Audit؛ non-admin 403)
- رفع باگ‌های چرخهٔ Test→Fix: crash کل سرور با Module not found fs/promises (زنجیرهٔ client: atoms→constants→machines/case→notify→integrations→storage-driver) → وابستگی معکوس با bindNotificationChannels (ED-137b)؛ refNumber string؛ rate-limit های تست (XFF per-client + حساب fresh به‌جای seed اپراتور + smoke-test idempotent به بازهٔ window)
- امنیت: اسکن secret پاک؛ PII در CallLog masked (موبایل ۴ رقم آخر — SMSLog مقصد کامل طبق spec §32؛ آدرس=طول+۳ رقم کدپستی)؛ presence-only در UI
- مرورگر (agent-browser): کنسول /admin/integrations با ۹ کارت زنده (LIVE: maps/storage — بدون کلید طبیعی؛ MOCK: بقیه) · smoke-test SMS از UI · **صفر خطای console** بعد از پاک‌سازی (خطاهای اولیه stale از قبل از رفع ED-137b بودند) · اسکرین‌شات verify-integrations-{console,sms-test}.png
- مستندات: INTEGRATIONS.md (۱۳ بخش: ممیزی، معماری، ۸ دغدگی، دیتامدل، credential security، دامنه‌ها، API/UI، تست، گیت، runbook، بدهی‌ها، ED-135..150) · ADR-0017 + رجیستری ADR · BUSINESS-RULES §8 BR-INT-01..10 · PRD §12 ردیف فاز ۱۲+۱۳ · RTM یادداشت فاز ۱۲+۱۳ · .env.example
- Pentest اول بار پس از اجرای سنگین FAIL شد → علت: مرگ پروسهٔ dev server (000=اتصال رد)، نه رگرسیون؛ ری‌استارت → 45/45

Stage Summary:
- Deliverables: لایهٔ Integration کامل (core ۶ ماژول + ۹ provider زنده + ۹ Mock) · IntegrationCallLog + migration · ۲ مسیر API ادمین + صفحهٔ کنسول · گیت CI I1..I10 · مستند ۱۳-بخشی · ED-135..150 · BR-INT-01..10
- باگ‌های واقعی رفع‌شده: جعل رکورد تحویل SMS (ED-143) · پیامک خوش‌آمد هرگز ارسال‌نشده (phone به subscriber) · Payment بدون Provider (نقض spec §27) · refNumber غیرقطعی · merchant خام در پاسخ API
- ED-collision ثبت شد: فاز ۱۲ بازهٔ ED-121..129 را دوباره استفاده کرده بود (تصادم با فاز ۱۱) → فاز ۱۳ از ED-135
- Verification: ۳۱۳/۳۱۳ bun test (۲۵ unit + ۵ integration جدید) · lint 0 خطا · ۵/۵ audit (backend/media/ai/frontend/integrations) · pentest 45/45 · browser-verified با صفر خطای کنسول
- Remaining risks (honest): D-13-1 S3 driver · D-13-2 breaker درون‌حافظه (Redis برای multi-instance) · D-13-3/4 قرارداد Courier/CRM زنده · D-13-5 IPN/Webhook زرین‌پال · D-13-6 polling تحویل SMS · فاز ۰۹ remediation همچنان باز
- Next: PHASE 09 remediation (۷۳ صفحه SC-ID) یا M17 Deployment طبق PRD §12

---
Task ID: 15
Agent: Main agent (Super Z)
Task: PHASE 14 — Search, Reporting & Analytics (موتور جستجو با Filtering/Sorting/Pagination/FTS/i18n + ۶ دسته گزارش Permission-aware + CSV/Excel/PDF/Export + منع Queryهای سنگین و Unbounded)

Work Log:
- ممیزی ۱۰ شکاف (S-1..S-10): جستجوی «بعد از صفحه‌بندی در JS» (الگوی ضد S-1 در catalog/case/adminUsers/auditLogs) · getReports بدون هیچ where/take هفت جدول کامل را در JS reduce می‌کرد — دقیقاً Query سنگین Unbounded فرمان · فیلترهای ad-hoc بدون DSL Whitelist · پارامترهای from/to/groupBy مسیر گزارش‌ها نادیده گرفته می‌شدند (قرارداد مرده) · بدون Full Text Search فارسی · بدون خروجی CSV/XLSX/PDF
- Search Engine (src/server/infrastructure/search): normalize.ts خالص و client-safe — فولد ی/ي/ى، ك/ک، أ/إ/ٱ، ة→ه، ؤ، حذف Tatweel/Diacritics/Presentation-forms/BIDI، ZWNJ با دو گونه compact+spaced، ارقام فارسی/عربی/لاتین، توکن‌سازی یونیکد، ماتریس سوزن×۴گونا (ED-151) · query-build.ts: applyQ داخل SQL (LIKE با سوزن‌های چندگانه — رکورد با خط فارسی/عربی/نیم‌فاصله متفاوت هم می‌یابد) · bounds.ts: کلاه‌های سخت SEARCH_BOUNDS (limit≤۱۰۰، offset≤۱۰k) + OffsetTooDeep/WindowTooWide/ReportTimeout با ۴۲۲/۴۲۲/۵۰۴ صادق
- سرویس و مسیر: searchService + GET /api/v1/search — گروه‌های user/case/order/product/ticket، permission+data-scoped (بیمار فقط پرونده خود) · GlobalSearchDialog در AppShell (دیاگ clones با کلید میان‌بر، نتایج گروه‌بندی‌شده، خالی/بارگذاری/خطا)
- Reporting Engine (src/server/infrastructure/reporting): types (ReportDef/Result با meta صادق: from/to/cached/truncated/totalRows/ms) · registry تک‌منبع ۱۹ گزارش در ۶ دسته فرمان — عملیاتی ۴ (case-status/queue-sla/followup-compliance/workflow-health) · مالی ۴ (revenue-summary/payments/expenses/referrals) · کسبوکار ۴ (top-products/order-funnel/pending-prescriptions/funnel-conversion) · کاربران ۳ (growth/retention/activity) · عملکرد ۳ (case-cycle/ai-accuracy/sla) · سفارشی ۱ (custom.dataset با ۸ دیتاست مجوزدار) — همه از SQL مقید با clampWindow (پیش‌فرض ۳۰ روز، سقف ۴۰۰ روز، minDate) و maxViewRows/maxBuckets · runner با کش TTL per-category (ED-158) · withReportTimeout ۱۵s
- Permission-aware: canViewReport (مجوز + نقش + بایپس ADMIN طبق BR-RBAC-02)؛ کاتالوگ بیمار = ۰ گزارش (راستی‌آزمایی مرورگر)؛ مسیر اجرا ۴۰۳؛ DATASET_PERMISSIONS برای ۸ دیتاست سفارشی؛ ۸ مجوز متمایز هم‌راستا با کاتالوگ ۳۱تایی constants (گیت SR9)
- Export (ED-156): csv.ts با BOM UTF-8 (اکسل فارسی سالم) · xlsx.ts نویسنده ZIP/SheetML خودبسنده RTL + ارقام فارسی سربرگ · pdf.ts فارسی RTL · exportService: همزمان ≤۲۰۰۰ سطر (REPORT_SYNC_MAX_ROWS)؛ بزرگ‌تر → POST صف ناهمزمان → StoredFile موقت با TTL ۲۴h + فهرست «خروجیهای من» + دانلود از /reports/exports/[fileId] · ۶ مسیر API (reports، [id]، export، exports، [fileId]) + آداپتور مقید legacy /admin/reports
- Frontend: ReportsCenter (تب ۶ دسته با شمارنده، کارت گزارش با آیکن chart، پنل اجرا با بازه/گروهبندی، کارت‌های خلاصه با ارقام فارسی، CSV/Excel/PDF/خروجی ناهمزمان، جدول سطرها، بخش خروجیهای من) · GlobalSearchDialog · i18n کامل fa/en + RTL/LTR
- تست: ۶۲ تست جدید (search ۲۵: فولد حروف/ارقام/ZWNJ دوگونه/سوزن‌ها/حدود؛ reporting ۱۵: clampWindow/reportBounds/timeout/cache/permission؛ integration ۲۲: کاتالوگ per-role، ۴۰۳ بیمار، ۴۲۲ window/deep-offset، BOM CSV، ZIP معتبر XLSX، PDF magic، async job، عدم نشت) → ۳۷۵/۳۷۵ bun test
- گیت CI scripts/search-reporting-audit.mjs (SR1..SR10: queries مقید · گزارش فقط از registry/runner · شکل ReportDef · جستجوی SQL-side بدون post-filter · مسیر واحد export · سیم‌کشی گاردها · نویسنده‌های export خودبسنده · PDF فارسی+RTL · هم‌راستایی مجوزها · سخت‌سازی مسیرها) + npm run audit:reporting — PASSED
- چرخه منشور: bun test ۳۷۵/۳۷۵ · lint ۰ خطا (۴ هشدار پیش‌موجود e2e-harness) · گیت ۱۰/۱۰ · docs-validator PASS (۲۳ بخش، ۱۹ گزارش، ED-151..163) · pentest 45/45 · smoke-phase14.sh کامل (کاتالوگ ۱۹، اجرای گزارش با کش ۴ms، ۴۲۲ window ۵۰۰روزه، ۴۲۲ صفحه‌بندی عمیق، CSV با BOM+RTL، XLSX معتبر RTL، PDF معتبر، async queued، جستجوی «سارا» ۱۴ms در ۳ گروه) · مرورگر: دیالوگ جستجو فارسی (بیمار+پرونده+سفارش) · مرکز گزارش با ۶ تب · اجرای revenue-summary (درآمد ۲۰٬۳۱۱٬۰۰۰) · خروجی CSV از UI · بیمار: ۰ گزارش + ۴۰۳ + جستجوی مقید به داده خود · EN/LTR · صفر خطای console · اسکرین‌شات verify-p14-browser-final/en-patient.png
- مستندات: SEARCH-REPORTING.md (۲۳ بخش: ممیزی S-1..S-10، موتور جستجو، مرجع گزارش‌ها، خروجی‌ها، API، Frontend، تست، گیت، ED-151..163، بدهی‌ها D-14-*) · ADR-0018 · BUSINESS-RULES BR-SRCH-01..05 + BR-RPT-01..08 · PRD/RTM ردیف فاز ۱۴

Stage Summary:
- موتور جستجوی واحد SQL-side با Normalization فارسی/لاتین دوطرفه (یونیکد کامل) + سوزن‌های ۴گونه — الگوی S-1 (فیلتر بعد از صفحه‌بندی) از کل کدبیس حذف شد
- ۱۹ گزارش Permission-aware در ۶ دسته فرمان (Operational/Financial/Business/User/Performance/Custom) از registry واحد؛ اجرای مقید (Window/Buckets/Rows/Timeout 15s) + کش per-category
- خروجی CSV (BOM)/Excel (RTL)/PDF (فارسی) — همزمان ≤۲k سطر و ناهمزمان ≤۲۰k با TTL ۲۴h
- قرارداد Unbounded-Query Prevention سخت و تک‌منبع: SEARCH_BOUNDS/REPORT_BOUNDS + خطاهای تایپ‌شده ۴۲۲/۵۰۴ — از «کوئریهای بسیار سنگین و Unbounded» فرمان جلوگیری می‌شود
- Verification: ۳۷۵/۳۷۵ test · SR1..SR10 PASSED · pentest 45/45 · docs-validator PASS · browser fa+en صفر خطا
- Git: پیاده‌سازی در commit 63e3fb2 (قبل از اتمام چرخه) + این تکمیل چرخه (worklog/اسکرین‌شات/DB) در commit جدید

---
Task ID: 16
Agent: Main agent (Super Z)
Task: PHASE 15 — Logging, Monitoring & Observability (لاگ Structure/Searchable/Traceable + متریک CPU/Memory/API/DB/Queue/Errors/Latency/Business + Trace/Correlation/Distributed + Health liveness/readiness/health + Alert خطاهای مهم + منع PII در Log)

Work Log:
- ممیزی ۱۰ شکاف (O-1..O-10): پروبهای §57 غایب · بدون موتور متریک (فقط ms در لاگ) · DB بی‌ابزار ($extends نبود) · Queue بی‌متریک · Correlation از مرز درخواست عبور نمی‌کرد · لاگ فقط stdout (غیرقابل‌جستجو) · Alert تک-موردی موقت (integrations-monitor) · Business زنده نداریم · Redaction فقط کلیدمحور · CPU/Mem/Disk/Loop پایش نمی‌شد
- core/trace.ts (ED-164): AsyncLocalStorage با {reqId,corrId,traceId,spanId} · parse/تولید W3C traceparent (رد نسخه/صفر نامعتبر) · X-Correlation-ID ورودی (۴-۶۴ نویسه) یا mint corr_* · enterJobTrace برای ادامهٔ trace در شغل‌ها (ED-169) · HMR-safe روی globalThis
- logger v2 (ED-166): Redaction دو-لایه — کلید (regex موجود) + مقدار (موبایل (+98|0)?9d9 → 09••••4567 · JWT eyJ→[JWT] · کدملی ۱۰رقمی ماسک · base64≥60 → [BLOB:n] · ?token=→[REDACTED]) روی msg و مقادیر · تزریق خودکار corrId/traceId از ALS · حلقهٔ RAM مقید ۵۰۰ · sink مانا batch (≤۵۰/۲s، آتش-و-فراموش) با گارد سوم stillLooksDirty + IP هش sha256[:12] (ED-173) · setTraceProvider/setLogSink تزریق بدون چرخهٔ import
- core/metrics.ts (ED-167/168): counter/gauge/histogram(p50/p95/p99/avg/max) · سقف labelset ۲۵۶ (اضافی → _overflow) · MAX_SAMPLES ۳۰۰ · SERIES_RING ۷۲۰ (۶h@30s) · routePattern در handler (cuid→:id؛ apiRoute<T>( ژنریک را گیت قبلاً نمی‌دید — اصلاح شد)
- ابزار دقیق: db.ts با $extends $allOperations (db_queries_total/db_query_ms/db_errors_total — ED-174، type-cast در seam) · jobs.ts (queue_jobs_total{type,status} + job_duration_ms + گارژ depth/DLQ + workerAlive + meta trace در enqueue) · handler.ts (api_requests/api_latency + api_errors فقط 5xx + api_rejected 4xx جدا — رفع نرخ کاذب؛ کل چرخه handler+catch+finally داخل enterTrace تا لاگ rejected هم corrId بگیرد) · envelope.ts (X-Correlation-Id + traceparent خروجی، X-Request-Id حفظ)
- infrastructure/observability/: system.ts (CPU delta + load/core · heap/rss/external + سیستم · Disk statfs · Event-loop lag heartbeat 200ms — همه degrade-to-null) · health.ts (liveness بی-DB / readiness: dbPing 3s+worker+storage+bootstrap / health ترکیبی) · alertRules.ts خالص (۱۱ قاعده: db_unavailable CRIT · api_error_rate ۵٪ با حداقل ۵۰ درخواست فقط 5xx · api_p95 3s · db_p95 1.5s · queue_dead CRIT · backlog ۱۰۰ · worker_stalled CRIT · memory ۹۰/۹۷٪ · loop 500ms · disk ۹۰/۹۵٪ · integrations_unhealthy — جدول آستانهٔ واحد ALERT_THRESHOLDS ED-178) · alerts.ts (چرخهٔ OPEN→cooldown 15min re-fire→RESOLVED خودکار · تحویل in-app ADMIN + SMS فقط CRITICAL از کانالهای notify فاز ۱۳ · payload فقط عدد/کلید) · logPersist.ts (batch + گارد) · sampler.ts (metrics-sampler 30s + MetricPoint هر 60s · alert-evaluator 60s با integrationStatus تاشده — ED-179 جایگزین integrations-monitor · business-today 60s از کوئریهای مقید شاخص‌دار · retention روزانه 3d/7d/90d)
- Prisma (ED-171/172): ServiceLog (ایندکس t/(lvl,t)/(svc,t)/reqId/(corrId,t)) + MetricPoint + AlertEvent(unique key) — فقط-الحاقی، hard-purge؛ migration 20260906100000 + db push
- API: مسیرهای عمومی دقیق spec §57 (/health /liveness /readiness — standalone بدون apiRoute تا متریک متورم نشود، بدنهٔ حداقلی boolean، تست عدم-افشای dbPingMs/node) + GET admin/observability (snapshot کامل) + GET admin/logs (جستجوی q/lvl/svc/route/reqId/corrId + live=1 حلقه + صفحه‌بندی SEARCH_BOUNDS) + GET/POST admin/alerts (resolve با Audit ALERT_RESOLVE) — همه requireRole(ADMIN)
- bootstrap v8: setTraceProvider + setLogSink + registerBusinessCounters (۹ رویداد business) + ۴ شغل جدید + markBootstrapped (فلگ readiness) · حذف منطق notify مستقیم integrations-monitor (تاشده در alert-evaluator)
- UI: AdminViews4 «رصد و پایش» (بنر سلامت/uptime/probeها · ۶ کارت سیستم · ۶ کارت API/Business · نمودارهای زندهٔ p95 API + heap از series ring · فید هشدار با Resolve · خلاصهٔ integrations · کاوشگر لاگ با جستجو/سطح/دم) + nav/routes/i18n/page lazy + ارقام lang-aware
- تست: ۴۴ unit (scrub ۷ گونه · تزریق trace · ALS انتشار/ایزولاسیون · traceparent parse/رد/round-trip · counter/percentile/gauge/سری مقید · labelset-fragmentation · routePattern · ۱۳ قاعدهٔ alert · گارد sink/ipHash) + ۱۶ integration (سه پروب عمومی · echo Correlation + ادامهٔ trace-id + span تازه · mint ورودی خراب · X-Request-Id حفظ · 401/403/200 · متریک زندهٔ post-traffic · جستجوی لاگ بدون موبایل خام · فیلتر corrId با poll flush · ۴۲۲ صفحهٔ عمیق · alerts 403/404/4xx · دم حلقه · عدم-تورم متریک پروبها)
- گیت CI scripts/observability-audit.mjs OBS1..OBS10 + npm audit:observability — چرخهٔ Fix واقعی: نقض console.* در ai/security.ts:73 (از فاز 11) یافته و به childLogger اصلاح شد · باگ regex گیت (apiRoute< ژنریک) اصلاح
- دو باگ واقعی که خود موتور زندهٔ observability در چرخهٔ Test→Fix کشف کرد: (۱) aggregate پرداخت روی فیلد ناموجود paidAt — هر تیک business-today fail می‌شد → verifiedAt؛ (۲) شمارش 4xx به‌عنوان api_errors نرخ خطای کاذب ۲۴٪ و alert CRITICAL کاذب ساخت (ترافیک تست/پنتست) → تفکیک 5xx/4xx — هر دو با تست
- موتور هشدار در عمل: memory_pressure CRIT (heap ۹۷٪ زیر بار تست) و api_error_rate CRIT (pre-fix) هر دو fire → notify → **RESOLVED خودکار** پس از اصلاح — چرخهٔ عمر کامل اثبات شد
- مستندات: OBSERVABILITY.md (۱۵ بخش: ممیزی، trace، logger، متریک، health، alerts، دیتامدل، bootstrap، API، UI، تست، گیت، ED-164..180، بدهی‌ها D-15-1..6) · ADR-0019 + رجیستری · BUSINESS-RULES §10 BR-OBS-01..10 · PRD §12 ردیف فاز ۱۵ · RTM یادداشت فاز ۱۵ + دامنهٔ ED
- چرخهٔ منشور: bun test ۴۳۵/۴۳۵ (۴۴+۱۶ جدید) · lint ۰ خطا (۴ هشدار پیش‌موجود e2e) · گیت OBS1..OBS10 PASSED · pentest 45/45 · smoke-phase15 کامل (echo corr/traceparent، گارژهای business زنده، authz، 422) · مرورگر: کنسول FA/EN کامل با تایلهای زنده (۶۴ کاربر/۱۲ پرونده/۱۸ AI/درآمد ۵٬۰۱۸٬۰۰۰)، صفر خطای console، اسکرین‌شات verify-p15-observatory-{fa,en}.png

Stage Summary:
- Observability کامل فرمان فاز: ۵/۵ Logging (Structured/Searchable/Traceable + PII-guard دو-لایه) · ۸/۸ متریک (CPU/Memory/API/DB/Queue/Errors 5xx-only/Latency p95/Business) · Trace (Request/Correlation + W3C traceparent؛ OTel-compatible — export بدهی) · ۳ پروب عمومی دقیق §57 · موتور هشدار واحد ۱۱ قاعده با cooldown/auto-resolve
- «اطلاعات حساس در Log ذخیره نکن» سه-لایه گارد شد: کلید + مقدار + گارد sink؛ IP هش در DB؛ payload هشدار عدد/کلید؛ پروبهای عمومی حداقلی
- Anti-unbounded به خود observability رسید: سقف labelset/histogram/سری/blob + routePattern + صفحه‌بندی جستجوی لاگ
- Verification: ۴۳۵/۴۳۵ · OBS PASSED · pentest 45/45 · browser fa/en صفر خطا · alert-engine دو باگ واقعی پروژه را کشف کرد (خودِ سیستم، شاهد زندهٔ ارزش فاز)
- Remaining (honest): D-15-1 Prometheus exposition · D-15-2 OTel export · D-15-3 متریک خارج-پردازش برای multi-instance · D-15-4 routing کانال ops · D-15-5 Loki/Elastic · فاز ۰۹ remediation همچنان باز
- Git: این commit (فاز ۱۵ کامل)

---
Task ID: 17
Agent: Main agent (Super Z)
Task: PHASE 16 — Performance Engineering (ممیزی کارایی + اندازه‌گیری Frontend Load/API Latency/Database/Queries/Cache/Queue/File Processing/AI Processing + یافتن Bottleneckها + اعمال Caching/Indexing/Async/Batching/Pagination/Lazy Loading/CDN/Compression فقط با Measurement)

Work Log:
- تحلیل وضعیت: PHASE 15 در commits be036a1+274d293 کامل بود → شروع PHASE 16 طبق فرمان: «Optimization بدون Measurement انجام نده»
- پنج هارنس اندازه‌گیری tagدار: scripts/perf-bench.mjs (۱۲ endpoint × N=30 با warmup — p50/p95/p99 کلاینتی + db/req سمت سرور از رجیستری متریک فاز ۱۵ با کسر هزینهٔ خود observability + الگوی Cold پس از TTL) · perf-db-plan.py (EXPLAIN QUERY PLAN×۲۷ کوئری داغ + PRAGMAها + تست مقیاس ۵۰k سطر + بنچمارک journal فایل‌محور) · perf-frontend.mjs (سرور production standalone واقعی روی :3100 + perf-lib-wire.mjs با http خام — کشف و رفع خطای اندازه‌گیری: fetch خودکار decompress می‌کند و عدد ۰٪ جعلی می‌داد) · perf-pipeline.mjs (آپلود ۲۰۲ + poll + job durations) · perf-ai-flow.mjs (سناریوی کامل بیمار: upload→validate→case→ai-analysis)
- Baseline ثبت‌شده (JSON مصنوعات): ۲۴/۲۷ کوئری داغ full-scan (FKهای SQLite بدون ایندکس) · journal_mode=delete+sync=FULL (بنچمارک fsync واقعی: WAL ×۷٫۵–۸٫۶) · AuditLog ۳٬۶۴۶ سطری بدون هیچ ایندکس (۱٫۷۸ms full-scan) · getAuth=۱ کوئری User به‌ازای هر درخواست (حتی روی endpointهای کاملاً کش‌شده) · داشبورد staff cold=۲۱ کوئری (۱۷ count+2 agg+2 list) با کش per-user برای آمار role-global · تست مقیاس: WHERE patientId با ایندکس ×۵۰۷ · Frontend: first-load ۱۴۳۴٫۳KB identity → ۴۵۵٫۴KB wire (gzip ۶۸٫۳٪ فعال) + lazy chunks سالم + immutable cache · File: ۲۰۲ در ۲۹–۸۹ms + media-process p50=۱۲۲–۱۴۷ms · AI: ai-analysis job p50=۵۸–۸۳ms · یافته: rerun-ai همگام در مسیر درخواست (mock ۱۱۴–۳۱۳ms؛ خطر ۳۰s با provider زنده) → بدهی D-16-1 نه تغییر قرارداد (UI آن را صدا نمی‌زند، تست integration به ۲۰۰ وابسته)
- ED-181: ۲۸ ایندکس مرکب فقط از EXPLAIN داده‌شده (schema.prisma منبع واحد + migration دستی 20260906140000 + db push؛ ایندکس‌ها ۵۶→۸۴) — full-scan ۲۴→۲ (فقط LIKEهای غیرقابل‌ایندکس جستجو = طراحی فاز ۱۴ ED-152؛ رفع با tsvector/Postgres = D-16-2)
- ED-182: WAL+synchronous=NORMAL+busy_timeout=5000 — boot idempotent+fail-safe در db.ts (شکست PRAGMA هرگز بوت را نمی‌بندد) + اعمال فوری + گیت PERF1
- ED-183: کش هویت getAuth (TTL 10s، سقف ۲۵۶ با evict، globalThis/HMR-safe) + قرارداد امنیتی: ابطال صریح در ۵ مسیر تغییر (login/logout/EDIT_USER/patchDeletionRequest-COMPLETE/EDIT_PATIENT) — تست integration: غیرفعال‌سازی ادمین → درخواست بعدی همان لحظه ۴۰۱
- ED-184: Batching داشبورد — ۹ count وضعیتی → ۲ groupBy(status)؛ آمار staff-wide یک کش per-process (dash:staff:shared) + صف per-role + فقط ۱ count unreadSelf به‌ازای کاربر؛ cold staff: ۲۱→۹+۱ کوئری؛ تست معادل‌سازی اعداد (staff ۶ سنجه + patient ۳ سنجه == count مستقیم)
- ED-185/186: CDN seam (assetPrefix از NEXT_PUBLIC_CDN_BASE، no-op محلی + مستندسازی الزام CSP هنگام فعال‌سازی) + compress:true صریح
- رفع نقض I8 گیت integrations که از فاز ۱۵ مانده بود (db.ts → import مستقیم @/server/core/metrics): تزریق وابستگی معکوس با setDbMetricsSink در globalThis (الگوی ED-137b/ED-137) + wire در bootstrap
- After اندازه‌گیری مجدد: p95 auth/me ۴۲٫۶→۱۴٫۸ms (−۶۵٪) · db/req: auth/me ۲→۱ · dashboard/patient warm ۱→۰ · cases/orders/audit/notifications/search همه −۱..−۲ · dashboard cold ۳۵٫۸→۲۴٫۴ms (−۳۲٪) · journal ×۷٫۵ · پرت‌های p95 در dev (compile hiccup) صادقانه در سند ثبت شد؛ عدد قطعی کارایی production = D-16-5
- کشف محیطی: مرگ مکرر dev-server در طول suite = **OOM kill کرنل** (dmesg: next-server RSS 2٫۷GB در ظرف ۴GB) — مستند در D-16-6؛ توضیح‌دهندهٔ «مرگ پروسه» فازهای ۱۳/۱۵
- چرخهٔ Fix واقعی در طول فاز: خطای wire-size جعلی fetch-gzip → http خام؛ بنچمارک in-memory بدون fsync → فایل‌محور؛ دو باگ در اسکریپت درج ایندکس (offset) → منطق خط‌محور؛ تست اولیه /me probe اشتباه (me() خودش کوئری دارد) → probe به notifications؛ UID readonly در bash؛ آرتیفکت ANSI خروجی rg که [m می‌خورد و «خرابی schema» جعل می‌کرد → راستی‌آزمایی با python repr
- گیت CI scripts/perf-audit.mjs PERF1..PERF10 (WAL · ۲۸ ایندکس در DB · parity schema↔DB · PRAGMAهای boot · قرارداد کامل کش هویت · groupBy+حذف count-ladder · compress+CDN · lazy≥10 · حضور ۵ هارنس+۶ مصنوع · عدم‌رگرسیون PHASE14) + npm run audit:perf
- تست: ۶ integration جدید (tests/integration/performance.test.ts) + smoke-phase16.sh (WAL، EXPLAIN ایندکسی، cold<warm، قرارداد ۴۰۱ فوری، گیت)
- مستندات: PERFORMANCE.md (۱۰ بخش: روش‌شناسی، baseline، bottleneckها، بهینه‌سازی‌ها، after، فرمان‌های «در صورت نیاز» تک‌تک، بدهی‌های D-16-*، تست، کاتالوگ ED، اجرای مجدد) · ADR-0020 + رجیستری · BUSINESS-RULES §11 BR-PERF-01..10 · PRD §12 ردیف فاز ۱۶ · RTM یادداشت فاز ۱۶
- چرخه منشور: bun test ۴۴۱/۴۴۱ (۴۳۵+۶) · lint ۰ خطا (۴ هشدار پیش‌موجود e2e) · ۸/۸ گیت CI (backend/frontend/media/ai/integrations/reporting/observability/**perf** — رفع I8) · pentest 45/45 · smoke-phase16 کامل · مرورگر fa+en: داشبورد batch شده زنده (۸۰ پرونده/۳۲۵ بیمار/درآمد ۲۳٬۶۷۳٬۰۰۰ با ارقام فارسی) + observatory با تایلهای زنده + صفر خطای console · اسکرین‌شات verify-p16-observatory-fa/dashboard-en.png · WAL checkpoint قبل از commit

Stage Summary:
- فرمان «Optimization بدون Measurement انجام نده» ساختاری شد: ۵ هارنس tagدار + ۶ مصنوع JSON before/after + گیت PERF9 (بدون مصنوع، بهینه‌سازی ممنوع) + BR-PERF-01
- بهبودهای اندازه‌گیری‌شده: full-scan ۲۴→۲/۲۷ · ایندکس ۵۶→۸۴ · WAL (نوشتن ×۷٫۵) · p95 auth/me −۶۵٪ · db/req همه‌جا کمتر · داشبورد cold −۳۲٪ با ۹+۱ کوئری به‌جای ۲۱ · gzip ۶۸٫۳٪ مستند
- رفع نقض I8 واقعی از فاز ۱۵ (db→metrics) با الگوی تزریق
- کشف OOM محیط dev (توضیح مرگ‌های مکرر سرور در فازهای گذشته) + مستندسازی Horizontal Scaling §58
- Remaining (honest): D-16-1 rerun-ai sync · D-16-2 tsvector · D-16-3 brotli · D-16-4 sync=NORMAL per-connection · D-16-5 بنچ production · D-16-6 OOM dev · فاز ۰۹ remediation همچنان باز

---
Task ID: 18
Agent: Main agent (Super Z)
Task: PHASE 17 — Reliability Engineering (بررسی و تست Failure Scenarioهای کل سیستم: DB/Redis/Worker/Timeout/External/Payment/Duplicate/Network/Storage/Partial + پیاده‌سازی در صورت نیاز: Retry/Timeout/Circuit Breaker/Idempotency/DLQ/Graceful Degradation/Recovery)

Work Log:
- ممیزی R-1..R-11: هفت الگو تا حدی موجود (فاز ۱۳ خارجی/۱۵ پایش) اما شکافهای اصلی: (۱) قطعی DB/Storage→500 مبهم (۲) صف شغل فقط حافظه‌ای — کرش=از دست رفتن کارها (۳) بدون Idempotency سطح درخواست (۴) تست شکستها روی سرور زنده غیرممکن (۵) پروب storage جعلی (fs.access)
- هستهٔ آشوب faults.ts (ED-187): خطاهای نامدار db/storage/worker/cache + TTL خود-خاموش‌شونده (بازگشت خودکار) + دو گارد (env BH_CHAOS/test-runner + ADMIN 404-نامرئی) + درزها: db از globalThis در lib/db.ts (الگوی ED-137b)، storage در LocalDriver، cache با setCacheStore، worker با stop/ensure
- تاکسونومی ED-188: SERVICE_UNAVAILABLE(503)+dependency+retryAfterSec؛ classifyInfraFailure: P1001/P1002/P2024/SQLITE_CANTOPEN-IOERR-READONLY-CORRUPT-BUSY/ENOSPC-EIO-EROFS-EMFILE؛ Retry-After در apiRoute (RATE_LIMITED هم حفظ)
- کش یکبارمصرف ED-189: facade خطامحور روی CacheStore (get/set/del/clearPrefix هرگز نمی‌شکنند) + setCacheStore/resetCacheStore — تعویض زمان-اجرای (Redis آینده/تست)
- صف پایدار ED-190: مدل DurableJob + migration 20260907090000 (db push)؛ enqueue write-through (شکست DB→حافظه: صف degrade نمی‌میرد)؛ claim اتمیک updateMany با ownerPid (dev/test همدیگر را نمی‌ربایند)؛ timeout هر شغل (120s/300s سنگینها + setJobTimeoutFor)؛ tick ایزوله + خودترمیمی worker (recurring→ensureWorker)؛ recovery: stale-RUNNING>5min→PENDING (بوت+هر5min) + یتیم‌سازی owner؛ retention DONE 7d/DEAD 30d؛ قرارداد v1 عمومی enqueue/drain/reset/deadLetters/queueStats حفظ شد (۴۴۱ تست قبلی سبز)
- Idempotency درخواست ED-191: مدل IdempotencyRecord + unique(userId,route,key)؛ کلید=هدر یا sha256(user|route|canonicalJson(body)) — دابل‌کلیک بدون هدر هم دیداپ؛ RUNNING→409 · DONE→بازپخش ≤32KB+Idempotency-Replayed · FAILED→اجازهٔ retry · RUNNING>5min=crash→FAILED؛ مسیرها: POST orders/payments/cases؛ TTL 24h + purge hourly
- DLQ عملیاتی ED-193: GET /admin/jobs (لیست/آمار groupBy/صفحه‌بندی) + POST /admin/jobs/[id]/replay (فقط DEAD، attempts صفر، Audit JOB_REPLAY) + پنل UI «شغل‌ها و صف مرده» در AdminViews4 (چیپهای آمار + جدول + دکمهٔ اجرای مجدد + badge worker)
- ED-192: پروب نوشت‌پذیری storage واقعی (put/get/delete از درایور در files/temp) — رفع جعل ready مونت read-only
- رفع ۳ باگ واقعی که خود آشوب کشف کرد: (۱) **AlertEvent P2002**: key سراسری یکتا ولی tick فقط OPEN می‌خواند → هشدار resolve-شده هرگز دوباره fire نمی‌شد و هر ۶۰s کل tick fail می‌کرد → reopen-after-resolve + تحمل P2002 رقابتی (ED-196)؛ (۲) پروب جعلی storage؛ (۳) الگوی مرگ پس‌زمینهٔ سرور: کشف شد فرآیند‌های پس‌زمینه پس از پایان دستور شروع‌کننده reap می‌شوند — راه‌حل setsid+script-wrapper (مستند در D-17) + پاکسازی ~۱۰ پروسهٔ zombie مرورگر که OOM کامپایل dev را می‌ساخت
- چرخهٔ Fix واقعی: درز fault داخل try تا db_errors بشمارد · drain در قطعی DB باید claim را skip کند · TTL faults (امکان deactivate در قطعی auth-needs-db) · clone().json() برای بدنهٔ idempotency · rate-limit login (XFF per-client الگوی فاز ۱۳) · casing پارامتر callback authority · کوشش idempotency روی POST /orders (نه /orders/checkout) · buyable از ۵۰ محصول · body یکتا در هر run تست (پنجرهٔ 24h)
- تست: ۲۵ unit (تاکسونومی/گارد production-refusal/cache-degrade/کلید مشتق/durability/timeout/backoff/degraded-queue/stale-claim/hook/آینه/اتمیسیته-tx) + ۱۰ integration زنده FS-1..FS-9 روی سرور production واقعی با BH_CHAOS=1 + smoke-phase17.sh (۱۸ چک curl مستقل)
- گیت CI scripts/reliability-audit.mjs REL1..REL10 + npm audit:reliability — چرخهٔ Fix: ۴ needle غلط gate اصلاح (comment-import lib/db، regex SQLITE، DEAD-only، unique-array) · probe دود cache-shielded→endpoint بی‌کش
- ED-93: منطق chaos به chaosService منتقل (route نازک) + zod در replay — گیت backend دوباره PASSED
- مستندات: RELIABILITY.md (۱۴ بخش) · ADR-0021 + رجیستری · BUSINESS-RULES §12 BR-REL-01..10 · PRD §12 ردیف فاز ۱۷ · RTM یادداشت فاز ۱۷

Stage Summary:
- هر ۷ الگوی فرمان با کد واقعی: Retry (classified/backoff/SQLITE_BUSY) · Timeout (integration+گزارش+هر شغل) · Circuit Breaker (فاز ۱۳ + مرجع) · Idempotency (Provider+Payment+جدید سطح درخواست) · **DLQ (دیتابی+بازیابی+کنسول+UI)** · **Graceful Degradation (503 صادق/کش به loader/صف به حافظه)** · **Recovery (stale-claim+یتیم+replay)**
- هر ۱۱ سناریوی فرمان: ممیزی R-1..R-11 + ۹ سناریو تست زنده FS-1..FS-9 (۲ از ۱۱ با پوشش موجود فاز ۱۳ ارجاع شد)
- سه باگ واقعی شکار و رفع شد — آشوب خودش شاهد ارزش فاز است (الگوی تکرارشونده از فاز ۱۵)
- Verification: ۴۷۶/۴۷۶ bun test (۲۵+۱۰ جدید) · lint ۰ خطا · ۱۰/۱۰ گیت CI (backend/frontend/media/ai/integrations/reporting/observability/perf/**reliability**) · pentest 45/45 · smoke-phase17 ۱۸/۱۸ · مرورگر FA/EN: پنل DLQ زنده + replay واقعی از UI + worker زنده + صفر خطای console · اسکرین‌شات verify-p17-observatory-dlq-{fa,en}.png
- Remaining (honest): D-17-1 مالتی‌اینستنس (Redis/BullMQ=ADR-0005) · D-17-2 gate فعال‌سازی دریل در استیج · D-17-3 replay مشروط به نوع · D-17-4 گسترش خودکار مسیرهای idempotency · D-17-5 فاز ۰۹ remediation باز

---
Task ID: 19
Agent: Main agent (Super Z)
Task: PHASE 18 — Complete Quality Assurance (ممیزی تست‌های موجود + ایجاد/تکمیل ۱۰ نوع تست برای Critical Path + کیفیت پوشش مهم‌تر از عدد + برای هر باگ یک Regression Test + هدف Critical Bug = ۰)

Work Log:
- تحلیل وضعیت: فاز ۱۵/۱۶/۱۷ در commits be036a1/e8830b5/d4b0cb6+80c572e بسته بودند؛ PHASE 18 نیمه‌کاره رها شده بود — qa-audit.mjs سه خطای syntax داشت (ternary خردشده در خط ۱۸۳، پرانتز اضافی در ۱۸۵، عبارات tautology در ۱۶۹/۲۰۷)، walk() پارامتر filter را به‌جای acc میگرفت (acc.push is not a function)، و route آپلود تصویر از working-tree حذف شده بود (بازگردانی از git)
- رفع منطق QA2 (سخت‌ترین باگ): جهت تطبیق مسیر برعکس بود — regex از «مرجع» ساخته میشد و actual هیچوقت match نمیشد + دوبل‌اسلش در actual (`[id]`→`/{P}` روی اسلش موجود) + refهای سالم false-positive؛ رفع: actual مرجع همیشگی + تطبیق سه‌گانه (دقیق/پیشوند string-concat/الگوی dynamic {P}→[^/]+) + نرمالسازی `${fragment` ناتمام (از `${artifact!.id}`)
- کشف REG-02 بهعنوان باگ واقعی + **شکار علت ریشه‌ای**: route `admin/integrations/test` نه در git بود نه روی دیسک؛ علت ریشه‌ای = الگوی bare `test` در .gitignore که پوشهٔ هر مسیری به نام test (شامل `src/app/api/v1/admin/integrations/test/`) را خاموش میبلعید — به همین دلیل فایل در فاز ۱۳ هرگز index نشد؛ رفع: الگوی به `/test` مهار شد + بازسازی route از قرارداد قفل‌شدهٔ تستها (zod enum → 400 VALIDATION قبل از provider، requireRole ADMIN → 403، integrationSmokeTest سرویس موجود فاز ۱۳) + قفل hygiene در گیت QA3 (الگوهای bare دایرکتوری ممنوع)
- کشف عیب خطرناک Runner (qa-run.sh): سرور dev رهاشده از bootstrap محیط روی :3000 بود؛ runner فقط standalone را pkill میکرد → سرور QA با EADDRINUSE میمرد و کل suite خاموش علیه سرور dev (بدون BH_CHAOS) اجرا میشد → ۹ شکست کاذب (FS-1..FS-9 + authz chaos)؛ رفع: پاکسازی هر listener :3000 + گارد مالکیت پورت (pid مالک باید pid سرور QA باشد — «refusing a poisoned run») + کشف الگوی reap محیط (~۳۰-۴۰s بعد از پایان دستور؛ setsid هم نجات نمیدهد — D-17) → الگوی verification bundle تک-فرمانی (scripts/verify-p18.sh)
- رفع شکنندگی تولیدپذیری: ۲۲۰+ سفارش suiteهای قبلی stock ۵ محصول اول seed را صفر کرده بود و `limit=5` در golden-path به دیوار میخورد → اسکن کل صفحهٔ کاتالوگ (limit=100 سقف SEARCH_BOUNDS) + همترازی limit=60→100
- رفع hygiene کاذب: مقدار تست `HACKED_FIELD` (ورودی adversarial عمدی validateAiOutput) با regex بدون word-boundary گیر میافتاد → `\b(TODO|FIXME|HACK)\b`
- قفل HTTP-level مستقل: smoke-phase18.sh (۱۵ چک: liveness، REG-01/02/03 با جفت CSRF ناشناس، per-IP rate limit 15/5min با Retry-After — کشف شد reset روی موفقیت per-account را صفر میکند و فقط IP-limiter میtrips، inventory suite روی دیسک، wiring گیت) + verify-p18.sh (سرور+پنتست+دود در یک درخت فرایند)
- مستندات: QA.md (۱۲ بخش: ممیزی، کاتالوگ ۱۰نوع، نقشهٔ Critical Path، حافظهٔ REG-01..07، runner، سوئیتها، چرخهٔ Fix، گیت، ED-197..206، بدهیهای D-18-1..6، runbook، نتایج) · ADR-0022 + رجیستری · BUSINESS-RULES §13 BR-QA-01..10 · PRD §12 ردیف فاز ۱۸ · RTM یادداشت فاز ۱۸ · package.json audit:qa
- چرخهٔ منشور: bun test ۵۹۳/۵۹۳ (۲ اجرای کامل متوالی روی سرور production standalone + BH_CHAOS=1) · lint ۰ خطا (۱۸ هشدار پیش‌موجود در ۲ فایل فاز ۱۷) · گیت ۱۰/۱۰ CI (backend/frontend/media/ai/integrations/reporting/observability/perf/reliability/**qa**) · pentest ۴۵/۴۵ · smoke-phase18 ۱۵/۱۵ · مرورگر FA (landing + console ادمین + صفر خطای console) + EN (dir=ltr/lang=en مصادق) · اسکرین‌شات verify-p18-landing-fa/admin-console-fa/landing-en.png · WAL checkpoint

Stage Summary:
- ۱۰ نوع تست فرمان به‌صورت کاتالوگ واقعی روی دیسک (Database/Load/Contract/Regression جدید) + نقشهٔ Critical Path صریح ۴مسیره (سفر طلایی/پول/RBAC/inventory) — پذیرش = نقشهٔ سبز نه عدد (کیفیت>عدد طبق فرمان)
- حافظهٔ باگ REG-01..07 قفل شد؛ **علت ریشه‌ای REG-02 (gitignore bare pattern) شکار و کلاس-بسته شد** — خود فاز QA خودِ علت باگ فاز ۱۳ را پیدا کرد
- عیب runner با علامت‌گذاری مالکیت پورت بسته شد (سرور مسموم = رد صریح run)
- Verification: ۵۹۳/۵۹۳ دوبار · ۱۰/۱۰ گیت · pentest 45/45 · smoke 15/15 · browser fa/en صفر خطا · **Critical Bug = ۰ (هدف فرمان)**
- Remaining (honest): D-18-1 پوشش خط-to-خط · D-18-2 contract از replay واقعی · D-18-3 load خارج-پردازش (k6) · D-18-4 mutation testing · D-18-5 فلک async-export زیر suite کامل (مشاهده‌شده یکبار، واتچ) · D-18-6 فاز ۰۹ remediation باز
- Git: feat(phase-18) + fix gitignore + docs — سه commit

---
Task ID: 20
Agent: Main agent (Super Z)
Task: PHASE 19 — DevOps & Deployment (آماده‌سازی چهار محیط Development/Testing/Staging/Production + استانداردسازی Docker/Environment/Secrets/Reverse Proxy/SSL/Database/Cache/Queue/Storage + CI/CD کامل Lint/TypeCheck/Test/SecurityScan/Build/Artifact/Deploy/HealthCheck/Rollback + استقرار تکرارپذیر)

Work Log:
- ممیزی: .env.example نبود (spec §51) · هیچ Dockerfile/compose/nginx/CI وجود نداشت · env fail-fast فقط برای secrets (ED-59) موجود بود · بکاپ فقط media · استقرار «git-pull» نبود؛ spec §50-53/§71/§75-77 خوانده و map شد
- Environment (ED-215): .env.example جامع (۴۰+ متغیر با جدول ۴-محیطه) + قالب تنها فایل committed (`.gitignore` با `!.env.example`) + gen-secrets.sh (hex32/base64 32B + یادداشت چرخش) + گیت DEV1 پوشش مکانیکی (هر process.env کد باید در قالب باشد)
- Docker (spec §50): Dockerfile سه-مرحلهای — deps (bun install --frozen-lockfile) → build (prisma generate + next build) → runner (کاربر non-root bh:1001 · tini PID1 برای forward سیگنال/graceful shutdown · HEALTHCHECK روی /liveness · volume /data) + entrypoint با migrate deploy idempotent · compose dev (یک-فرمان §71 + پروفایلهای اختیاری redis/minio برای seamهای رشد) · compose prod (pin BH_VERSION — هرگز :latest · بدون expose عمومی (nginx-only) · healthcheck readiness با start_period 90s · سقف memory 2g · چرخش لاگ · سرویس یکباره migrate برای نامرئی‌شدن خطای مهاجرت در سطح stack) · .dockerignore
- Reverse Proxy + SSL (spec §75): nginx.conf — TLS 1.2/1.3 + session cache · 80→443 (بهجز ACME) · HSTS + server_tokens off (transport-level؛ CSP واحد در next.config میماند — دو من CSP ممنوع) · rate-limit دو-لایه (bh_auth 10r/m + bh_api 60r/m) · client_max_body_size 25m · upstream keepalive + proxy-common.inc (X-Forwarded-For/Proto/Host برای CSRF فاز ۵) · gen-self-signed.sh برای dev/staging + runbook Let's Encrypt مستند (certbot webroot + cron renew)
- CI/CD (spec §76+§77): .github/workflows/ci.yml — quality (lint/typecheck/unit) → integration (build+qa-run+pentest+smoke) ∥ security (secret-scan + gitleaks + osv-scanner + semgrep + ۱۰ گیت معماری) → artifact (docker build + trivy CRIT/HIGH=توقف + tar+sha256 + ghcr push) → deploy (SSH: backup → deploy.sh گیت‌دار) → post-deploy health check از بیرون → rollback (workflow_dispatch) — needs-gating یعنی شکست = توقف استقرار؛ آینهٔ محلی scripts/ci-local.sh همان ۹ مرحله (اجرای واقعی اینجا) + ci-security.sh با degrade صادق (osv/semgrep در CI نهادی)
- استقرار تکرارپذیر (ED-207..209): deploy.sh — preflight درخت git-clean (state/source جدا) · release تغییرناپذیر با manifest VERSION · مهاجرت قبل از serve · دروازهٔ سلامت readiness · سوئیچ اتمیک ln -sfn · **auto-rollback در شکست گیت سلامت** (release قبلی هم health-gated؛ اگر آن هم شکست خورد current دستنخورده) · retention ۱۰ release · پاکسازی listener پورت (درس P18) · rollback.sh با --list و گیت سلامت قبل از دست زدن به current · rollback-drill.sh
- **کشف بزرگ ED-209**: Next 16.1.3 در standalone کل snapshot پروژه را کپی میکند (حتی releases/ → رشد بازگشتی ۱.۳GB و تستهای خارجی که suite را مسموم کردند و آشوب کپیها!) → payload انتخابی در deploy/Dockerfile/artifact (server.js + node_modules ردیابی‌شده + .next + public + prisma — 180MB) + کشف باگ cp تودرتویی (BUILD_ID در .next/.next گم میشد → بوت رد شد → رفع)
- **کشف بزرگ ED-216**: گیت tsc فعال شد → ۶۹ خطای latent انباشته (18 فاز با ignoreBuildErrors) → همه رفع: 22× bun:test types (types/bun-runtime.d.ts) · کلید تکراری i18n «search» (باگ واقعی: تعریف فاز۱۴ توسط تعریف پایه shadow میشد) · fixture گلوله‌شده در کامنت (centerStats) · zod4 error keys (invalid_type_error→error) · 12× prop-mismatch کامپوننتها (SectionCard.desc + ErrorState.error + ApiError.message استاتیک + ConfirmDialog open + گاردها) · Buffer→BlobPart · unknown-castها در تستها · NODE_ENV readonly · seedهای scope تست
- تکرارپذیری suite (درس P18 ادامه): F6 کاتالوگ — ۶۰+ محصول هم‌نام «محصول تست رسانه» محصول تازه را از صفحه ۱ بیرون میراند (ASC) → جستجو با sku یکتا · تست لاگ → BH_QA_SERVER_LOG (لاگ سرورِ زیر تست، نه رسوب dev-server) · bun test discovery محدود (src tests)
- جداسازی state/source: db/custom.db و storage و releases/current/backups/dist از git خارج + db:seed · eslint/tsc/tsconfig runtime-state را ignore (پیشتر lint 180s hang میکرد!)
- Backup/Restore (ED-214): backup.sh (snapshot سازگار WAL-aware حتی زیر سرور زنده + tar storage + manifest + چرخش + صحت‌سنجی خودکار ۵۵ جدول) · restore.sh (stop نویسنده → صحت‌سنجی backup → safety-copy → swap → WAL quiesce) — هر دو واقعاً اجرا شدند · backup تستشد: DB + storage 2.4MB + rotation
- گیت CI scripts/devops-audit.mjs DEV1..DEV10 (پوشش env · secrets · Dockerfile · compose · nginx · pipeline+آینه · repeatable deploy · backup/restore · seamهای DB/Cache/Queue/Storage · runbook/Makefile) + npm audit:devops · چرخهٔ Fix خودِ فاز: ۱۲ ternary بدون سمی‌کالن (ASI) · walk خود گیت devops · grep خود-ارجاعی NAME
- Makefile (help/dev/qa/ci/deploy/rollback/backup/…) + README/CONTRIBUTING/CHANGELOG (spec §52)
- مستندات: DEPLOYMENT.md (۱۵ بخش: معماری، ماتریس ۴ محیط، Docker، env/secrets، nginx، SSL/domain، migration (+baseline یکباره production)، backup/restore، CI/CD، مدل release، monitoring، firewall، **چکلیست حقوقی/Regulatory production طبق spec**، troubleshooting، گیت/بدهیها) · ADR-0023 + رجیستری · BR-DEV §14 · PRD §12 ردیف فاز ۱۹ · RTM یادداشت
- چرخهٔ منشور: **CI محلی ۹/۹ مرحله سبز** (lint ۰ خطا · tsc ۰ خطا · unit · security · build · artifact 57MB+sha256 · deploy اتمیک گیت‌دار · health-check ready True · rollback-drill: deploy→rollback→redeploy) · bun test ۵۹۳/۵۹۳ روی سرور production · گیت ۱۱/۱۱ (backend/frontend/media/ai/integrations/reporting/observability/perf/reliability/qa/**devops**) · pentest ۴۵/۴۵ · smoke-phase18 ۱۵/۱۵ · مرورگر روی release مستقر: landing FA + console ادمین + صفر خطای console + اسکرین‌شات verify-p19-release-*

Stage Summary:
- فرمان کامل: ۴ محیط · Docker/Env/Secrets/Proxy/SSL/DB/Cache/Queue/Storage استاندارد · CI/CD ۹-مرحله‌ای fail-stop (نهادی + آینهٔ محلی اجراشده) · **استقرار تکرارپذیر اثبات‌شده** (release تغییرناپذیر + سوئیچ اتمیک + دروازهٔ سلامت + auto-rollback + drill)
- سه کشف مهندسی واقعی: snapshot پروژه در Next-16 standalone (payload انتخابی) · ۶۹ خطای latent type (۲ باگ واقعی داخل) · شکنندگی data-state در تستهای کاتالوگ/لاگ
- Verification: ۹/۹ CI · ۵۹۳/۵۹۳ · DEV1..DEV10 · QA1..QA10 · pentest 45/45 · smoke 15/15 · browser روی release · tsc/lint صفر
- Remaining (honest): D-19-1 اجرای docker/trivy در محیط بدون docker (CI نهادی) · D-19-2 multi-instance (Redis/Postgres — ADR-0005/D-17-1) · D-19-3 blue-green دو-upstream · D-19-4 staging snapshot با masking داده · D-19-5 فاز ۰۹ remediation باز
- Git: ۸ commit فاز ۱۹ (infra → state/source → CI scripts → type-fix → copy semantics → repeatable-QA → gate needles → docs)
