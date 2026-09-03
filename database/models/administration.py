"""Administration context — cross-context audit event stream (ED-32).

audit_logs: APPEND-ONLY (trigger-guarded). UPDATE and DELETE are physically impossible.
Action naming: WORKFLOW_<ENTITY>_<ACTION> for machine transitions; LOGIN/VIEW_MEDICAL_FILE
/EDIT_PRESCRIPTION/... for domain events. Polymorphic target (entity, entity_id).
"""
from __future__ import annotations

from sqlalchemy import text, BigInteger, Boolean, CheckConstraint, Index, String
from sqlalchemy.dialects.postgresql import INET, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, CreatedOnlyMixin, IdMixin


class AuditLog(IdMixin, CreatedOnlyMixin, Base):
    __tablename__ = "audit_logs"
    __table_args__ = (
        CheckConstraint("action ~ '^[A-Z][A-Z0-9_]{2,59}$'", name="action_format"),
        CheckConstraint("new_values IS NOT NULL OR old_values IS NOT NULL OR action NOT LIKE 'WORKFLOW_%'",
                        name="workflow_events_carry_diff"),
        Index("ix_audit_logs_actor_time", "actor_user_id", "created_at"),
        Index("ix_audit_logs_entity", "entity", "entity_id", "created_at"),
        # sensitive-access investigations (VIEW_MEDICAL_FILE, ...)
        Index("ix_audit_logs_sensitive", "created_at", postgresql_where="is_sensitive"),
        # append-only stream grows monotonically → BRIN (tiny, fast range scans)
        Index("brin_audit_logs_created_at", "created_at", postgresql_using="brin"),
        {"schema": "administration", "comment": "Append-only audit stream. Hard-delete/update blocked by trigger (ED-32)."},
    )

    actor_user_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → identity.users.id (NULL=SYSTEM)")
    action: Mapped[str] = mapped_column(String(60), nullable=False, comment="WORKFLOW_CASE_* | LOGIN | VIEW_MEDICAL_FILE | ...")
    entity: Mapped[str] = mapped_column(String(40), nullable=False, comment="target entity name, e.g. medical_files")
    entity_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="target row id (polymorphic)")
    context: Mapped[str | None] = mapped_column(String(20), nullable=True, comment="owning bounded-context schema of entity")
    old_values: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    new_values: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(INET, nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(300), nullable=True)
    is_sensitive: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"),
        comment="true for medical-file views, prescriptions, payments (extra retention)")
