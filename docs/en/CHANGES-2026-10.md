# Changes — 2026-10 overhaul (English summary)

Detailed Persian reports: `IMPLEMENTATION_REPORT.md`, `TEST_REPORT.md`, `KNOWN_ISSUES.md`.

## Critical fixes
| Problem | Root cause | Fix |
|---|---|---|
| Patient tickets were never created | The form had no `priority` field while the client validator required it; the validation error was swallowed and no request was sent | Priority field, visible validation errors, staff status controls |
| Doctor rejection closed the case permanently | `DOCTOR_REJECT → CLOSED` | Case returns to `REVISION_REQUESTED` (Expert 1 queue); the rejected version and reason are kept |
| Expert 2 could not return or edit a prescription | No transition / DTO support | `EXPERT2_RETURN` with mandatory reason; edits create a new prescription version and supersede the old one |
| "Brown" stale status in Recent Events | Badge showed each event's historical target status; dashboards were cached 15 s without invalidation | Badge shows the case's current status; transitions invalidate dashboard caches |
| Expert 2 could change prices on another case's items | Item update not scoped to the prescription | Scoped update |
| PDF exports failed on Windows | Hard-coded Linux font path | Font resolution with Windows fallback |
| Fresh deploys from migrations missed tables/columns | Earlier phases used `db push` without migrations | Reconcile migration; fresh DB now matches the schema with zero drift |
| Production booted without secrets | Secrets checked lazily | Fail-fast at server start |

## New capabilities
National-ID login with shared family mobiles and admin-only national-ID changes · account recovery bound to one account · age-or-birth-date and searchable province/city · optional, partial, versioned temperament questionnaire with admin editor (required/weight/category) · server-side product search and admin prescription vocabulary · staff case table with identity columns, filters and archive/restore · CSV formula-injection guard · production seed mode (first admin from env, no demo data) · safe migrator for fresh / db-push / migrated databases.

## Database migrations added
`20260920000000_reconcile_db_push_drift`, `20261027120000_overhaul_identity_archive_vocab`, `20261027130000_vocabulary_defaults`.

## Tests
632/632 automated tests and 45/45 pentest scenarios on an isolated test database.
