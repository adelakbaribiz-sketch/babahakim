"""create bounded-context schemas + pg_trgm extension

Revision ID: 0001
Revises:
Create Date: 2026-09-04

ADR-0004: one PostgreSQL schema per Bounded Context (15 contexts).
FK cross-schema is forbidden (D4) — soft references only.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCHEMAS = [
    "identity",          # users, sessions, RBAC
    "patients",          # profiles, addresses, questionnaire, referrals, contact logs
    "medical_records",   # medical images (4 variants)
    "ai",                # models, analyses, datasets
    "clinical_review",   # medical files (cases), reviews, diagnoses, follow-ups
    "products",          # catalog, price history, inventory
    "prescriptions",     # versioned prescriptions
    "commerce",          # carts, orders, invoices
    "payments",          # payment transactions
    "shipping",          # shipments
    "notifications",     # in-app notifications, SMS logs
    "tickets",           # support tickets
    "finance",           # ledger, expenses
    "administration",    # audit stream
    "reporting",         # CQRS-lite read models
]


def upgrade() -> None:
    # trigram fuzzy search for Persian/English product & disease names
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    for schema in SCHEMAS:
        op.execute(f'CREATE SCHEMA IF NOT EXISTS "{schema}"')


def downgrade() -> None:
    # schemas are dropped by the table migrations' cascade; here only the reverse
    for schema in reversed(SCHEMAS):
        op.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
    op.execute("DROP EXTENSION IF EXISTS pg_trgm")
