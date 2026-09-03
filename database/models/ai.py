"""AI context — model registry, analyses, learning datasets (spec §11/§12/§60-§63).

Tables: ai_models, ai_analyses, datasets, dataset_versions, dataset_items.
Real FKs: ai_models → dataset_versions, ai_analyses → ai_models/dataset_versions, dataset_items → dataset_versions.
Soft refs: image_id → medical_records.images, patient/user ids → identity.users,
medical_file_id → clinical_review.medical_files.
"""
from __future__ import annotations

from sqlalchemy import text, BigInteger, Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, CreatedOnlyMixin, IdMixin, SoftDeleteMixin, TimestampMixin
from . import statuses as S


# ── datasets (spec §12 Dataset Management) ───────────────────────────────

class Dataset(IdMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "datasets"
    __table_args__ = (
        CheckConstraint(f"status {S.in_check(S.DATASET_STATUSES)}", name="status_domain"),
        CheckConstraint(f"image_type {S.in_check(('TONGUE', 'FACE'))}", name="image_type_domain"),
        UniqueConstraint("name", name="uq_datasets_name"),
        {"schema": "ai", "comment": "Learning dataset registry (collected data pipeline §11)."},
    )

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_type: Mapped[str] = mapped_column(String(10), nullable=False, default="TONGUE", server_default="TONGUE")
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="DRAFT", server_default="DRAFT")


class DatasetVersion(IdMixin, CreatedOnlyMixin, Base):
    __tablename__ = "dataset_versions"
    __table_args__ = (
        CheckConstraint("version >= 1", name="version_positive"),
        CheckConstraint(f"status {S.in_check(S.DATASET_VERSION_STATUSES)}", name="status_domain"),
        # spec §63: splits must be PATIENT-level, not image-level
        CheckConstraint(f"split_strategy {S.in_check(S.DATASET_SPLIT_STRATEGIES)}", name="split_strategy_domain"),
        CheckConstraint("train_count >= 0 AND val_count >= 0 AND test_count >= 0", name="counts_nonnegative"),
        CheckConstraint("manifest_sha256 IS NULL OR manifest_sha256 ~ '^[0-9a-f]{64}$'", name="manifest_sha_format"),
        UniqueConstraint("dataset_id", "version", name="uq_dataset_versions_dataset_version"),
        Index("ix_dataset_versions_dataset", "dataset_id"),
        {"schema": "ai", "comment": "Immutable dataset versions — the unit referenced by ai_models.training_dataset_version_id."},
    )

    dataset_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("ai.datasets.id", ondelete="CASCADE"), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="BUILDING", server_default="BUILDING")
    split_strategy: Mapped[str] = mapped_column(String(20), nullable=False, default="PATIENT_LEVEL", server_default="PATIENT_LEVEL")
    train_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    val_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    test_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    train_patient_count: Mapped[int | None] = mapped_column(Integer, nullable=True, comment="distinct patients in TRAIN (leakage audit)")
    val_patient_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    test_patient_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    deidentified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"), comment="pipeline §11 de-identification completed")
    qc_passed_count: Mapped[int | None] = mapped_column(Integer, nullable=True, comment="quality-control survivors")
    manifest_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True, comment="content manifest checksum")
    created_by_user_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → identity.users.id")
    published_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)


class DatasetItem(IdMixin, TimestampMixin, Base):
    """One labelled image inside a dataset version (spec §12 + §82 + §83)."""
    __tablename__ = "dataset_items"
    __table_args__ = (
        CheckConstraint(f"split {S.in_check(S.DATASET_SPLITS)} OR split IS NULL", name="split_domain"),
        CheckConstraint(f"review_status {S.in_check(S.DATASET_ITEM_REVIEW_STATUSES)}", name="review_status_domain"),
        CheckConstraint(f"outcome {S.in_check(S.TREATMENT_OUTCOMES)} OR outcome IS NULL", name="outcome_domain"),
        CheckConstraint("confidence IS NULL OR (confidence >= 0 AND confidence <= 1)", name="confidence_range"),
        CheckConstraint("review_status <> 'EXCLUDED' OR excluded_reason IS NOT NULL", name="exclusion_has_reason"),
        # label precedence: final_label must be resolvable from expert agreement
        CheckConstraint(
            "(expert1_label IS NULL OR expert2_label IS NULL OR final_label IS NOT NULL OR has_disagreement)",
            name="disagreement_requires_resolution"),
        UniqueConstraint("dataset_version_id", "image_id", name="uq_dataset_items_version_image"),
        Index("ix_dataset_items_version_split", "dataset_version_id", "split"),
        Index("ix_dataset_items_disagreement", "dataset_version_id",
              postgresql_where="has_disagreement"),
        Index("ix_dataset_items_review_status", "review_status"),
        Index("ix_dataset_items_patient", "patient_ref_id"),
        {"schema": "ai", "comment": "Label ledger per image: ai/expert1/expert2/final labels, disagreement flag, review status, outcome."},
    )

    dataset_version_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("ai.dataset_versions.id", ondelete="CASCADE"), nullable=False)
    image_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="soft-ref → medical_records.images.id")
    patient_ref_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="soft-ref → identity.users.id — enables PATIENT-level split audit (§63)")
    split: Mapped[str | None] = mapped_column(String(8), nullable=True)
    ai_label: Mapped[str | None] = mapped_column(String(100), nullable=True)
    expert1_label: Mapped[str | None] = mapped_column(String(100), nullable=True)
    expert2_label: Mapped[str | None] = mapped_column(String(100), nullable=True)
    final_label: Mapped[str | None] = mapped_column(String(100), nullable=True, comment="only set after review (§83 — no auto-truth)")
    confidence: Mapped[float | None] = mapped_column(Numeric(4, 3), nullable=True)
    has_disagreement: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"), comment="expert1 ≠ expert2 → flag (spec §12)")
    review_status: Mapped[str] = mapped_column(String(16), nullable=False, default="PENDING", server_default="PENDING")
    reviewed_by_user_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → identity.users.id")
    reviewed_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)
    outcome: Mapped[str | None] = mapped_column(String(12), nullable=True, comment="post-follow-up outcome (§82 feedback loop)")
    excluded_reason: Mapped[str | None] = mapped_column(Text, nullable=True)


# ── ai_models (registry, spec §11/§61) ───────────────────────────────────

class AIModel(IdMixin, CreatedOnlyMixin, Base):
    __tablename__ = "ai_models"
    __table_args__ = (
        CheckConstraint("version >= 1", name="version_positive"),
        CheckConstraint(f"approval_status {S.in_check(S.AI_MODEL_APPROVAL_STATUSES)}", name="approval_status_domain"),
        CheckConstraint("approval_status IN ('APPROVED', 'DEPLOYED') OR approved_by_user_id IS NULL", name="approval_has_actor"),
        UniqueConstraint("name", "version", name="uq_ai_models_name_version"),
        # at most one deployed model per provider
        Index("uq_ai_models_deployed_provider", "provider", unique=True,
              postgresql_where="approval_status = 'DEPLOYED'"),
        Index("ix_ai_models_status", "approval_status"),
        {"schema": "ai", "comment": "Model registry with full lineage: dataset version, metrics, approval (spec §11)."},
    )

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    provider: Mapped[str] = mapped_column(String(100), nullable=False, comment="AIModelProvider implementation id")
    approval_status: Mapped[str] = mapped_column(String(20), nullable=False, default="DRAFT", server_default="DRAFT")
    metrics: Mapped[dict | None] = mapped_column(JSONB, nullable=True,
        comment="{accuracy, precision, recall, f1, confusion_matrix, sensitivity, specificity, calibration, per_class}")
    training_dataset_version_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("ai.dataset_versions.id", ondelete="RESTRICT"), nullable=True,
        comment="spec §11 — which dataset version trained this model")
    training_started_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)
    training_completed_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_by_user_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → identity.users.id (admin)")
    approved_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"), comment="serves inference when DEPLOYED+active")


# ── ai_analyses (spec §61 — every prediction knows its model lineage) ────

class AIAnalysis(IdMixin, CreatedOnlyMixin, Base):
    __tablename__ = "ai_analyses"
    __table_args__ = (
        CheckConstraint(f"status {S.in_check(S.AI_ANALYSIS_STATUSES)}", name="status_domain"),
        CheckConstraint(f"human_review_status {S.in_check(S.AI_REVIEW_STATUSES)}", name="review_status_domain"),
        CheckConstraint("confidence >= 0 AND confidence <= 1", name="confidence_range"),
        CheckConstraint("quality_score IS NULL OR (quality_score >= 0 AND quality_score <= 1)", name="quality_range"),
        CheckConstraint("processing_ms IS NULL OR processing_ms >= 0", name="processing_ms_nonnegative"),
        CheckConstraint("status <> 'FAILED' OR error IS NOT NULL", name="failure_has_error"),
        Index("ix_ai_analyses_medical_file", "medical_file_id"),
        Index("ix_ai_analyses_image", "image_id"),
        Index("ix_ai_analyses_model", "ai_model_id"),
        Index("ix_ai_analyses_review", "human_review_status"),
        {"schema": "ai", "comment": "Immutable prediction ledger (model/dataset/preprocessing/threshold per spec §61). Review fields are the only mutable part."},
    )

    medical_file_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → clinical_review.medical_files.id")
    image_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → medical_records.images.id")
    ai_model_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("ai.ai_models.id", ondelete="RESTRICT"), nullable=True)
    model_name: Mapped[str] = mapped_column(String(100), nullable=False, comment="snapshot: model name at run time")
    model_version: Mapped[int] = mapped_column(Integer, nullable=False)
    dataset_version_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("ai.dataset_versions.id", ondelete="RESTRICT"), nullable=True)
    preprocessing_version: Mapped[str | None] = mapped_column(String(20), nullable=True, comment="spec §61")
    threshold: Mapped[float | None] = mapped_column(Numeric(4, 3), nullable=True, comment="decision threshold used")
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="QUEUED", server_default="QUEUED")
    predictions: Mapped[dict] = mapped_column(JSONB, nullable=False,
        comment="[{indicator, value, confidence, note}]")
    explainability: Mapped[dict | None] = mapped_column(JSONB, nullable=True,
        comment="human-readable reasons — never proof of medical fact (§62)")
    features: Mapped[dict | None] = mapped_column(JSONB, nullable=True, comment="extracted features")
    confidence: Mapped[float] = mapped_column(Numeric(4, 3), nullable=False)
    quality_score: Mapped[float | None] = mapped_column(Numeric(4, 3), nullable=True)
    processing_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    human_review_status: Mapped[str] = mapped_column(String(16), nullable=False, default="PENDING_REVIEW", server_default="PENDING_REVIEW",
        comment="AI-CDS: never final medical result without human review (spec §3)")
    review_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_by_user_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → identity.users.id")
    reviewed_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)
