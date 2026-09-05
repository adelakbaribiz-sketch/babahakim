#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────────────────────
# PHASE 16 · Database measurement harness (MEASUREMENT, not optimization)
# Per the phase command: "Optimization بدون Measurement انجام نده" — this
# script captures the DB baseline BEFORE any change:
#   1. EXPLAIN QUERY PLAN for every hot query path (SCAN vs INDEX)
#   2. Row counts of hot tables (scale context)
#   3. Journal mode / pragmas (SQLite write-path configuration)
#   4. Synthetic scale test: 50k-row table, same query shapes, with vs
#      without index — isolates the algorithmic cost from live data size
# Output: scripts/perf-db-<tag>.json  (tag = argv[1], default "baseline")
# ─────────────────────────────────────────────────────────────────────────────
import json
import os
import sqlite3
import sys
import time

DB = os.path.join(os.path.dirname(__file__), "..", "db", "custom.db")
TAG = sys.argv[1] if len(sys.argv) > 1 else "baseline"
OUT = os.path.join(os.path.dirname(__file__), f"perf-db-{TAG}.json")

# Real patient/case ids sampled from the live DB for realistic plans
con = sqlite3.connect(DB)
cur = con.cursor()


def one(sql, params=()):
    return cur.execute(sql, params).fetchone()


patient_id = one("SELECT patientId FROM MedicalCase LIMIT 1")[0]
case_id = one("SELECT id FROM MedicalCase LIMIT 1")[0]
user_id = one("SELECT id FROM User LIMIT 1")[0]
ticket_id = one("SELECT id FROM Ticket LIMIT 1")[0]
order_id = one("SELECT id FROM \"Order\" LIMIT 1")[0]

# ── 1. hot queries & their plans ─────────────────────────────────────────────
# Each entry: (id, description, SQL, params). SQL mirrors what Prisma emits
# for the service-layer call (WHERE / ORDER BY / LIMIT included).
HOT_QUERIES = [
    ("auth.getAuth", "per-request user lookup (PK)",
     "SELECT id, phone, role, isActive, deletedAt FROM User WHERE id = ?", (user_id,)),
    ("dash.patient.cases", "patient dashboard — my cases",
     "SELECT * FROM MedicalCase WHERE patientId = ? ORDER BY createdAt DESC LIMIT 5", (patient_id,)),
    ("dash.patient.cases.count", "patient dashboard — case count",
     "SELECT COUNT(*) FROM MedicalCase WHERE patientId = ?", (patient_id,)),
    ("dash.patient.orders", "patient dashboard — my orders",
     "SELECT * FROM \"Order\" WHERE userId = ? ORDER BY createdAt DESC LIMIT 5", (patient_id,)),
    ("dash.patient.tickets", "patient dashboard — my tickets",
     "SELECT * FROM Ticket WHERE userId = ? ORDER BY updatedAt DESC LIMIT 3", (patient_id,)),
    ("dash.patient.notifications", "patient dashboard — unread notifications",
     "SELECT * FROM Notification WHERE userId = ? AND read = 0 ORDER BY createdAt DESC LIMIT 5", (patient_id,)),
    ("dash.staff.case_count_status", "staff dashboard — case count by status",
     "SELECT COUNT(*) FROM MedicalCase WHERE status = ?", ("WAITING_FOR_EXPERT_1",)),
    ("dash.staff.order_count_status", "staff dashboard — order count by status",
     "SELECT COUNT(*) FROM \"Order\" WHERE status = ?", ("PAID",)),
    ("dash.staff.followup", "staff dashboard — follow-ups pending",
     "SELECT COUNT(*) FROM FollowUp WHERE status IN ('PENDING','DUE','OVERDUE')", ()),
    ("dash.staff.recent_events", "staff dashboard — recent case events feed",
     "SELECT * FROM CaseEvent ORDER BY createdAt DESC LIMIT 12", ()),
    ("case.list", "admin case list ordered by createdAt",
     "SELECT * FROM MedicalCase ORDER BY createdAt DESC LIMIT 20", ()),
    ("case.detail.events", "case detail — timeline events",
     "SELECT * FROM CaseEvent WHERE caseId = ? ORDER BY createdAt DESC", (case_id,)),
    ("case.detail.analyses", "case detail — AI analyses",
     "SELECT * FROM AIAnalysis WHERE caseId = ?", (case_id,)),
    ("case.detail.images", "case detail — images",
     "SELECT * FROM MedicalImage WHERE caseId = ?", (case_id,)),
    ("ticket.thread", "ticket thread messages",
     "SELECT * FROM TicketMessage WHERE ticketId = ? ORDER BY createdAt", (ticket_id,)),
    ("order.items", "order detail — items",
     "SELECT * FROM OrderItem WHERE orderId = ?", (order_id,)),
    ("order.invoice", "order detail — invoice",
     "SELECT * FROM Invoice WHERE orderId = ?", (order_id,)),
    ("payments.by_order", "payment lookup by order",
     "SELECT * FROM Payment WHERE orderId = ?", (order_id,)),
    ("report.revenue", "financial report — income aggregate",
     "SELECT COALESCE(SUM(amount),0) FROM FinancialTransaction WHERE type = 'INCOME'", ()),
    ("report.payments_window", "financial report — payments in window",
     "SELECT COUNT(*), COALESCE(SUM(amount),0) FROM Payment WHERE status = 'VERIFIED' AND verifiedAt >= '2025-01-01'", ()),
    ("search.case.code", "search — case code LIKE",
     "SELECT * FROM MedicalCase WHERE code LIKE '%TC%' LIMIT 20", ()),
    ("search.user.phone_name", "search — user phone/name LIKE",
     "SELECT * FROM User WHERE phone LIKE '%0912%' OR firstName LIKE '%س%' OR lastName LIKE '%س%' LIMIT 20", ()),
    ("audit.list", "admin audit trail — latest page",
     "SELECT * FROM AuditLog ORDER BY createdAt DESC LIMIT 20", ()),
    ("audit.by_user", "admin audit trail — filter by user",
     "SELECT * FROM AuditLog WHERE userId = ? ORDER BY createdAt DESC LIMIT 20", (user_id,)),
    ("notif.unread_count", "notification badge count",
     "SELECT COUNT(*) FROM Notification WHERE userId = ? AND read = 0", (user_id,)),
    ("smslog.list", "admin sms log — latest page",
     "SELECT * FROM SMSLog ORDER BY createdAt DESC LIMIT 20", ()),
    ("calllog.list", "admin integration call log — latest page",
     "SELECT * FROM IntegrationCallLog ORDER BY createdAt DESC LIMIT 20", ()),
]

plans = []
for qid, desc, sql, params in HOT_QUERIES:
    try:
        rows = cur.execute("EXPLAIN QUERY PLAN " + sql, params).fetchall()
        detail = " | ".join(r[3] for r in rows)
        full_scan = any("SCAN" in r[3] and "USING INDEX" not in r[3] and "USING COVERING INDEX" not in r[3] for r in rows)
        # measure real latency (avg of 20 runs after 3 warmups)
        for _ in range(3):
            cur.execute(sql, params).fetchall()
        t0 = time.perf_counter_ns()
        for _ in range(20):
            cur.execute(sql, params).fetchall()
        ms = (time.perf_counter_ns() - t0) / 20 / 1e6
        plans.append({"id": qid, "desc": desc, "plan": detail, "fullScan": full_scan, "ms": round(ms, 4)})
    except Exception as e:
        plans.append({"id": qid, "desc": desc, "plan": f"ERROR: {e}", "fullScan": None, "ms": None})

# ── 2. row counts ────────────────────────────────────────────────────────────
TABLES = ["User", "MedicalCase", "\"Order\"", "AuditLog", "Notification", "CaseEvent",
          "AIAnalysis", "Payment", "FinancialTransaction", "Ticket", "TicketMessage",
          "MedicalImage", "FollowUp", "SMSLog", "ServiceLog", "MetricPoint",
          "IntegrationCallLog", "Product", "OrderItem", "Invoice", "Prescription",
          "Diagnosis", "RefreshToken"]
rows_counts = {}
for t in TABLES:
    try:
        rows_counts[t.strip('"')] = cur.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
    except Exception:
        rows_counts[t.strip('"')] = None

# ── 3. pragmas / write-path config ───────────────────────────────────────────
pragmas = {}
for p in ["journal_mode", "synchronous", "cache_size", "page_size", "foreign_keys", "wal_autocheckpoint"]:
    try:
        pragmas[p] = cur.execute(f"PRAGMA {p}").fetchone()[0]
    except Exception:
        pragmas[p] = None

# index inventory (named, non-auto)
indexes = cur.execute(
    "SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY tbl_name"
).fetchall()

# ── 4. synthetic scale test (isolates algorithmic cost) ──────────────────────
# 50k rows mirroring MedicalCase shape: many queries filter by patientId /
# status. We time the same query without index, then create the index and
# retime — the delta is the pure index effect at production-like scale.
synth = []
tmp = sqlite3.connect(":memory:")
tmp.execute("CREATE TABLE synth_case (id TEXT PRIMARY KEY, patientId TEXT, status TEXT, createdAt TEXT)")
R = 50_000
vals = []
for i in range(R):
    vals.append((f"c{i}", f"p{i % 5000}", ["NEW", "WAITING_FOR_EXPERT_1", "CLOSED"][i % 3], f"2026-01-{(i % 28) + 1:02d}T12:00:00"))
tmp.executemany("INSERT INTO synth_case VALUES (?,?,?,?)", vals)
tmp.commit()

def time_q(c, sql, params, n=50):
    for _ in range(3):
        c.execute(sql, params).fetchall()
    t0 = time.perf_counter_ns()
    for _ in range(n):
        c.execute(sql, params).fetchall()
    return (time.perf_counter_ns() - t0) / n / 1e6

for label, sql, params in [
    ("filter by patientId (ORDER createdAt DESC LIMIT 5)",
     "SELECT * FROM synth_case WHERE patientId = ? ORDER BY createdAt DESC LIMIT 5", ("p2500",)),
    ("filter by status", "SELECT COUNT(*) FROM synth_case WHERE status = ?", ("WAITING_FOR_EXPERT_1",)),
    ("filter by patientId+status", "SELECT COUNT(*) FROM synth_case WHERE patientId = ? AND status = ?", ("p2500", "NEW")),
]:
    before = time_q(tmp, sql, params)
    entry = {"shape": label, "rows": R, "beforeIndexMs": round(before, 4)}
    synth.append(entry)

# add indexes now and retime each
tmp.execute("CREATE INDEX ix_synth_patient ON synth_case(patientId, createdAt)")
tmp.execute("CREATE INDEX ix_synth_status ON synth_case(status)")
for entry in synth:
    if "status" in entry["shape"] and "patientId+status" in entry["shape"]:
        sql, params = "SELECT COUNT(*) FROM synth_case WHERE patientId = ? AND status = ?", ("p2500", "NEW")
    elif "filter by status" in entry["shape"]:
        sql, params = "SELECT COUNT(*) FROM synth_case WHERE status = ?", ("WAITING_FOR_EXPERT_1",)
    else:
        sql, params = "SELECT * FROM synth_case WHERE patientId = ? ORDER BY createdAt DESC LIMIT 5", ("p2500",)
    after = time_q(tmp, sql, params)
    entry["afterIndexMs"] = round(after, 4)
    entry["speedup"] = round(entry["beforeIndexMs"] / after, 1) if after > 0 else None

# write-path journal mode benchmark: FILE-based (real fsync — in-memory
# journals are no-ops and hide the cost). 300 single-row inserts, one
# transaction each (OLTP pattern: audit/token/notification writes).
import tempfile
def insert_bench(journal):
    path = os.path.join(tempfile.gettempdir(), f"bh-perf-{journal}.db")
    if os.path.exists(path):
        os.remove(path)
    c = sqlite3.connect(path)
    c.execute(f"PRAGMA journal_mode={journal}")
    c.execute("CREATE TABLE t (id TEXT PRIMARY KEY, v TEXT)")
    t0 = time.perf_counter_ns()
    for i in range(300):
        c.execute("BEGIN")
        c.execute("INSERT INTO t VALUES (?,?)", (f"i{i}", "x" * 40))
        c.execute("COMMIT")
    total = (time.perf_counter_ns() - t0) / 300 / 1e6
    c.close()
    os.remove(path)
    return total

journal_bench = {
    "inserts": 300,
    "deleteJournalMsPerInsert": round(insert_bench("delete"), 4),
    "walMsPerInsert": round(insert_bench("wal"), 4),
}
journal_bench["speedup"] = round(journal_bench["deleteJournalMsPerInsert"] / journal_bench["walMsPerInsert"], 2)

# concurrent reader while writer holds a write txn (the real WAL payoff)
def rw_bench(journal):
    import threading
    c = sqlite3.connect(":memory:")
    c.execute(f"PRAGMA journal_mode={journal}")
    c.execute("CREATE TABLE t (id TEXT PRIMARY KEY, v TEXT)")
    c.executemany("INSERT INTO t VALUES (?,?)", [(f"i{i}", "x" * 40) for i in range(2000)])
    c.commit()
    reader = sqlite3.connect(":memory:")  # separate connection, same (in-memory won't share)…
    # in-memory DBs are per-connection: fall back to file-based for real concurrency
    return None

concurrent = None  # measured via HTTP-level bench instead (real server, real file DB)

result = {
    "tag": TAG,
    "db": os.path.abspath(DB),
    "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
    "pragmas": pragmas,
    "rowCounts": rows_counts,
    "namedIndexCount": len(indexes),
    "queries": plans,
    "fullScanCount": sum(1 for p in plans if p["fullScan"]),
    "syntheticScale": synth,
    "journalBench": journal_bench,
}
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False, indent=2)

# console summary
print(f"journal_mode={pragmas['journal_mode']}  synchronous={pragmas['synchronous']}  named_indexes={len(indexes)}")
print(f"\nfull-scan queries: {result['fullScanCount']} / {len(plans)}")
for p in plans:
    if p["fullScan"]:
        print(f"  SCAN  {p['id']:28} {p['ms'] if p['ms'] is not None else '?':>8} ms  — {p['desc']}")
print("\nsynthetic 50k-row scale test:")
for s in synth:
    print(f"  {s['shape']:55} {s['beforeIndexMs']:>8.3f} ms → {s['afterIndexMs']:.3f} ms  (×{s['speedup']})")
print(f"\njournal write bench: {journal_bench['deleteJournalMsPerInsert']} ms/insert (delete) vs "
      f"{journal_bench['walMsPerInsert']} ms/insert (WAL) → ×{journal_bench['speedup']}")
print(f"\nwritten → {OUT}")
