"""Tickets context — support tickets + messages.

Real FKs: ticket_messages → tickets.
Soft refs: user/assigned ids → identity.users, medical_file_id → clinical_review,
attachment image → medical_records.
SLA metrics: first_response_at / resolved_at / closed_at.
"""
from __future__ import annotations

from sqlalchemy import text, BigInteger, Boolean, CheckConstraint, DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, CreatedOnlyMixin, IdMixin, SoftDeleteMixin, TimestampMixin
from . import statuses as S


class Ticket(IdMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "tickets"
    __table_args__ = (
        CheckConstraint("code ~ '^TKT-[0-9]{6,10}$'", name="code_format"),
        CheckConstraint(f"status {S.in_check(S.TICKET_STATUSES)}", name="status_domain"),
        CheckConstraint(f"category {S.in_check(S.TICKET_CATEGORIES)}", name="category_domain"),
        CheckConstraint(f"priority {S.in_check(S.TICKET_PRIORITIES)}", name="priority_domain"),
        CheckConstraint("(status NOT IN ('RESOLVED', 'CLOSED')) OR resolved_at IS NOT NULL", name="resolution_tracked"),
        CheckConstraint("status <> 'CLOSED' OR closed_at IS NOT NULL", name="closed_has_timestamp"),
        UniqueConstraint("code", name="uq_tickets_code"),
        # staff queue scan (live tickets by recency)
        Index("ix_tickets_status_updated", "status", "updated_at", postgresql_where="deleted_at IS NULL"),
        Index("ix_tickets_user_updated", "user_id", "updated_at"),
        Index("ix_tickets_assignee", "assigned_to_user_id", postgresql_where="assigned_to_user_id IS NOT NULL AND deleted_at IS NULL"),
        Index("ix_tickets_category", "category"),
        {"schema": "tickets", "comment": "Support tickets (6 statuses × 6 categories) with SLA timestamps."},
    )

    code: Mapped[str] = mapped_column(String(20), nullable=False, comment="TKT-14050001")
    user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="soft-ref → identity.users.id (author)")
    medical_file_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → clinical_review.medical_files.id (case-linked)")
    subject: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str] = mapped_column(String(12), nullable=False, default="GENERAL", server_default="GENERAL")
    priority: Mapped[str] = mapped_column(String(8), nullable=False, default="NORMAL", server_default="NORMAL")
    status: Mapped[str] = mapped_column(String(14), nullable=False, default="OPEN", server_default="OPEN")
    assigned_to_user_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → identity.users.id (operator)")
    first_response_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True, comment="SLA metric")
    resolved_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)


class TicketMessage(IdMixin, CreatedOnlyMixin, Base):
    """APPEND-ONLY (trigger-guarded) — chat semantics; edits are new messages."""
    __tablename__ = "ticket_messages"
    __table_args__ = (
        Index("ix_ticket_messages_ticket_time", "ticket_id", "created_at"),
        # patient-visible conversation hides internal notes (app-level filter)
        Index("ix_ticket_messages_internal", "ticket_id", postgresql_where="is_internal"),
        {"schema": "tickets", "comment": "Ticket conversation. is_internal=true → staff-only notes."},
    )

    ticket_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("tickets.tickets.id", ondelete="CASCADE"), nullable=False)
    sender_user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="soft-ref → identity.users.id")
    message: Mapped[str] = mapped_column(Text, nullable=False)
    is_internal: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"), comment="staff-only internal note")
    attachment_image_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → medical_records.images.id")
