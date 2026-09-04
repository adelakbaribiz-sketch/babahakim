"""Prescriptions context — versioned prescriptions with supersede lineage (spec §16).

Real FKs: prescription_items → prescriptions, prescriptions → prescriptions (supersede chain).
Soft refs: medical_file_id → clinical_review.medical_files, product/user ids.
Rule (spec §16): هر تغییر نسخه → نسخه جدید؛ تاریخچه حفظ شود.
"""
from __future__ import annotations

from sqlalchemy import text, BigInteger, Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, CreatedOnlyMixin, IdMixin, SoftDeleteMixin, TimestampMixin
from . import statuses as S


class Prescription(IdMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "prescriptions"
    __table_args__ = (
        CheckConstraint("version >= 1", name="version_positive"),
        CheckConstraint(f"status {S.in_check(S.PRESCRIPTION_STATUSES)}", name="status_domain"),
        CheckConstraint("total_estimate IS NULL OR total_estimate >= 0", name="total_estimate_nonnegative"),
        CheckConstraint("status <> 'SUPERSEDED' OR superseded_by_prescription_id IS NOT NULL", name="superseded_has_successor"),
        CheckConstraint("status <> 'APPROVED' OR (approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)", name="approved_has_actor"),
        CheckConstraint("status <> 'FINALIZED' OR finalized_at IS NOT NULL", name="finalized_has_timestamp"),
        # one living version chain per medical file & version number
        UniqueConstraint("medical_file_id", "version", name="uq_prescriptions_file_version"),
        Index("ix_prescriptions_file_status", "medical_file_id", "status", postgresql_where="deleted_at IS NULL"),
        Index("ix_prescriptions_superseded_by", "superseded_by_prescription_id"),
        {"schema": "prescriptions", "comment": "Prescription versions — supersede chain keeps full history (spec §16)."},
    )

    medical_file_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="soft-ref → clinical_review.medical_files.id")
    version: Mapped[int] = mapped_column(Integer, nullable=False, comment="1,2,3… per medical file")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="DRAFT", server_default="DRAFT")
    created_by_user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="soft-ref → identity.users.id (expert 1)")
    expert1_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    expert2_notes: Mapped[str | None] = mapped_column(Text, nullable=True, comment="availability/pricing review notes")
    doctor_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    approved_by_user_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → identity.users.id (doctor)")
    approved_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)
    superseded_by_prescription_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("prescriptions.prescriptions.id", ondelete="SET NULL"), nullable=True,
        comment="lineage pointer when this version is superseded")
    finalized_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)
    total_estimate: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="estimated total (Toman) by expert 2")


class PrescriptionItem(IdMixin, CreatedOnlyMixin, Base):
    __tablename__ = "prescription_items"
    __table_args__ = (
        CheckConstraint("quantity >= 1", name="quantity_at_least_one"),
        CheckConstraint("unit_price IS NULL OR unit_price >= 0", name="unit_price_nonnegative"),
        # exactly one of available/missing (ED-06 classification is mandatory)
        CheckConstraint("is_available <> is_missing", name="availability_flagged"),
        Index("ix_prescription_items_prescription", "prescription_id"),
        Index("ix_prescription_items_product", "product_id", postgresql_where="product_id IS NOT NULL"),
        {"schema": "prescriptions", "comment": "Prescription line items: drug, dosage, frequency, duration, instructions, warnings, availability."},
    )

    prescription_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("prescriptions.prescriptions.id", ondelete="CASCADE"), nullable=False)
    product_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → products.products.id (NULL = compounded/external)")
    drug_name: Mapped[str] = mapped_column(String(200), nullable=False, comment="snapshot name at prescription time")
    dosage: Mapped[str | None] = mapped_column(String(100), nullable=True, comment="مقدار مصرف")
    frequency: Mapped[str | None] = mapped_column(String(100), nullable=True, comment="تناوب")
    duration: Mapped[str | None] = mapped_column(String(100), nullable=True, comment="مدت")
    instructions_fa: Mapped[str | None] = mapped_column(Text, nullable=True)
    instructions_en: Mapped[str | None] = mapped_column(Text, nullable=True)
    warnings: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_available: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"), comment="قابل تهیه")
    is_missing: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"), comment="اقلام ناقص (ED-06)")
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default=text("1"))
    unit_price: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="price snapshot (Toman)")
