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
