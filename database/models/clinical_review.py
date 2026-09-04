"""Clinical Review context — medical files (cases), timeline, diseases, diagnoses,
expert/doctor reviews, follow-ups.

Real FKs (intra-schema): case_events/diagnoses/expert_reviews/doctor_reviews/follow_ups
→ medical_files; diagnoses → diseases; medical_files → medical_files (reassessment lineage).
Soft refs: patient/expert/doctor user ids → identity.users; prescription/ai/image/questionnaire ids.
"""
from __future__ import annotations

from sqlalchemy import text, BigInteger, Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, CreatedOnlyMixin, IdMixin, SoftDeleteMixin, TimestampMixin
from . import statuses as S

# ── diseases (catalog, spec §13) ──────────────────────────────────────────

class Disease(IdMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "diseases"
    __table_args__ = (
        CheckConstraint("code ~ '^[A-Z0-9-]{2,20}$'", name="code_format"),
        UniqueConstraint("code", name="uq_diseases_code"),
        Index("ix_diseases_category", "category"),
        Index("ix_diseases_name_fa_trgm", "name_fa", postgresql_using="gin",
              postgresql_ops={"name_fa": "gin_trgm_ops"}),
        Index("ix_diseases_name_en_trgm", "name_en", postgresql_using="gin",
              postgresql_ops={"name_en": "gin_trgm_ops"}),
        {"schema": "clinical_review", "comment": "Disease catalog managed by admin (code, bilingual names, symptoms, expert notes)."},
    )

    code: Mapped[str] = mapped_column(String(20), nullable=False)
    name_fa: Mapped[str] = mapped_column(String(200), nullable=False)
    name_en: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str | None] = mapped_column(String(50), nullable=True)
    description_fa: Mapped[str | None] = mapped_column(Text, nullable=True)
    description_en: Mapped[str | None] = mapped_column(Text, nullable=True)
    symptoms_fa: Mapped[str | None] = mapped_column(Text, nullable=True)
    symptoms_en: Mapped[str | None] = mapped_column(Text, nullable=True)
    expert_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))


# ── medical_files (case aggregate root, 17-stage lifecycle) ──────────────

class MedicalFile(IdMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "medical_files"
    __table_args__ = (
        CheckConstraint("code ~ '^[A-Z]{2,4}-[0-9]{4}-[0-9]{4,6}$'", name="code_format"),
        CheckConstraint(f"status {S.in_check(S.CASE_STATUSES)}", name="status_domain"),
        CheckConstraint(f"priority {S.in_check(S.CASE_PRIORITIES)}", name="priority_domain"),
        CheckConstraint("follow_up_days IS NULL OR (follow_up_days >= 1 AND follow_up_days <= 365)", name="followup_days_range"),
        CheckConstraint("treatment_approved IS NULL OR treatment_decided_at IS NOT NULL", name="approval_has_timestamp"),
        CheckConstraint("(status <> 'CLOSED') OR (closed_at IS NOT NULL)", name="closed_has_timestamp"),
        CheckConstraint("(status <> 'CANCELLED') OR (cancelled_reason IS NOT NULL)", name="cancel_has_reason"),
        UniqueConstraint("code", name="uq_medical_files_code"),
        # queue scans (only live files)
        Index("ix_medical_files_status", "status", postgresql_where="deleted_at IS NULL"),
        Index("ix_medical_files_patient_time", "patient_user_id", "created_at"),
        # staff queues + SLA wait time
        Index("ix_medical_files_expert1_queue", "assigned_expert1_user_id", "status",
              postgresql_where="assigned_expert1_user_id IS NOT NULL AND deleted_at IS NULL"),
        Index("ix_medical_files_expert2_queue", "assigned_expert2_user_id", "status",
              postgresql_where="assigned_expert2_user_id IS NOT NULL AND deleted_at IS NULL"),
        Index("ix_medical_files_doctor_queue", "assigned_doctor_user_id", "status",
              postgresql_where="assigned_doctor_user_id IS NOT NULL AND deleted_at IS NULL"),
        Index("ix_medical_files_priority", "priority", "created_at", postgresql_where="deleted_at IS NULL"),
        # follow-up due scan
        Index("ix_medical_files_followup_due", "follow_up_at",
              postgresql_where="follow_up_at IS NOT NULL AND deleted_at IS NULL"),
        Index("ix_medical_files_reassessment", "reassessment_of_file_id"),
        {"schema": "clinical_review", "comment": "Patient case aggregate (spec §17 17-stage lifecycle, 21 statuses). Reassessment = new file with lineage (ED-13)."},
    )

    code: Mapped[str] = mapped_column(String(30), nullable=False, comment="BH-1405-00001 (legacy TC- accepted)")
    patient_user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="soft-ref → identity.users.id")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="NEW", server_default="NEW")
    priority: Mapped[str] = mapped_column(String(8), nullable=False, default="NORMAL", server_default="NORMAL")
    description: Mapped[str | None] = mapped_column(Text, nullable=True, comment="شرح حال (patient history)")
    mizaj_snapshot: Mapped[dict | None] = mapped_column(JSONB, nullable=True, comment="mizaj frozen at case creation")
    questionnaire_response_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → patients.questionnaire_responses.id")
    assigned_expert1_user_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → identity.users.id")
    assigned_expert2_user_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → identity.users.id")
    assigned_doctor_user_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → identity.users.id")
    claimed_expert1_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True, comment="SLA wait-time metric")
    claimed_expert2_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)
    doctor_assigned_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)
    current_prescription_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → prescriptions.prescriptions.id (active version)")
    current_ai_analysis_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → ai.ai_analyses.id (latest)")
    expert1_summary: Mapped[str | None] = mapped_column(Text, nullable=True, comment="initial assessment sent to patient")
    treatment_approved: Mapped[bool | None] = mapped_column(Boolean, nullable=True, comment="NULL=not asked, true/false=user decision (user gate G7)")
    treatment_decided_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)
    follow_up_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    follow_up_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closing_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    closed_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    cancelled_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reassessment_of_file_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("clinical_review.medical_files.id", ondelete="SET NULL"), nullable=True,
        comment="ED-13: reassessment creates a new file, lineage kept")


# ── case_events (append-only timeline, ED-32) ────────────────────────────

class CaseEvent(IdMixin, CreatedOnlyMixin, Base):
    __tablename__ = "case_events"
    __table_args__ = (
        CheckConstraint("from_status IS NOT NULL OR to_status IS NOT NULL OR action <> 'STATUS_CHANGE'", name="status_change_has_statuses"),
        Index("ix_case_events_file_time", "medical_file_id", "created_at"),
        # append-only high-volume table → BRIN for sequential-time retention scans
        Index("brin_case_events_created_at", "created_at", postgresql_using="brin"),
        {"schema": "clinical_review", "comment": "Patient-visible case timeline. APPEND-ONLY (mutation-guard trigger)."},
    )

    medical_file_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("clinical_review.medical_files.id", ondelete="CASCADE"), nullable=False)
    actor_user_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → identity.users.id (NULL=SYSTEM)")
    action: Mapped[str] = mapped_column(String(40), nullable=False, comment="STATUS_CHANGE | COMMENT | IMAGE_ADDED | AI_RUN | NOTE | PRESCRIPTION_VERSION")
    from_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    to_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    reason: Mapped[str | None] = mapped_column(String(200), nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)


# ── diagnoses ────────────────────────────────────────────────────────────

class Diagnosis(IdMixin, CreatedOnlyMixin, Base):
    __tablename__ = "diagnoses"
    __table_args__ = (
        CheckConstraint(f"ai_agreement {S.in_check(S.AI_AGREEMENTS)} OR ai_agreement IS NULL", name="ai_agreement_domain"),
        CheckConstraint("confidence IS NULL OR (confidence >= 0 AND confidence <= 1)", name="confidence_range"),
        Index("ix_diagnoses_file_time", "medical_file_id", "created_at"),
        Index("ix_diagnoses_disease", "disease_id"),
        {"schema": "clinical_review", "comment": "Expert diagnoses (AI-assisted, always human-authored — spec §3)."},
    )

    medical_file_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("clinical_review.medical_files.id", ondelete="CASCADE"), nullable=False)
    disease_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("clinical_review.diseases.id", ondelete="RESTRICT"), nullable=True)
    expert_user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="soft-ref → identity.users.id")
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_ai_assisted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))
    ai_agreement: Mapped[str | None] = mapped_column(String(10), nullable=True, comment="expert vs AI: AGREED | MODIFIED | REJECTED")
    ai_analysis_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → ai.ai_analyses.id")
    confidence: Mapped[float | None] = mapped_column(Numeric(4, 3), nullable=True)
    diagnosed_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


# ── expert_reviews (spec §47 ExpertReview — first & second expert gates) ─

class ExpertReview(IdMixin, CreatedOnlyMixin, Base):
    __tablename__ = "expert_reviews"
    __table_args__ = (
        CheckConstraint(f"stage {S.in_check(S.EXPERT_REVIEW_STAGES)}", name="stage_domain"),
        CheckConstraint(f"ai_agreement {S.in_check(S.AI_AGREEMENTS)} OR ai_agreement IS NULL", name="ai_agreement_domain"),
        CheckConstraint(f"availability {S.in_check(S.DRUG_AVAILABILITIES)} OR availability IS NULL", name="availability_domain"),
        CheckConstraint(f"decision {S.in_check(S.EXPERT_DECISIONS)} OR decision IS NULL", name="decision_domain"),
        CheckConstraint("estimated_total IS NULL OR estimated_total >= 0", name="estimated_total_nonnegative"),
        # availability is only meaningful for stage EXPERT_2 (ED-06)
        CheckConstraint("availability IS NULL OR stage = 'EXPERT_2'", name="availability_only_expert2"),
        CheckConstraint("(stage <> 'EXPERT_2') OR (prescription_id IS NOT NULL OR decision IS NOT NULL)",
                        name="expert2_has_target"),
        Index("ix_expert_reviews_file_stage_time", "medical_file_id", "stage", "created_at"),
        Index("ix_expert_reviews_reviewer", "reviewer_user_id", "created_at"),
        {"schema": "clinical_review", "comment": "Review records for both expert gates: EXPERT_1 assessment / EXPERT_2 availability+pricing (spec §28-§31)."},
    )

    medical_file_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("clinical_review.medical_files.id", ondelete="CASCADE"), nullable=False)
    stage: Mapped[str] = mapped_column(String(10), nullable=False, comment="EXPERT_1 | EXPERT_2")
    reviewer_user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="soft-ref → identity.users.id")
    ai_analysis_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → ai.ai_analyses.id under review")
    ai_agreement: Mapped[str | None] = mapped_column(String(10), nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    availability: Mapped[str | None] = mapped_column(String(12), nullable=True, comment="drug availability (ED-06): FULL | PARTIAL | UNAVAILABLE")
    pricing_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    estimated_total: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="Toman")
    prescription_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → prescriptions.prescriptions.id reviewed")
    decision: Mapped[str | None] = mapped_column(String(14), nullable=True)


# ── doctor_reviews (spec §47 DoctorReview — final medical gate) ──────────

class DoctorReview(IdMixin, CreatedOnlyMixin, Base):
    __tablename__ = "doctor_reviews"
    __table_args__ = (
        CheckConstraint(f"decision {S.in_check(S.DOCTOR_DECISIONS)}", name="decision_domain"),
        CheckConstraint("follow_up_days IS NULL OR (follow_up_days >= 1 AND follow_up_days <= 365)", name="followup_days_range"),
        Index("ix_doctor_reviews_file", "medical_file_id"),
        Index("ix_doctor_reviews_doctor_time", "doctor_user_id", "decided_at"),
        {"schema": "clinical_review", "comment": "Doctor gate records (approve/reject/revision + follow-up plan). Every case must pass (ED-03)."},
    )

    medical_file_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("clinical_review.medical_files.id", ondelete="CASCADE"), nullable=False)
    doctor_user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="soft-ref → identity.users.id")
    decision: Mapped[str] = mapped_column(String(18), nullable=False)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    prescription_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → prescriptions.prescriptions.id (approved version)")
    ai_analysis_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → ai.ai_analyses.id")
    follow_up_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    decided_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


# ── follow_ups (spec §37/§82) ────────────────────────────────────────────

class FollowUp(IdMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "follow_ups"
    __table_args__ = (
        CheckConstraint(f"status {S.in_check(S.FOLLOWUP_STATUSES)}", name="status_domain"),
        CheckConstraint(f"outcome {S.in_check(S.TREATMENT_OUTCOMES)} OR outcome IS NULL", name="outcome_domain"),
        CheckConstraint("status <> 'COMPLETED' OR completed_at IS NOT NULL", name="completed_has_timestamp"),
        Index("ix_follow_ups_due_scan", "status", "due_date"),
        Index("ix_follow_ups_file", "medical_file_id"),
        Index("ix_follow_ups_patient", "patient_user_id"),
        {"schema": "clinical_review", "comment": "Treatment follow-ups. Due/overdue scan + outcome feeding the AI dataset (§82)."},
    )

    medical_file_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("clinical_review.medical_files.id", ondelete="CASCADE"), nullable=False)
    patient_user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="soft-ref → identity.users.id")
    due_date: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="PENDING", server_default="PENDING")
    note: Mapped[str | None] = mapped_column(Text, nullable=True, comment="plan note (created by doctor/expert)")
    result_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    outcome: Mapped[str | None] = mapped_column(String(12), nullable=True, comment="IMPROVED | NO_CHANGE | WORSENED | UNKNOWN (§82)")
    completed_by_user_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → identity.users.id")
    completed_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)
