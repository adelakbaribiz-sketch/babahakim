# Worklog — TongueCheck (تنگ‌چک) Platform

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
