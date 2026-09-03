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
