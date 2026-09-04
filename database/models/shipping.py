"""Shipping context — shipments (motorcycle/car/post/courier) + delivery proof.

All external references are soft-refs (order → commerce, proof image → medical_records).
One shipment per order (UNIQUE order_id) — ED-33 single-writer cascade rule.
"""
from __future__ import annotations

from sqlalchemy import text, BigInteger, CheckConstraint, DateTime, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, IdMixin, TimestampMixin
from . import statuses as S


class Shipment(IdMixin, TimestampMixin, Base):
    """Operational record — lifecycle via status; no delete (deliveries are auditable)."""
    __tablename__ = "shipments"
    __table_args__ = (
        CheckConstraint(f"status {S.in_check(S.SHIPMENT_STATUSES)}", name="status_domain"),
        CheckConstraint(f"method {S.in_check(S.SHIPMENT_METHODS)}", name="method_domain"),
        CheckConstraint("cost >= 0", name="cost_nonnegative"),
        CheckConstraint("driver_phone IS NULL OR driver_phone ~ '^\\+?[0-9]{10,15}$'", name="driver_phone_format"),
        CheckConstraint("receiver_phone IS NULL OR receiver_phone ~ '^\\+?[0-9]{10,15}$'", name="receiver_phone_format"),
        CheckConstraint("status <> 'DELIVERED' OR (delivered_at IS NOT NULL AND (proof_image_id IS NOT NULL OR receiver_phone IS NOT NULL))",
                        name="delivery_evidenced"),
        CheckConstraint("status <> 'SHIPPED' OR shipped_at IS NOT NULL", name="shipped_has_timestamp"),
        # one shipment per order (ED-33)
        Index("uq_shipments_order", "order_id", unique=True),
        Index("uq_shipments_proof_image", "proof_image_id", unique=True, postgresql_where="proof_image_id IS NOT NULL"),
        Index("ix_shipments_status_time", "status", "created_at"),
        Index("ix_shipments_tracking", "tracking_code", postgresql_where="tracking_code IS NOT NULL"),
        {"schema": "shipping", "comment": "Deliveries with tracking, driver info, cost and delivery proof image."},
    )

    order_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="soft-ref → commerce.orders.id (unique)")
    method: Mapped[str] = mapped_column(String(12), nullable=False)
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="PREPARING", server_default="PREPARING")
    driver_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    driver_phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    receiver_phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    carrier: Mapped[str | None] = mapped_column(String(50), nullable=True, comment="for POST/COURIER")
    vehicle_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    tracking_code: Mapped[str | None] = mapped_column(String(40), nullable=True)
    address_snapshot: Mapped[dict | None] = mapped_column(JSONB, nullable=True, comment="frozen destination at dispatch")
    cost: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default=text("0"), comment="Toman")
    proof_image_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → medical_records.images.id (unique)")
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    shipped_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)
    delivered_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)
    failed_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)
