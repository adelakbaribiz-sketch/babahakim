"""Medical Records context — medical image portfolio.

Table: images (4 storage variants + SHA-256 + quality JSONB, spec §8/§9).
Soft refs: owner_user_id → identity.users, medical_file_id → clinical_review.medical_files.
Sensitive medical data: soft-delete + hard-delete guard + view audit (administration.audit_logs).
Files live in object storage only (ADR-0006); this table stores storage keys.
"""
from __future__ import annotations

from sqlalchemy import text, BigInteger, Boolean, CheckConstraint, DateTime, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, CreatedOnlyMixin, IdMixin, SoftDeleteMixin, TimestampMixin
from . import statuses as S


class Image(IdMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "images"
    __table_args__ = (
        CheckConstraint(f"image_type {S.in_check(S.IMAGE_TYPES)}", name="image_type_domain"),
        CheckConstraint(f"status {S.in_check(S.IMAGE_STATUSES)}", name="status_domain"),
        CheckConstraint(f"mime {S.in_check(S.IMAGE_MIMES)}", name="mime_domain"),
        CheckConstraint("sha256 ~ '^[0-9a-f]{64}$'", name="sha256_format"),
        CheckConstraint("version >= 1", name="version_positive"),
        CheckConstraint("(width IS NULL AND height IS NULL) OR (width > 0 AND height > 0)", name="dimensions_positive"),
        CheckConstraint("size_original_bytes > 0", name="size_original_positive"),
        CheckConstraint("size_compressed_bytes IS NULL OR size_compressed_bytes <= size_original_bytes", name="compression_not_larger"),
        CheckConstraint("status <> 'REJECTED' OR rejection_reason IS NOT NULL", name="rejection_has_reason"),
        CheckConstraint("uploaded_from IN ('MOBILE', 'DESKTOP') OR uploaded_from IS NULL", name="upload_source_domain"),
        # de-dup per patient among active images
        UniqueConstraint("owner_user_id", "sha256", name="uq_images_owner_sha"),
        Index("ix_images_owner_time", "owner_user_id", "created_at"),
        Index("ix_images_medical_file", "medical_file_id", postgresql_where="medical_file_id IS NOT NULL"),
        Index("ix_images_status", "status"),
        Index("ix_images_type", "image_type"),
        {"schema": "medical_records", "comment": "Medical images (tongue/face/receipt/delivery/product) — 4 variants, quality-gated pipeline."},
    )

    owner_user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="soft-ref → identity.users.id (patient owner)")
    medical_file_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → clinical_review.medical_files.id once attached")
    image_type: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="PENDING", server_default="PENDING")
    storage_key_original: Mapped[str] = mapped_column(String(500), nullable=False, comment="object-storage key (bucket bh-medical)")
    storage_key_compressed: Mapped[str | None] = mapped_column(String(500), nullable=True)
    storage_key_ai: Mapped[str | None] = mapped_column(String(500), nullable=True, comment="AI-annotated variant")
    storage_key_thumb: Mapped[str | None] = mapped_column(String(500), nullable=True)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False, comment="integrity hash of original")
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    size_original_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    size_compressed_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    mime: Mapped[str] = mapped_column(String(50), nullable=False)
    quality: Mapped[dict | None] = mapped_column(JSONB, nullable=True,
        comment="{score, blur, brightness, exposure, resolution, orientation, issues[]}")
    is_deidentified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"), comment="pipeline §11 de-identification flag")
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    captured_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)
    uploaded_from: Mapped[str | None] = mapped_column(String(10), nullable=True, comment="MOBILE | DESKTOP (spec §8)")
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default=text("1"), comment="re-upload version for same slot")
