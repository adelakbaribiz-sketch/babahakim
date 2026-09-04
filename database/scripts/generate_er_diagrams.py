#!/usr/bin/env python3
"""BabaHakim — ERD generator (PHASE 04).

Generates from SQLAlchemy metadata (single source of truth):
1. Per-context ER diagrams (15) — intra-context FK relationships (crow's foot).
2. Master inter-context soft-reference map (flowchart, D4 edges).
3. Master golden-path ERD (core entities across contexts, soft-ref labelled).
4. Renders PNGs via mermaid-cli (mmdc).
5. Emits docs/DATABASE-ERD.md (Persian, English technical terms).

Run:  database/.venv/bin/python database/scripts/generate_er_diagrams.py
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

DB_DIR = Path(__file__).resolve().parent.parent
REPO = DB_DIR.parent
sys.path.insert(0, str(DB_DIR))

from models import Base  # noqa: E402

OUT_MD = REPO / "docs" / "DATABASE-ERD.md"
ERD_DIR = REPO / "docs" / "erds"
MMDC = "/home/z/.npm-global/bin/mmdc"

# business columns worth showing beyond keys (readability cap per entity)
INTERESTING = {
    "status", "code", "phone", "sku", "version", "amount", "total", "subtotal",
    "discount", "quantity", "is_active", "deleted_at", "created_at", "updated_at",
    "priority", "stage", "decision", "outcome", "due_date", "role_id",
}

SOFT_REF_TARGET = {
    "user_id": "identity", "owner_user_id": "identity", "actor_user_id": "identity",
    "reviewer_user_id": "identity", "doctor_user_id": "identity", "expert_user_id": "identity",
    "patient_user_id": "identity", "sender_user_id": "identity", "created_by_user_id": "identity",
    "approved_by_user_id": "identity", "verified_by_user_id": "identity", "changed_by_user_id": "identity",
    "completed_by_user_id": "identity", "reviewed_by_user_id": "identity", "assigned_to_user_id": "identity",
    "paid_by_user_id": "identity", "referrer_user_id": "identity", "referred_user_id": "identity",
    "patient_ref_id": "identity",
    "medical_file_id": "clinical_review", "related_medical_file_id": "clinical_review",
    "reassessment_of_file_id": "clinical_review",
    "image_id": "medical_records", "receipt_image_id": "medical_records",
    "proof_image_id": "medical_records", "attachment_image_id": "medical_records",
    "ai_analysis_id": "ai", "current_ai_analysis_id": "ai",
    "product_id": "products", "disease_id": "clinical_review",
    "prescription_id": "prescriptions", "current_prescription_id": "prescriptions",
    "order_id": "commerce", "invoice_id": "commerce", "address_id": "patients",
    "questionnaire_response_id": "patients",
    "payment_id": "payments", "shipment_id": "shipping", "referral_id": "patients",
    "related_ticket_id": "tickets",
}

CONTEXT_FA = {
    "identity": "هویت و دسترسی", "patients": "بیمار و پرسشنامه",
    "medical_records": "پرونده پزشکی", "ai": "هوش مصنوعی",
    "clinical_review": "بازبینی بالینی", "products": "محصولات و انبار",
    "prescriptions": "نسخه‌ها", "commerce": "فروش و سفارش",
    "payments": "پرداخت", "shipping": "ارسال",
    "notifications": "اعلان‌ها", "tickets": "پشتیبانی",
    "finance": "مالی", "administration": "مدیریت و حسابرسی",
    "reporting": "گزارش‌ها (Read Model)",
}


def py_type_to_er(col) -> str:
    t = str(col.type).upper()
    if t.startswith("BIGINT"):
        return "bigint"
    if t.startswith("VARCHAR"):
        return "varchar"
    if t.startswith("JSONB"):
        return "jsonb"
    if t.startswith("DATETIME"):
        return "timestamptz"
    if t.startswith("NUMERIC"):
        return "numeric"
    if t.startswith("INTEGER"):
        return "int"
    if t.startswith("BOOLEAN"):
        return "boolean"
    if t.startswith("DATE"):
        return "date"
    if t.startswith("INET"):
        return "inet"
    if t.startswith("TEXT"):
        return "text"
    return "field"


def _is_unique_indexed(table, col) -> bool:
    for ix in table.indexes:
        if ix.unique and list(ix.expressions) == [col]:
            return True
    return False


def entity_block(table, columns) -> list[str]:
    lines = [f"    {table.name} {{"]
    for c in columns:
        key = ""
        if c.primary_key:
            key = " PK"
        elif c.foreign_keys:
            key = " FK"
        elif c.unique or _is_unique_indexed(table, c):
            key = " UK"
        lines.append(f"        {py_type_to_er(c)} {c.name}{key}")
    lines.append("    }")
    return lines


def pick_columns(table):
    cols = []
    for c in table.columns:
        if c.name == "id" or c.primary_key:
            cols.append(c)
        elif c.foreign_keys:
            cols.append(c)
        elif c.name in INTERESTING:
            cols.append(c)
        elif c.unique:
            cols.append(c)
    # cap: keys first, then interesting, max 14
    if len(cols) > 14:
        cols = cols[:14]
    return cols


def intra_context_relations(schema):
    """crow's foot relations for real FKs inside one schema."""
    rels = []
    for t in Base.metadata.sorted_tables:
        if t.schema != schema:
            continue
        for c in t.columns:
            if not c.foreign_keys:
                continue
            fk = next(iter(c.foreign_keys))
            parent = fk.column.table
            if parent.schema != schema:
                continue
            child_many = "o{" if c.nullable else "|{"
            parent_side = "||"  # parent always exactly-one per row
            label = f"{parent.name} → {t.name}"
            rels.append(f"    {parent.name} {parent_side}--{child_many} {t.name} : \"{c.name}\"")
    return rels


def render_mmd(name: str, code: str, width: int = 1600) -> Path:
    mmd = ERD_DIR / f"{name}.mmd"
    png = ERD_DIR / f"{name}.png"
    mmd.write_text(code, encoding="utf-8")
    cfg = ERD_DIR / "mmdc-config.json"
    subprocess.run(
        [MMDC, "-i", str(mmd), "-o", str(png), "-w", str(width), "-b", "white",
         "--configFile", str(cfg)],
        check=True, capture_output=True, timeout=180,
    )
    return png


def main() -> None:
    ERD_DIR.mkdir(parents=True, exist_ok=True)
    (ERD_DIR / "mmdc-config.json").write_text(json.dumps({
        "theme": "base",
        "themeVariables": {
            "primaryColor": "#EFF6FF",
            "primaryBorderColor": "#225BBE",
            "primaryTextColor": "#173F76",
            "lineColor": "#94A3B8",
            "secondaryColor": "#F8FAFC",
            "tertiaryColor": "#FFF7ED",
            "fontSize": "14px",
            "fontFamily": "DejaVu Sans, Noto Sans, sans-serif",
        },
        "er": {"diagramPadding": 24, "layoutDirection": "TB", "minEntityWidth": 120},
    }, ensure_ascii=False), encoding="utf-8")

    md = []
    md.append("# BabaHakim — ERD | نمودار ارتباط موجودیت‌ها (PHASE 04)\n")
    md.append("> منبع تولید: `database/models/` (SQLAlchemy Metadata) — اسکریپت: "
              "`database/scripts/generate_er_diagrams.py`. نمادها: `PK` کلید اصلی، "
              "`FK` کلید خارجی واقعی (درون-Context)، `UK` یکتا. روابط بین-Context "
              "طبق ADR-0004/D4 **Soft Reference** هستند (بدون FK فیزیکی).\n")

    # ── 1) per-context diagrams ────────────────────────────────────────
    by_schema = {}
    for t in Base.metadata.sorted_tables:
        by_schema.setdefault(t.schema, []).append(t)

    md.append("\n## ۱) نمای کلان Contextها و ارجاع‌های بین-Context (D4)\n")
    md.append("![master-context-map](erds/master-context-map.png)\n")
    md.append("هر یال = تعداد ستون‌های Soft Reference از Context مبدأ به Context مقصد "
              "(بدون FK فیزیکی — اعتبارسنجی در لایه Facade + تست یکپارچگی).\n")

    # master flowchart (schema graph)
    edges = {}
    for t in Base.metadata.sorted_tables:
        for c in t.columns:
            if c.foreign_keys:
                continue
            target = SOFT_REF_TARGET.get(c.name)
            if target and target != t.schema:
                key = (t.schema, target)
                edges[key] = edges.get(key, 0) + 1
    fc = ["flowchart LR"]
    for s in sorted(by_schema):
        fc.append(f"    {s}[{s}]")
    for (src, dst), n in sorted(edges.items()):
        fc.append(f"    {src} -. \"{n} soft-ref\" .-> {dst}")
    fc.append("    classDef ctx fill:#EFF6FF,stroke:#225BBE,color:#173F76;")
    fc.append("    class " + ",".join(sorted(by_schema)) + " ctx")
    render_mmd("master-context-map", "\n".join(fc), 1500)

    # ── 2) golden-path ERD (cross-context core) ────────────────────────
    md.append("\n## ۲) ERD مسیر طلایی (موجودیت‌های هسته، بین-Context)\n")
    md.append("![master-golden-path](erds/master-golden-path.png)\n")
    md.append("مسیر ۱۷-مرحله‌ای بیمار روی هسته داده: `users → medical_files → "
              "ai_analyses → prescriptions → orders → invoices → payments → "
              "shipments → follow_ups`. برچسب «soft» = مرجع نرم بین-Context.\n")

    CORE = [
        ("identity", "users"), ("patients", "patient_profiles"),
        ("clinical_review", "medical_files"), ("medical_records", "images"),
        ("ai", "ai_analyses"), ("prescriptions", "prescriptions"),
        ("products", "products"), ("commerce", "orders"),
        ("payments", "payments"), ("shipping", "shipments"),
        ("clinical_review", "follow_ups"),
    ]
    table_lookup = {(t.schema, t.name): t for t in Base.metadata.sorted_tables}
    gp = ["erDiagram"]
    for schema, name in CORE:
        gp += entity_block(table_lookup[(schema, name)], pick_columns(table_lookup[(schema, name)]))
    gp += [
        '    users ||--o| patient_profiles : "1:1 soft"',
        '    users ||--o{ medical_files : "patient soft"',
        '    medical_files ||--o{ images : "attached soft"',
        '    medical_files ||--o{ ai_analyses : "analysed soft"',
        '    medical_files ||--o{ prescriptions : "treated soft"',
        '    prescriptions ||--o{ orders : "fulfilled soft"',
        '    products ||--o{ orders : "catalog soft"',
        '    orders ||--|| invoices : "invoiced FK(commerce)"',
        '    orders ||--o| payments : "paid soft"',
        '    orders ||--o| shipments : "shipped soft"',
        '    medical_files ||--o{ follow_ups : "followed FK(cr)"',
    ]
    render_mmd("master-golden-path", "\n".join(gp), 1900)

    # ── 3) per-context ERDs ────────────────────────────────────────────
    md.append("\n## ۳) ERD به‌ازای هر Bounded Context (روابط FK واقعی)\n")
    for schema in sorted(by_schema):
        tables = by_schema[schema]
        code = ["erDiagram"]
        rels = intra_context_relations(schema)
        rel_entities = set()
        for r in rels:
            parts = r.split()
            rel_entities.add(parts[1])
            rel_entities.add(parts[3])
        for t in sorted(tables, key=lambda x: x.name):
            # include entity if it has relations or is a significant standalone table
            if rel_entities or len(t.columns) <= 30:
                code += entity_block(t, pick_columns(t))
        code += rels
        if len(rels) == 0:
            # standalone tables (e.g. payments) — still render the entity
            pass
        render_mmd(f"context-{schema}", "\n".join(code), 1600)
        fa = CONTEXT_FA.get(schema, schema)
        md.append(f"### Context «{schema}» — {fa} ({len(tables)} جدول)\n")
        md.append(f"![context-{schema}](erds/context-{schema}.png)\n")

    OUT_MD.write_text("\n".join(md), encoding="utf-8")
    pngs = sorted(ERD_DIR.glob("*.png"))
    print(f"generated {len(pngs)} PNG files + {OUT_MD}")
    for p in pngs:
        print("  ", p.name, f"{p.stat().st_size // 1024}KB")


if __name__ == "__main__":
    main()
