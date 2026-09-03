"""BabaHakim — SQLAlchemy declarative base, naming conventions and shared mixins.

Database architecture (ADR-0004 / PHASE 04):
- PostgreSQL 16, one schema per Bounded Context (15 schemas).
- PK: BIGINT GENERATED ALWAYS AS IDENTITY.
- Money: BIGINT (integer Toman — no fractional currency in Iran).
- Timestamps: TIMESTAMPTZ (server now()).
- Status fields: VARCHAR + CHECK constraint (migration-friendly vs ENUM types).
- Soft delete: `deleted_at` column + DB-level hard-delete guard trigger.
- History/versioning: append-only tables with mutation-guard triggers.
- Cross-context references: SOFT references (plain BIGINT + index, NO FK) per D4.
- Intra-context references: real FOREIGN KEY constraints.
"""
from __future__ import annotations

from sqlalchemy import BigInteger, CheckConstraint, DateTime, Identity, Index, MetaData, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_name)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


# ── Mixins ──────────────────────────────────────────────────────────────

class IdMixin:
    """BIGINT IDENTITY primary key (surrogate, migration-safe, index-friendly)."""
    id: Mapped[int] = mapped_column(
        BigInteger, Identity(always=True), primary_key=True, autoincrement=True
    )


class TimestampMixin:
    """created_at (insert) + updated_at (maintained by DB trigger set_updated_at)."""
    created_at: Mapped[object] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[object] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class SoftDeleteMixin:
    """Soft delete column. Hard DELETE is blocked by trigger `forbid_hard_delete`.

    Spec §48: Hard delete is forbidden for important data; use deleted_at +
    active/inactive status.
    """
    deleted_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)


class CreatedOnlyMixin:
    """created_at only (append-only tables have no updated_at by design)."""
    created_at: Mapped[object] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


# ── Registries consumed by migration 0003 (trigger wiring) ─────────────
# Tables whose rows must never be UPDATEd or DELETEd (append-only history).
APPEND_ONLY_TABLES = {
    "administration.audit_logs",
    "products.product_price_history",
    "products.inventory_movements",
    "patients.questionnaire_responses",
    "clinical_review.case_events",
    "notifications.sms_logs",
    "tickets.ticket_messages",
    "finance.financial_transactions",
}

# Tables protected from hard DELETE (soft-delete policy, spec §48).
# Derived automatically: any table with a `deleted_at` column.
def soft_delete_tables() -> list[str]:
    tables = []
    for table in Base.metadata.sorted_tables:
        if "deleted_at" in table.c:
            tables.append(f"{table.schema}.{table.name}")
    return tables


def updated_at_tables() -> list[str]:
    tables = []
    for table in Base.metadata.sorted_tables:
        if "updated_at" in table.c:
            tables.append(f"{table.schema}.{table.name}")
    return tables
