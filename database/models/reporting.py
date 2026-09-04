"""Reporting context — CQRS-lite read models (ARCHITECTURE.md §8.3).

These tables are PROJECTIONS filled by a worker from domain events; never written
by OLTP request handlers. Source tables stay untouched (no cross-context writes).
"""
from __future__ import annotations

from sqlalchemy import text, BigInteger, CheckConstraint, Date, Index, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, IdMixin, TimestampMixin


class DailyRevenue(IdMixin, TimestampMixin, Base):
    __tablename__ = "daily_revenue"
    __table_args__ = (
        CheckConstraint("orders_count >= 0 AND refunds_count >= 0", name="counts_nonnegative"),
        CheckConstraint("gross_revenue >= 0 AND refunds_total >= 0 AND net_revenue >= 0", name="amounts_nonnegative"),
        CheckConstraint("net_revenue = gross_revenue - refunds_total", name="net_math"),
        UniqueConstraint("stat_date", "product_id", name="uq_daily_revenue_date_product"),
        Index("ix_daily_revenue_date", "stat_date"),
        {"schema": "reporting", "comment": "Projection: revenue by day × product. Owned by reporting context (read model)."},
    )

    stat_date: Mapped[object] = mapped_column(Date, nullable=False, comment="Jalali-aware reporting day (Gregorian DATE)")
    product_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → products.products.id (NULL = rollup row)")
    orders_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    gross_revenue: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default=text("0"), comment="Toman")
    refunds_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    refunds_total: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default=text("0"), comment="Toman")
    net_revenue: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default=text("0"), comment="Toman")
