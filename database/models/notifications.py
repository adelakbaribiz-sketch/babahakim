"""Notifications context — in-app notifications + SMS delivery logs.

Soft refs: user_id → identity.users. Both tables are high-volume:
partial/BRIN indexes tuned for "unread inbox" and retention scans.
link_path is RELATIVE (never embeds absolute URLs — privacy, no data in URLs).
"""
from __future__ import annotations

from sqlalchemy import text, BigInteger, Boolean, CheckConstraint, DateTime, Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, CreatedOnlyMixin, IdMixin
from . import statuses as S


class Notification(IdMixin, CreatedOnlyMixin, Base):
    __tablename__ = "notifications"
    __table_args__ = (
        # unread inbox scan (user, is_read=false, newest first)
        Index("ix_notifications_unread", "user_id", "created_at",
              postgresql_where="is_read = false"),
        Index("ix_notifications_user_time", "user_id", "created_at"),
        {"schema": "notifications", "comment": "In-app notifications (31 event templates, bilingual)."},
    )

    user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="soft-ref → identity.users.id")
    event_code: Mapped[str] = mapped_column(String(60), nullable=False, comment="e.g. CASE_PAYMENT_CONFIRMED")
    title_fa: Mapped[str] = mapped_column(String(200), nullable=False)
    title_en: Mapped[str] = mapped_column(String(200), nullable=False)
    body_fa: Mapped[str | None] = mapped_column(Text, nullable=True)
    body_en: Mapped[str | None] = mapped_column(Text, nullable=True)
    link_path: Mapped[str | None] = mapped_column(String(300), nullable=True, comment="relative route — never absolute URL")
    payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True, comment="event context (no PHI beyond necessity)")
    is_read: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    read_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SMSLog(IdMixin, CreatedOnlyMixin, Base):
    """APPEND-ONLY (trigger-guarded) delivery log."""
    __tablename__ = "sms_logs"
    __table_args__ = (
        CheckConstraint("recipient ~ '^\\+?[0-9]{10,15}$'", name="recipient_format"),
        CheckConstraint(f"status {S.in_check(S.SMS_STATUSES)}", name="status_domain"),
        CheckConstraint(f"provider {S.in_check(S.SMS_PROVIDERS)}", name="provider_domain"),
        Index("ix_sms_logs_user_time", "user_id", "created_at"),
        Index("ix_sms_logs_status", "status", postgresql_where="status IN ('QUEUED', 'SENT')"),
        Index("ix_sms_logs_recipient", "recipient"),
        Index("brin_sms_logs_created_at", "created_at", postgresql_using="brin"),
        {"schema": "notifications", "comment": "SMS delivery audit (Kavenegar). Append-only, retention per policy."},
    )

    user_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → identity.users.id")
    recipient: Mapped[str] = mapped_column(String(20), nullable=False)
    template_code: Mapped[str] = mapped_column(String(60), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False, comment="rendered message — treated as sensitive")
    provider: Mapped[str] = mapped_column(String(20), nullable=False, default="KAVENEGAR", server_default="KAVENEGAR")
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="QUEUED", server_default="QUEUED")
    provider_message_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    delivery_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    sent_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)
    delivered_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)
