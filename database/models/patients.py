"""Patients context — profiles, addresses, contact logs, questionnaire (versioned), referrals.

Soft references (no FK, D4): user_id → identity.users, related ids → other contexts.
Real FKs (intra-schema): questions → questionnaires, question_options → questions,
answers → questionnaire_responses/questions/question_options, referrals (none internal).
"""
from __future__ import annotations

from sqlalchemy import text, BigInteger, Boolean, CheckConstraint, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, CreatedOnlyMixin, IdMixin, SoftDeleteMixin, TimestampMixin
from . import statuses as S

# ── patient_profiles ─────────────────────────────────────────────────────

class PatientProfile(IdMixin, TimestampMixin, Base):
    __tablename__ = "patient_profiles"
    __table_args__ = (
        CheckConstraint("height_cm IS NULL OR (height_cm >= 30 AND height_cm <= 250)", name="height_range"),
        CheckConstraint("weight_kg IS NULL OR (weight_kg >= 1 AND weight_kg <= 400)", name="weight_range"),
        CheckConstraint(f"pregnancy {S.in_check(('NA', 'YES', 'NO'))} OR pregnancy IS NULL", name="pregnancy_domain"),
        CheckConstraint(f"mizaj_current {S.in_check(S.MIZAJ_RESULTS)} OR mizaj_current IS NULL", name="mizaj_domain"),
        CheckConstraint("emergency_phone IS NULL OR emergency_phone ~ '^\\+?[0-9]{10,15}$'", name="emergency_phone_format"),
        Index("uq_patient_profiles_user", "user_id", unique=True),
        {"schema": "patients", "comment": "1:1 health profile. Lifecycle follows identity.users (no own soft-delete)."},
    )

    user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="soft-ref → identity.users.id")
    height_cm: Mapped[float | None] = mapped_column(Numeric(5, 1), nullable=True)
    weight_kg: Mapped[float | None] = mapped_column(Numeric(5, 1), nullable=True)
    blood_group: Mapped[str | None] = mapped_column(String(3), nullable=True,
        comment="A+ A- B+ B- AB+ AB- O+ O-")
    allergies: Mapped[str | None] = mapped_column(Text, nullable=True)
    past_illnesses: Mapped[str | None] = mapped_column(Text, nullable=True)
    current_meds: Mapped[str | None] = mapped_column(Text, nullable=True)
    pregnancy: Mapped[str | None] = mapped_column(String(8), nullable=True)
    referred_by_text: Mapped[str | None] = mapped_column(String(255), nullable=True, comment="free-text introducer (معرف)")
    mizaj_current: Mapped[str | None] = mapped_column(String(20), nullable=True,
        comment="denormalized last mizaj result; source of truth = questionnaire_responses")
    emergency_phone: Mapped[str | None] = mapped_column(String(20), nullable=True)


# ── addresses ────────────────────────────────────────────────────────────

class Address(IdMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "addresses"
    __table_args__ = (
        CheckConstraint("receiver_phone IS NULL OR receiver_phone ~ '^\\+?[0-9]{10,15}$'", name="receiver_phone_format"),
        CheckConstraint("postal_code IS NULL OR postal_code ~ '^[0-9]{10}$'", name="postal_code_format"),
        # one active default address per user (partial unique)
        Index("uq_addresses_default_per_user", "user_id", unique=True,
              postgresql_where="is_default AND deleted_at IS NULL"),
        Index("uq_addresses_user_label", "user_id", "label", unique=True,
              postgresql_where="deleted_at IS NULL"),
        Index("ix_addresses_user", "user_id"),
        {"schema": "patients", "comment": "Shipping addresses. Soft-deleted. Snapshotted into orders at checkout."},
    )

    user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="soft-ref → identity.users.id")
    label: Mapped[str] = mapped_column(String(50), nullable=False, comment="خانه / محل کار / ...")
    province: Mapped[str] = mapped_column(String(50), nullable=False)
    city: Mapped[str] = mapped_column(String(50), nullable=False)
    postal_code: Mapped[str | None] = mapped_column(String(10), nullable=True)
    address_line: Mapped[str] = mapped_column(String(500), nullable=False)
    receiver_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    receiver_phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))


# ── contact_logs ─────────────────────────────────────────────────────────

class ContactLog(IdMixin, CreatedOnlyMixin, Base):
    __tablename__ = "contact_logs"
    __table_args__ = (
        CheckConstraint(f"channel {S.in_check(S.CONTACT_CHANNELS)}", name="channel_domain"),
        CheckConstraint(f"direction {S.in_check(S.CONTACT_DIRECTIONS)}", name="direction_domain"),
        CheckConstraint(f"outcome {S.in_check(S.CONTACT_OUTCOMES)} OR outcome IS NULL", name="outcome_domain"),
        Index("ix_contact_logs_user_time", "user_id", "contacted_at"),
        Index("ix_contact_logs_channel", "channel"),
        {"schema": "patients", "comment": "Outreach history (calls/SMS/emails) toward patients — CRM-style log."},
    )

    user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="soft-ref → identity.users.id (patient)")
    actor_user_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → identity.users.id (staff)")
    channel: Mapped[str] = mapped_column(String(20), nullable=False)
    direction: Mapped[str] = mapped_column(String(10), nullable=False)
    subject: Mapped[str | None] = mapped_column(String(200), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    outcome: Mapped[str | None] = mapped_column(String(30), nullable=True)
    related_ticket_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → tickets.tickets.id")
    related_medical_file_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → clinical_review.medical_files.id")
    contacted_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


# ── questionnaire (versioned, spec §7) ───────────────────────────────────

class Questionnaire(IdMixin, CreatedOnlyMixin, SoftDeleteMixin, Base):
    __tablename__ = "questionnaires"
    __table_args__ = (
        CheckConstraint("version >= 1", name="version_positive"),
        # exactly ONE active questionnaire platform-wide (spec §7)
        Index("uq_questionnaires_single_active", "is_active", unique=True,
              postgresql_where="is_active AND deleted_at IS NULL"),
        UniqueConstraint("version", name="uq_questionnaires_version"),
        {"schema": "patients", "comment": "Mizaj questionnaire — immutable published versions. Old versions kept forever."},
    )

    version: Mapped[int] = mapped_column(Integer, nullable=False)
    title_fa: Mapped[str] = mapped_column(String(200), nullable=False)
    title_en: Mapped[str] = mapped_column(String(200), nullable=False)
    description_fa: Mapped[str | None] = mapped_column(Text, nullable=True)
    description_en: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    published_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by_user_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → identity.users.id")


class Question(IdMixin, CreatedOnlyMixin, Base):
    __tablename__ = "questions"
    __table_args__ = (
        CheckConstraint("position >= 1", name="position_positive"),
        UniqueConstraint("questionnaire_id", "position", name="uq_questions_questionnaire_position"),
        Index("ix_questions_questionnaire", "questionnaire_id"),
        {"schema": "patients", "comment": "Questionnaire questions — belong to an immutable version."},
    )

    questionnaire_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("patients.questionnaires.id", ondelete="CASCADE"), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, comment="display order")
    text_fa: Mapped[str] = mapped_column(Text, nullable=False)
    text_en: Mapped[str] = mapped_column(Text, nullable=False)
    help_fa: Mapped[str | None] = mapped_column(Text, nullable=True)
    help_en: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))


class QuestionOption(IdMixin, CreatedOnlyMixin, Base):
    __tablename__ = "question_options"
    __table_args__ = (
        CheckConstraint(f"dimension {S.in_check(S.MIZAJ_DIMENSIONS)}", name="dimension_domain"),
        CheckConstraint("score >= 0", name="score_nonnegative"),
        CheckConstraint("position >= 0", name="position_nonnegative"),
        UniqueConstraint("question_id", "position", name="uq_question_options_position"),
        Index("ix_question_options_question", "question_id"),
        {"schema": "patients", "comment": "Scored options (dimension + score) for mizaj calculation."},
    )

    question_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("patients.questions.id", ondelete="CASCADE"), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    text_fa: Mapped[str] = mapped_column(String(200), nullable=False)
    text_en: Mapped[str] = mapped_column(String(200), nullable=False)
    score: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    dimension: Mapped[str] = mapped_column(String(10), nullable=False)


class QuestionnaireResponse(IdMixin, CreatedOnlyMixin, Base):
    """Submission header. APPEND-ONLY (trigger-guarded): history never deleted (spec §7)."""
    __tablename__ = "questionnaire_responses"
    __table_args__ = (
        CheckConstraint(f"mizaj_result {S.in_check(S.MIZAJ_RESULTS)}", name="mizaj_result_domain"),
        CheckConstraint("score_hot >= 0 AND score_cold >= 0 AND score_wet >= 0 AND score_dry >= 0", name="scores_nonnegative"),
        Index("ix_questionnaire_responses_user_time", "user_id", "submitted_at"),
        Index("ix_questionnaire_responses_questionnaire", "questionnaire_id"),
        {"schema": "patients", "comment": "Mizaj results — immutable history, feeds profile.mizaj_current and datasets."},
    )

    user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="soft-ref → identity.users.id")
    questionnaire_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("patients.questionnaires.id", ondelete="RESTRICT"), nullable=False)
    score_hot: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    score_cold: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    score_wet: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    score_dry: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    mizaj_result: Mapped[str] = mapped_column(String(20), nullable=False)
    mizaj_label_fa: Mapped[str] = mapped_column(String(100), nullable=False)
    mizaj_label_en: Mapped[str] = mapped_column(String(100), nullable=False)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    submitted_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class Answer(IdMixin, CreatedOnlyMixin, Base):
    __tablename__ = "answers"
    __table_args__ = (
        CheckConstraint(f"dimension {S.in_check(S.MIZAJ_DIMENSIONS)}", name="dimension_domain"),
        CheckConstraint("score >= 0", name="score_nonnegative"),
        UniqueConstraint("response_id", "question_id", name="uq_answers_response_question"),
        Index("ix_answers_question", "question_id"),
        Index("ix_answers_option", "option_id"),
        {"schema": "patients", "comment": "Normalized per-question answers (replaces JSON blob)."},
    )

    response_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("patients.questionnaire_responses.id", ondelete="CASCADE"), nullable=False)
    question_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("patients.questions.id", ondelete="RESTRICT"), nullable=False)
    option_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("patients.question_options.id", ondelete="RESTRICT"), nullable=False)
    score: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    dimension: Mapped[str] = mapped_column(String(10), nullable=False)


# ── referrals ────────────────────────────────────────────────────────────

class Referral(IdMixin, TimestampMixin, Base):
    __tablename__ = "referrals"
    __table_args__ = (
        CheckConstraint(f"status {S.in_check(S.REFERRAL_STATUSES)}", name="status_domain"),
        CheckConstraint("orders_count >= 0 AND revenue >= 0 AND commission >= 0", name="counters_nonnegative"),
        CheckConstraint("commission_rate IS NULL OR (commission_rate >= 0 AND commission_rate <= 1)", name="rate_range"),
        CheckConstraint("status <> 'SETTLED' OR settled_at IS NOT NULL", name="settled_has_timestamp"),
        Index("uq_referrals_referred_user", "referred_user_id", unique=True),
        Index("ix_referrals_referrer", "referrer_user_id"),
        {"schema": "patients", "comment": "Referral reward tracking (referred_user unique — one referral per user)."},
    )

    referrer_user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="soft-ref → identity.users.id")
    referred_user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="soft-ref → identity.users.id")
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="PENDING", server_default="PENDING")
    orders_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    revenue: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default=text("0"), comment="attributed revenue (Toman)")
    commission: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default=text("0"), comment="payable commission (Toman)")
    commission_rate: Mapped[float | None] = mapped_column(Numeric(5, 4), nullable=True, comment="rate snapshot at settlement")
    settled_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)
    settlement_ref: Mapped[str | None] = mapped_column(String(60), nullable=True, comment="finance txn reference")
