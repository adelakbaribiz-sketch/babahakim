"""Schema structure tests — schemas, tables, PKs, FKs, uniques, checks, triggers.

Validates the structural contract of PHASE 04 Database Architecture:
15 bounded-context schemas · 49 tables · real FKs intra-schema only (D4) ·
partial/unique/check constraints · trigger guards wired by migration 0003.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from models import Base  # noqa: E402

EXPECTED_SCHEMAS = {
    "identity", "patients", "medical_records", "ai", "clinical_review", "products",
    "prescriptions", "commerce", "payments", "shipping", "notifications", "tickets",
    "finance", "administration", "reporting",
}

APPEND_ONLY = {
    "administration.audit_logs", "clinical_review.case_events",
    "finance.financial_transactions", "notifications.sms_logs",
    "patients.questionnaire_responses", "products.inventory_movements",
    "products.product_price_history", "tickets.ticket_messages",
}

SOFT_DELETE_TABLES = {t for t in (
    "ai.datasets", "clinical_review.diseases", "clinical_review.medical_files",
    "clinical_review.follow_ups", "commerce.orders", "identity.roles", "identity.users",
    "medical_records.images", "patients.addresses", "patients.questionnaires",
    "prescriptions.prescriptions", "products.products", "tickets.tickets",
)}


def q(schema, name):
    return f'"{schema}"."{name}"'


class TestSchemasAndTables:
    def test_all_fifteen_schemas_exist(self, conn):
        rows = conn.execute(text(
            "SELECT schema_name FROM information_schema.schemata"
        )).fetchall()
        actual = {r[0] for r in rows}
        assert EXPECTED_SCHEMAS <= actual

    def test_all_49_tables_exist(self, conn):
        rows = conn.execute(text(
            "SELECT table_schema, table_name FROM information_schema.tables "
            "WHERE table_schema = ANY(:schemas)"
        ), {"schemas": list(EXPECTED_SCHEMAS)}).fetchall()
        actual = {f"{r[0]}.{r[1]}" for r in rows}
        expected = {f"{t.schema}.{t.name}" for t in Base.metadata.sorted_tables}
        assert expected == actual
        assert len(expected) == 49

    def test_every_table_has_primary_key(self, conn):
        rows = conn.execute(text("""
            SELECT tc.table_schema, tc.table_name
            FROM information_schema.tables t
            LEFT JOIN information_schema.table_constraints tc
              ON tc.table_name = t.table_name AND tc.table_schema = t.table_schema
              AND tc.constraint_type = 'PRIMARY KEY'
            WHERE t.table_schema = ANY(:schemas) AND t.table_type = 'BASE TABLE'
              AND tc.constraint_name IS NULL
        """), {"schemas": list(EXPECTED_SCHEMAS)}).fetchall()
        assert rows == [], f"tables without PK: {rows}"

    def test_pk_is_bigint_identity(self, conn):
        rows = conn.execute(text("""
            SELECT table_schema, table_name, data_type, is_identity
            FROM information_schema.columns
            WHERE table_schema = ANY(:schemas) AND column_name = 'id'
              AND (data_type <> 'bigint' OR is_identity <> 'YES')
        """), {"schemas": list(EXPECTED_SCHEMAS)}).fetchall()
        assert rows == [], f"id columns not BIGINT IDENTITY: {rows}"


class TestForeignKeys:
    def test_no_cross_schema_foreign_keys(self, conn):
        """ADR-0004/D4: cross-context references must be soft (no FK constraint)."""
        rows = conn.execute(text("""
            SELECT ns.nspname AS table_schema, c.relname AS table_name,
                   rf.relname AS ref_table, nf.nspname AS ref_schema
            FROM pg_constraint con
            JOIN pg_class c ON c.oid = con.conrelid
            JOIN pg_namespace ns ON ns.oid = c.relnamespace
            JOIN pg_class rf ON rf.oid = con.confrelid
            JOIN pg_namespace nf ON nf.oid = rf.relnamespace
            WHERE con.contype = 'f' AND ns.nspname = ANY(:schemas)
        """), {"schemas": list(EXPECTED_SCHEMAS)}).fetchall()
        cross = [r for r in rows if r[0] != r[3]]
        assert cross == [], f"cross-schema FKs forbidden (D4): {cross}"

    def test_fk_cascade_rules(self, conn):
        """Sensitive children cascade with parents; history rows RESTRICT parents."""
        rows = conn.execute(text("""
            SELECT ns.nspname || '.' || c.relname AS child,
                   nf.nspname || '.' || rf.relname AS parent, con.confdeltype
            FROM pg_constraint con
            JOIN pg_class c ON c.oid = con.conrelid
            JOIN pg_namespace ns ON ns.oid = c.relnamespace
            JOIN pg_class rf ON rf.oid = con.confrelid
            JOIN pg_namespace nf ON nf.oid = rf.relnamespace
            WHERE con.contype = 'f' AND ns.nspname = ANY(:schemas)
        """), {"schemas": list(EXPECTED_SCHEMAS)}).fetchall()
        m = {(r[0], r[1]): r[2] for r in rows}  # c=cascade, r=restrict, n=setnull, a=no-action
        # timeline/case cascade
        assert m[("clinical_review.case_events", "clinical_review.medical_files")] == "c"
        # price history survives product deletion attempt (RESTRICT)
        assert m[("products.product_price_history", "products.products")] == "r"
        assert m[("products.inventories", "products.products")] == "r"
        assert m[("products.inventory_movements", "products.products")] == "r"
        # history of answers RESTRICTS question deletion
        assert m[("patients.answers", "patients.questions")] == "r"
        assert m[("patients.answers", "patients.question_options")] == "r"
        # sessions cascade with user
        assert m[("identity.refresh_tokens", "identity.users")] == "c"

    def test_core_intra_schema_fks_exist(self, conn):
        rows = conn.execute(text("""
            SELECT ns.nspname || '.' || c.relname
            FROM pg_constraint con
            JOIN pg_class c ON c.oid = con.conrelid
            JOIN pg_namespace ns ON ns.oid = c.relnamespace
            WHERE con.contype = 'f' AND ns.nspname = ANY(:schemas)
        """), {"schemas": list(EXPECTED_SCHEMAS)}).fetchall()
        fks = {r[0] for r in rows}
        expected = {
            "identity.refresh_tokens", "identity.role_permissions",
            "patients.questions", "patients.question_options",
            "patients.questionnaire_responses", "patients.answers",
            "ai.dataset_versions", "ai.dataset_items", "ai.ai_models", "ai.ai_analyses",
            "clinical_review.medical_files", "clinical_review.case_events",
            "clinical_review.diagnoses",
            "clinical_review.expert_reviews", "clinical_review.doctor_reviews",
            "clinical_review.follow_ups",
            "prescriptions.prescriptions", "prescriptions.prescription_items",
            "products.product_price_history", "products.inventories",
            "products.inventory_movements", "products.disease_products",
            "commerce.carts", "commerce.cart_items",
            "commerce.order_items", "commerce.invoices",
            "tickets.ticket_messages",
        }
        assert expected <= fks, f"missing FK tables: {expected - fks}"


class TestUniquesAndChecks:
    def test_business_code_uniques(self, conn):
        rows = conn.execute(text(
            "SELECT indexdef FROM pg_indexes WHERE schemaname = ANY(:schemas)"
        ), {"schemas": list(EXPECTED_SCHEMAS)}).fetchall()
        defs = " ".join(r[0] for r in rows)
        for uq in [
            "uq_medical_files_code", "uq_orders_code", "uq_invoices_code",
            "uq_payments_code", "uq_tickets_code", "uq_products_sku",
            "uq_diseases_code", "uq_users_phone_active", "uq_carts_active_per_user",
            "uq_prescriptions_file_version", "uq_questionnaires_single_active",
            "uq_shipments_order", "uq_addresses_default_per_user",
            "uq_referrals_referred_user", "uq_images_owner_sha",
            "uq_payments_authority", "uq_payments_ref_number",
            "uq_payments_idempotency_key", "uq_dataset_items_version_image",
            "uq_ai_models_name_version", "uq_dataset_versions_dataset_version",
        ]:
            assert uq in defs, f"missing unique index {uq}"

    def test_partial_indexes_carry_predicates(self, conn):
        rows = conn.execute(text(
            "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = ANY(:schemas)"
        ), {"schemas": list(EXPECTED_SCHEMAS)}).fetchall()
        defs = {r[0]: r[1] for r in rows}
        partial_expected = {
            "uq_users_phone_active": "deleted_at IS NULL",
            "uq_users_email_active": "email IS NOT NULL",
            "uq_questionnaires_single_active": "is_active",
            "uq_addresses_default_per_user": "is_default",
            "uq_carts_active_per_user": "ACTIVE",
            "ix_medical_files_status": "deleted_at IS NULL",
            "ix_notifications_unread": "is_read = false",
            "ix_inventory_movements_order": "order_id IS NOT NULL",
            "uq_payments_authority": "authority IS NOT NULL",
            "ix_audit_logs_sensitive": "is_sensitive",
        }
        for name, frag in partial_expected.items():
            assert name in defs, f"missing index {name}"
            assert " WHERE " in defs[name] and frag in defs[name], (
                f"{name} must be partial ({frag}): {defs[name]}")

    def test_check_constraints_catalogue(self, conn):
        rows = conn.execute(text("""
            SELECT n.nspname, c.relname, con.conname
            FROM pg_constraint con
            JOIN pg_class c ON c.oid = con.conrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE con.contype = 'c' AND n.nspname = ANY(:schemas)
        """), {"schemas": list(EXPECTED_SCHEMAS)}).fetchall()
        checks = {f"{r[0]}.{r[1]}.{r[2]}" for r in rows}
        expected = [
            "commerce.orders.ck_orders_total_math",
            "commerce.order_items.ck_order_items_line_math",
            "payments.payments.ck_payments_amount_positive",
            "payments.payments.ck_payments_paid_has_evidence",
            "payments.payments.ck_payments_verify_requires_receipt",
            "products.inventory_movements.ck_inventory_movements_movement_sign",
            "products.inventory_movements.ck_inventory_movements_balance_nonnegative",
            "products.inventories.ck_inventories_reserved_within_on_hand",
            "products.products.ck_products_otc_excludes_prescription",
            "prescriptions.prescription_items.ck_prescription_items_availability_flagged",
            "prescriptions.prescriptions.ck_prescriptions_superseded_has_successor",
            "clinical_review.medical_files.ck_medical_files_status_domain",
            "clinical_review.medical_files.ck_medical_files_closed_has_timestamp",
            "medical_records.images.ck_images_rejection_has_reason",
            "medical_records.images.ck_images_compression_not_larger",
            "identity.users.ck_users_phone_format",
            "patients.addresses.ck_addresses_postal_code_format",
            "ai.dataset_items.ck_dataset_items_disagreement_requires_resolution",
            "ai.ai_analyses.ck_ai_analyses_confidence_range",
            "administration.audit_logs.ck_audit_logs_workflow_events_carry_diff",
            "finance.financial_transactions.ck_financial_transactions_amount_positive",
            "finance.expenses.ck_expenses_incurred_not_future",
        ]
        for e in expected:
            assert e in checks, f"missing check constraint {e} (have {len(checks)} total)"

    def test_check_constraint_count_is_rich(self, conn):
        rows = conn.execute(text("""
            SELECT count(*) FROM pg_constraint con
            JOIN pg_namespace n ON n.oid = con.connamespace
            WHERE con.contype = 'c' AND n.nspname = ANY(:schemas)
        """), {"schemas": list(EXPECTED_SCHEMAS)}).fetchone()
        # 49 tables with status/range/math/phone/format discipline
        assert rows[0] >= 60, f"only {rows[0]} check constraints — expected a rich contract"


class TestTriggerWiring:
    def test_updated_at_triggers(self, conn):
        rows = conn.execute(text(
            "SELECT DISTINCT event_object_schema || '.' || event_object_table "
            "FROM information_schema.triggers "
            "WHERE trigger_name LIKE 'trg%_set_updated_at'"
        )).fetchall()
        wired = {r[0] for r in rows}
        assert len(wired) == 23, f"expected 23 updated_at triggers, got {len(wired)}"

    def test_append_only_triggers(self, conn):
        rows = conn.execute(text("""
            SELECT DISTINCT event_object_schema || '.' || event_object_table
            FROM information_schema.triggers
            WHERE trigger_name LIKE 'trg%_forbid_mutation'
        """)).fetchall()
        wired = {r[0] for r in rows}
        assert wired == APPEND_ONLY, f"append-only mismatch: {APPEND_ONLY ^ wired}"

    def test_hard_delete_triggers(self, conn):
        rows = conn.execute(text("""
            SELECT DISTINCT event_object_schema || '.' || event_object_table
            FROM information_schema.triggers
            WHERE trigger_name LIKE 'trg%_forbid_hard_delete'
        """)).fetchall()
        wired = {r[0] for r in rows}
        assert wired == SOFT_DELETE_TABLES, f"soft-delete guard mismatch: {SOFT_DELETE_TABLES ^ wired}"

    def test_guard_functions_live_in_administration(self, conn):
        rows = conn.execute(text(
            "SELECT routine_name FROM information_schema.routines "
            "WHERE routine_schema = 'administration' ORDER BY 1"
        )).fetchall()
        assert [r[0] for r in rows] == ["forbid_hard_delete", "forbid_mutation", "set_updated_at"]
