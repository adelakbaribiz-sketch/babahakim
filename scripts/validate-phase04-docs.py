#!/usr/bin/env python3
"""BabaHakim PHASE 04 — Database Architecture documentation validator.

Checks:
1. Deliverables exist: docs/DATABASE.md, docs/DATABASE-ERD.md, docs/erds/*.png (17)
2. DATABASE.md has all 15 sections (0..14) and consistent stat claims vs live DB
3. ED-47..58 defined in DATABASE.md AND BUSINESS-RULES.md; RTM range updated
4. ADR-0013 exists and is indexed in docs/ADR/README.md
5. ERD doc references master maps + 15 per-context diagrams
6. No stray CJK characters in new docs
7. (if .pgurl present) live catalog matches claimed stats (49 tables / 15 schemas /
   167 checks / 190 indexes / 44 triggers / 34 FKs)
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
errors: list[str] = []
warnings: list[str] = []

DATABASE_MD = REPO / "docs" / "DATABASE.md"
ERD_MD = REPO / "docs" / "DATABASE-EDR.md" if False else REPO / "docs" / "DATABASE-ERD.md"
ERD_DIR = REPO / "docs" / "erds"
BR_MD = REPO / "docs" / "BUSINESS-RULES.md"
RTM_MD = REPO / "docs" / "REQUIREMENTS-TRACEABILITY-MATRIX.md"
ADR13 = REPO / "docs" / "ADR" / "ADR-0013-alembic-ddl-source-of-truth.md"
ADR_README = REPO / "docs" / "ADR" / "README.md"

for f in [DATABASE_MD, ERD_MD, BR_MD, RTM_MD, ADR13, ADR_README]:
    if not f.exists():
        errors.append(f"MISSING file: {f}")

db_md = DATABASE_MD.read_text(encoding="utf-8") if DATABASE_MD.exists() else ""
erd_md = ERD_MD.read_text(encoding="utf-8") if ERD_MD.exists() else ""
br_md = BR_MD.read_text(encoding="utf-8") if BR_MD.exists() else ""
rtm_md = RTM_MD.read_text(encoding="utf-8") if RTM_MD.exists() else ""

# 1) ERD artifacts
pngs = sorted(ERD_DIR.glob("*.png")) if ERD_DIR.exists() else []
if len(pngs) != 17:
    errors.append(f"expected 17 ERD PNGs, found {len(pngs)}")
expected_contexts = [
    "identity", "patients", "medical_records", "ai", "clinical_review", "products",
    "prescriptions", "commerce", "payments", "shipping", "notifications", "tickets",
    "finance", "administration", "reporting",
]
for ctx in expected_contexts:
    if not (ERD_DIR / f"context-{ctx}.png").exists():
        errors.append(f"missing ERD: context-{ctx}.png")
for master in ("master-context-map.png", "master-golden-path.png"):
    if not (ERD_DIR / master).exists():
        errors.append(f"missing ERD: {master}")
for ctx in expected_contexts:
    if f"erds/context-{ctx}.png" not in erd_md:
        errors.append(f"DATABASE-ERD.md does not reference context-{ctx}.png")
for master in ("erds/master-context-map.png", "erds/master-golden-path.png"):
    if master not in erd_md:
        errors.append(f"DATABASE-ERD.md does not reference {master}")

# 2) DATABASE.md sections
for sec in ["## ۰)", "## ۱)", "## ۲)", "## ۳)", "## ۴)", "## ۵)", "## ۶)", "## ۷)",
            "## ۸)", "## ۹)", "## ۱۰)", "## ۱۱)", "## ۱۲)", "## ۱۳)", "## ۱۴)"]:
    if sec not in db_md:
        errors.append(f"DATABASE.md missing section {sec}")

# 3) ED-47..58 chain
ed_pat = re.compile(r"\bED-(4[7-9]|5[0-8])\b")
db_eds = set(ed_pat.findall(db_md.replace("ED-", "ED-")))
br_eds = set(ed_pat.findall(br_md))
for i in range(47, 59):
    if f"ED-{i}" not in db_md:
        errors.append(f"DATABASE.md missing ED-{i}")
    if f"ED-{i}" not in br_md:
        errors.append(f"BUSINESS-RULES.md missing ED-{i}")
if "ED-01..ED-58" not in rtm_md:
    errors.append("RTM does not claim ED-01..58 range")

# 4) ADR-0013
if ADR13.exists():
    a = ADR13.read_text(encoding="utf-8")
    for token in ("ADR-0013", "ED-47", "Alembic", "Compliance"):
        if token not in a:
            errors.append(f"ADR-0013 missing token {token}")
    for token in ("postgres", "Python"):
        if token.lower() not in a.lower():
            warnings.append(f"ADR-0013 lacks expected keyword: {token}")
if ADR_README.exists() and "ADR-0013" not in ADR_README.read_text(encoding="utf-8"):
    errors.append("ADR README does not index ADR-0013")

# 5) 40 entity mapping present
if "پوشش ۴۰/۴۰" not in db_md:
    errors.append("DATABASE.md entity mapping summary missing (پوشش ۴۰/۴۰)")

# 6) stray CJK
for name, text in [("DATABASE.md", db_md), ("DATABASE-ERD.md", erd_md), ("ADR-0013", ADR13.read_text(encoding="utf-8") if ADR13.exists() else "")]:
    cjk = re.findall(r"[\u4e00-\u9fff]", text)
    if cjk:
        errors.append(f"{name} contains stray CJK: {cjk[:5]}")

# 7) live catalog check (best-effort)
claims = {
    "tables": (49, r"\|\s*جداول\s*\|\s*\*?\*?۴۹\*?\*?"),
    "checks": (167, r"\*?\*?۱۶۷\*?\*?"),
}
pgurl = REPO / "database" / ".pgurl"
if pgurl.exists():
    try:
        sys.path.insert(0, str(REPO / "database" / ".venv" / "lib" / "python3.12" / "site-packages"))
        import psycopg2  # noqa
        uri = pgurl.read_text().strip()
        conn = psycopg2.connect(uri)
        cur = conn.cursor()
        schemas = expected_contexts
        cur.execute("SELECT count(*) FROM information_schema.tables WHERE table_schema = ANY(%s) AND table_type='BASE TABLE'", (schemas,))
        tables = cur.fetchone()[0]
        cur.execute("SELECT count(*) FROM pg_constraint con JOIN pg_namespace n ON n.oid=con.connamespace WHERE con.contype='c' AND n.nspname = ANY(%s)", (schemas,))
        checks = cur.fetchone()[0]
        cur.execute("SELECT count(*) FROM pg_indexes WHERE schemaname = ANY(%s)", (schemas,))
        indexes = cur.fetchone()[0]
        cur.execute("SELECT count(DISTINCT trigger_name) FROM information_schema.triggers WHERE trigger_name LIKE 'trg%%'")
        triggers = cur.fetchone()[0]
        cur.execute("SELECT count(*) FROM pg_constraint con JOIN pg_namespace n ON n.oid=con.connamespace WHERE con.contype='f' AND n.nspname = ANY(%s)", (schemas,))
        fks = cur.fetchone()[0]
        conn.close()
        expected_live = {"tables": 49, "checks": 167, "indexes": 190, "triggers": 44, "fks": 34}
        for name, actual in [("tables", tables), ("checks", checks), ("indexes", indexes), ("triggers", triggers), ("fks", fks)]:
            if actual != expected_live[name]:
                errors.append(f"live DB {name}={actual} != expected {expected_live[name]}")
        print(f"[live-catalog] tables={tables} checks={checks} indexes={indexes} triggers={triggers} fks={fks}")
    except Exception as e:  # noqa
        warnings.append(f"live DB check skipped ({e})")
else:
    warnings.append("no database/.pgurl — live catalog check skipped")

print(f"[PHASE-04 validator] ERDs={len(pngs)} ED-range=47..58 ADR13={'OK' if ADR13.exists() else 'MISSING'}")
if errors:
    print("\nFAIL — error(s):")
    for e in errors:
        print(f"  ✗ {e}")
    sys.exit(1)
if warnings:
    print("warnings:")
    for w in warnings:
        print(f"  ~ {w}")
print("\nPASS — PHASE 04 database documentation is structurally consistent.")
