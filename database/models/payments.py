"""Payments context — payment transactions (gateway + card-to-card).

All external references are soft-refs (invoice/order → commerce, user → identity,
receipt image → medical_records) per D4.
Idempotency & uniqueness (spec §79): authority / ref_number / idempotency_key /
receipt_image_id — all partial-unique (NULL allowed, value never duplicated).
"""
from __future__ import annotations

from sqlalchemy import text, BigInteger, CheckConstraint, DateTime, Index, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, IdMixin, TimestampMixin
from . import statuses as S


class Payment(IdMixin, TimestampMixin, Base):
    """Financial record — no soft delete, no hard delete; lifecycle via status (ED-49)."""
    __tablename__ = "payments"
    __table_args__ = (
        CheckConstraint("code ~ '^PAY-[0-9]{6,10}$'", name="code_format"),
        CheckConstraint(f"status {S.in_check(S.PAYMENT_STATUSES)}", name="status_domain"),
        CheckConstraint(f"method {S.in_check(S.PAYMENT_METHODS)}", name="method_domain"),
        # money is strictly positive
        CheckConstraint("amount > 0", name="amount_positive"),
        # a PAID payment must be evidenced & timestamped
        CheckConstraint(
            "status <> 'PAID' OR (paid_at IS NOT NULL AND (ref_number IS NOT NULL OR tracking_code IS NOT NULL))",
            name="paid_has_evidence"),
        CheckConstraint("status <> 'AWAITING_VERIFY' OR (method = 'CARD_TO_CARD' AND receipt_image_id IS NOT NULL)",
                        name="verify_requires_receipt"),
        CheckConstraint("status <> 'FAILED' OR (error IS NOT NULL OR failed_at IS NOT NULL)", name="failure_evidenced"),
        # idempotency (spec §79) — partial uniques
        Index("uq_payments_authority", "authority", unique=True, postgresql_where="authority IS NOT NULL"),
        Index("uq_payments_ref_number", "ref_number", unique=True, postgresql_where="ref_number IS NOT NULL"),
        Index("uq_payments_idempotency_key", "idempotency_key", unique=True, postgresql_where="idempotency_key IS NOT NULL"),
        Index("uq_payments_receipt_image", "receipt_image_id", unique=True, postgresql_where="receipt_image_id IS NOT NULL"),
        # lookups
        UniqueConstraint("code", name="uq_payments_code"),
        Index("ix_payments_order", "order_id"),
        Index("ix_payments_invoice", "invoice_id"),
        Index("ix_payments_user_time", "user_id", "created_at"),
        Index("ix_payments_status_time", "status", "created_at"),
        {"schema": "payments", "comment": "Payments — idempotent gateway callbacks + operator-verified card-to-card."},
    )

    code: Mapped[str] = mapped_column(String(20), nullable=False, comment="PAY-14050001")
    invoice_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → commerce.invoices.id")
    order_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → commerce.orders.id")
    user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="soft-ref → identity.users.id (payer)")
    method: Mapped[str] = mapped_column(String(14), nullable=False)
    amount: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="Toman — strictly positive")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="PENDING", server_default="PENDING")
    authority: Mapped[str | None] = mapped_column(String(64), nullable=True, comment="gateway authority (unique)")
    ref_number: Mapped[str | None] = mapped_column(String(64), nullable=True, comment="gateway reference (unique)")
    tracking_code: Mapped[str | None] = mapped_column(String(64), nullable=True, comment="card-to-card tracking")
    receipt_image_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → medical_records.images.id (unique)")
    receipt_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    gateway_response: Mapped[dict | None] = mapped_column(JSONB, nullable=True, comment="raw gateway payload")
    idempotency_key: Mapped[str | None] = mapped_column(String(64), nullable=True, comment="callback dedup key (spec §79)")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    verified_by_user_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → identity.users.id (operator)")
    verified_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)
    paid_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)
    failed_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)
