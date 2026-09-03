"""db-level guards: set_updated_at + append-only + forbid hard delete

Revision ID: 0003
Revises: 0e862845eba8
Create Date: 2026-09-04

Implements (PHASE 04 — Database Architecture):
- administration.set_updated_at(): maintains updated_at on 23 tables.
- administration.forbid_mutation(): append-only guard on 8 history tables —
  UPDATE and DELETE raise an exception (spec §7/§15/§32/§48 + ED-32/ED-50).
- administration.forbid_hard_delete(): soft-delete guard on 13 domain tables —
  DELETE raises; rows are retired via deleted_at (spec §48).

Notes:
- TRUNCATE (test/tooling) bypasses row triggers by design; production roles
  must not own TRUNCATE on protected schemas.
- Cascaded deletes fire these guards too — hard-deleting a parent is therefore
  impossible while its guarded children exist (fail-safe by construction).
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "0003"
down_revision: Union[str, None] = "0e862845eba8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UPDATED_AT_TABLES = [
    "ai.datasets", "ai.dataset_items",
    "clinical_review.diseases", "clinical_review.medical_files", "clinical_review.follow_ups",
    "commerce.orders", "commerce.carts", "commerce.cart_items", "commerce.invoices",
    "finance.expenses",
    "identity.roles", "identity.users",
    "medical_records.images",
    "patients.addresses", "patients.patient_profiles", "patients.referrals",
    "payments.payments",
    "prescriptions.prescriptions",
    "products.products", "products.inventories",
    "reporting.daily_revenue",
    "shipping.shipments",
    "tickets.tickets",
]

APPEND_ONLY_TABLES = [
    "administration.audit_logs",
    "clinical_review.case_events",
    "finance.financial_transactions",
    "notifications.sms_logs",
    "patients.questionnaire_responses",
    "products.inventory_movements",
    "products.product_price_history",
    "tickets.ticket_messages",
]

SOFT_DELETE_TABLES = [
    "ai.datasets",
    "clinical_review.diseases", "clinical_review.medical_files", "clinical_review.follow_ups",
    "commerce.orders",
    "identity.roles", "identity.users",
    "medical_records.images",
    "patients.addresses", "patients.questionnaires",
    "prescriptions.prescriptions",
    "products.products",
    "tickets.tickets",
]


def _q(table: str) -> str:
    schema, name = table.split(".")
    return f'"{schema}"."{name}"'


def upgrade() -> None:
    # ── trigger functions (owned by administration schema) ──────────────
    op.execute("""
        CREATE OR REPLACE FUNCTION administration.set_updated_at()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            NEW.updated_at := now();
            RETURN NEW;
        END;
        $$;
    """)
    op.execute("""
        CREATE OR REPLACE FUNCTION administration.forbid_mutation()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            RAISE EXCEPTION
                'table % is append-only: % is forbidden (spec §7/§15/§48)',
                TG_TABLE_NAME, TG_OP
                USING ERRCODE = 'check_violation';
        END;
        $$;
    """)
    op.execute("""
        CREATE OR REPLACE FUNCTION administration.forbid_hard_delete()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            RAISE EXCEPTION
                'hard DELETE forbidden on % — use soft delete (deleted_at) (spec §48)',
                TG_TABLE_NAME
                USING ERRCODE = 'check_violation';
        END;
        $$;
    """)

    # ── wire triggers ────────────────────────────────────────────────────
    for table in UPDATED_AT_TABLES:
        op.execute(
            f"CREATE TRIGGER trg_{table.replace('.', '_')}_set_updated_at "
            f"BEFORE UPDATE ON {_q(table)} "
            f"FOR EACH ROW EXECUTE FUNCTION administration.set_updated_at();"
        )
    for table in APPEND_ONLY_TABLES:
        op.execute(
            f"CREATE TRIGGER trg_{table.replace('.', '_')}_forbid_mutation "
            f"BEFORE UPDATE OR DELETE ON {_q(table)} "
            f"FOR EACH ROW EXECUTE FUNCTION administration.forbid_mutation();"
        )
    for table in SOFT_DELETE_TABLES:
        op.execute(
            f"CREATE TRIGGER trg_{table.replace('.', '_')}_forbid_hard_delete "
            f"BEFORE DELETE ON {_q(table)} "
            f"FOR EACH ROW EXECUTE FUNCTION administration.forbid_hard_delete();"
        )


def downgrade() -> None:
    for table in UPDATED_AT_TABLES:
        op.execute(f"DROP TRIGGER IF EXISTS trg_{table.replace('.', '_')}_set_updated_at ON {_q(table)};")
    for table in APPEND_ONLY_TABLES:
        op.execute(f"DROP TRIGGER IF EXISTS trg_{table.replace('.', '_')}_forbid_mutation ON {_q(table)};")
    for table in SOFT_DELETE_TABLES:
        op.execute(f"DROP TRIGGER IF EXISTS trg_{table.replace('.', '_')}_forbid_hard_delete ON {_q(table)};")
    op.execute("DROP FUNCTION IF EXISTS administration.set_updated_at();")
    op.execute("DROP FUNCTION IF EXISTS administration.forbid_mutation();")
    op.execute("DROP FUNCTION IF EXISTS administration.forbid_hard_delete();")
