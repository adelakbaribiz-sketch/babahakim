"""Finance context — financial transactions ledger + expenses.

financial_transactions: APPEND-ONLY (trigger-guarded) — accounting corrections are
new reversing entries, never edits (ED-50). All external refs are soft-refs.
"""
from __future__ import annotations

from sqlalchemy import text, BigInteger, CheckConstraint, Date, DateTime, Index, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, CreatedOnlyMixin, IdMixin, TimestampMixin
from . import statuses as S


class FinancialTransaction(IdMixin, CreatedOnlyMixin, Base):
    __tablename__ = "financial_transactions"
    __table_args__ = (
        CheckConstraint(f"txn_type {S.in_check(S.FINANCE_TXN_TYPES)}", name="txn_type_domain"),
        CheckConstraint(f"category {S.in_check(S.FINANCE_TXN_CATEGORIES)}", name="category_domain"),
        CheckConstraint("amount > 0", name="amount_positive"),
        CheckConstraint("occurred_at <= now()", name="occurred_not_future"),
        Index("ix_financial_txns_type_time", "txn_type", "occurred_at"),
        Index("ix_financial_txns_category_time", "category", "occurred_at"),
        Index("ix_financial_txns_order", "order_id", postgresql_where="order_id IS NOT NULL"),
        Index("ix_financial_txns_payment", "payment_id", postgresql_where="payment_id IS NOT NULL"),
        Index("brin_financial_txns_occurred_at", "occurred_at", postgresql_using="brin"),
        {"schema": "finance", "comment": "Accounting ledger (append-only). Corrections = reversing entries (ED-50)."},
    )

    txn_type: Mapped[str] = mapped_column(String(16), nullable=False, comment="INCOME | EXPENSE | REFUND | COMMISSION | SHIPPING_COST | ADJUSTMENT")
    category: Mapped[str] = mapped_column(String(20), nullable=False)
    amount: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="Toman — strictly positive; direction comes from txn_type")
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    order_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → commerce.orders.id")
    payment_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → payments.payments.id")
    invoice_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → commerce.invoices.id")
    referral_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → patients.referrals.id")
    medical_file_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → clinical_review.medical_files.id")
    created_by_user_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → identity.users.id")
    occurred_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class Expense(IdMixin, TimestampMixin, Base):
    """Operational expense records — approval workflow; no delete (ED-49)."""
    __tablename__ = "expenses"
    __table_args__ = (
        CheckConstraint(f"category {S.in_check(S.EXPENSE_CATEGORIES)}", name="category_domain"),
        CheckConstraint(f"status {S.in_check(S.EXPENSE_STATUSES)}", name="status_domain"),
        CheckConstraint("amount > 0", name="amount_positive"),
        CheckConstraint("status <> 'APPROVED' OR approved_at IS NOT NULL", name="approval_has_timestamp"),
        CheckConstraint("incurred_date <= CURRENT_DATE", name="incurred_not_future"),
        Index("ix_expenses_category_date", "category", "incurred_date"),
        Index("ix_expenses_status", "status", postgresql_where="status = 'PENDING'"),
        {"schema": "finance", "comment": "Company expenses with receipt image + approval flow (spec §39)."},
    )

    category: Mapped[str] = mapped_column(String(20), nullable=False)
    amount: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="Toman")
    description: Mapped[str] = mapped_column(Text, nullable=False)
    receipt_image_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → medical_records.images.id")
    incurred_date: Mapped[object] = mapped_column(Date, nullable=False)
    paid_by_user_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → identity.users.id")
    approved_by_user_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → identity.users.id")
    approved_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="PENDING", server_default="PENDING")
