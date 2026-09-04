"""Identity context (T0) — users, sessions, RBAC.

Tables: users, refresh_tokens, roles, permissions, role_permissions
Cross-context soft-refs emitted FROM here: none (identity is the root).
All FKs in this file are intra-schema (real constraints).
"""
from __future__ import annotations

from sqlalchemy import text, BigInteger, Boolean, CheckConstraint, Date, DateTime, ForeignKey, Identity, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, CreatedOnlyMixin, IdMixin, SoftDeleteMixin, TimestampMixin
from . import statuses as S

# ── roles ────────────────────────────────────────────────────────────────

class Role(IdMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "roles"
    __table_args__ = (
        CheckConstraint(f"code {S.in_check(S.ROLES)}", name="role_code_domain"),
        Index("ix_roles_code_active", "code", unique=True,
              postgresql_where="deleted_at IS NULL"),
        {"schema": "identity", "comment": "RBAC roles (6 system roles)"},
    )

    code: Mapped[str] = mapped_column(String(30), nullable=False, comment="ADMIN | EXPERT_1 | EXPERT_2 | OPERATOR | DOCTOR | PATIENT")
    name_fa: Mapped[str] = mapped_column(String(100), nullable=False)
    name_en: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"), comment="system roles cannot be deleted")


class Permission(IdMixin, CreatedOnlyMixin, Base):
    __tablename__ = "permissions"
    __table_args__ = ({"schema": "identity", "comment": "RBAC permission catalogue (31 permissions)"},)

    code: Mapped[str] = mapped_column(String(60), nullable=False, unique=True, comment="e.g. view_medical_files, approve_prescription")
    name_fa: Mapped[str] = mapped_column(String(100), nullable=False)
    name_en: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)


class RolePermission(Base):
    __tablename__ = "role_permissions"
    __table_args__ = ({"schema": "identity", "comment": "role ↔ permission grant matrix"},)

    role_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("identity.roles.id", ondelete="CASCADE"), primary_key=True)
    permission_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("identity.permissions.id", ondelete="CASCADE"), primary_key=True)
    granted_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


# ── users ────────────────────────────────────────────────────────────────

class User(IdMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(S.PHONE_CHECK, name="phone_format"),
        CheckConstraint("failed_logins >= 0", name="failed_logins_nonnegative"),
        CheckConstraint(f"gender {S.in_check(S.GENDERS)} OR gender IS NULL", name="gender_domain"),
        CheckConstraint(f"locale {S.in_check(S.LOCALES)}", name="locale_domain"),
        # Partial uniques: phone/email freed only after soft delete (privacy reuse)
        Index("uq_users_phone_active", "phone", unique=True,
              postgresql_where="deleted_at IS NULL"),
        Index("uq_users_email_active", "email", unique=True,
              postgresql_where="deleted_at IS NULL AND email IS NOT NULL"),
        Index("ix_users_role", "role_id"),
        {"schema": "identity", "comment": "All platform accounts (6 roles). Soft-deleted accounts release phone/email."},
    )

    phone: Mapped[str] = mapped_column(String(20), nullable=False, comment="Iranian mobile, unique among active users")
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    password_hash: Mapped[str] = mapped_column(String(512), nullable=False, comment="scrypt hash — never plaintext")
    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    last_name: Mapped[str] = mapped_column(String(100), nullable=False)
    role_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("identity.roles.id", ondelete="RESTRICT"), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"), comment="account enabled/disabled (spec §48)")
    referral_code: Mapped[str] = mapped_column(String(24), nullable=False, unique=True, comment="global-unique, never freed")
    national_id_hash: Mapped[str | None] = mapped_column(String(128), nullable=True, comment="hashed national id — privacy policy")
    gender: Mapped[str | None] = mapped_column(String(10), nullable=True)
    birth_date: Mapped[object | None] = mapped_column(Date, nullable=True)
    profile_complete: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    locale: Mapped[str] = mapped_column(String(5), nullable=False, default="fa", server_default="fa")
    last_login_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)
    failed_logins: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"), comment="brute-force counter")
    locked_until: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True, comment="brute-force lock expiry")
    # attributes (JSONB) reserved for future extension without schema churn
    extra: Mapped[dict | None] = mapped_column(JSONB, nullable=True, comment="reserved extension attributes")


class RefreshToken(IdMixin, CreatedOnlyMixin, Base):
    __tablename__ = "refresh_tokens"
    __table_args__ = (
        CheckConstraint("expires_at > created_at", name="expiry_after_creation"),
        Index("ix_refresh_tokens_user", "user_id"),
        Index("ix_refresh_tokens_expires", "expires_at", postgresql_where="revoked = false"),
        {"schema": "identity", "comment": "Rotating refresh tokens (30d). Revocation chain preserved for audit."},
    )

    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("identity.users.id", ondelete="CASCADE"), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(512), nullable=False, unique=True)
    expires_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    revoked_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)
    replaced_by_token_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("identity.refresh_tokens.id", ondelete="SET NULL"),
        nullable=True, comment="rotation chain (detect token replay)")
