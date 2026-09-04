"""Commerce context — carts, orders, order items, invoices (proforma).

Real FKs: cart_items → carts, order_items → orders, invoices → orders, carts.converted_order_id → orders.
Soft refs: user_id → identity.users, product_id → products, prescription_id → prescriptions,
medical_file_id → clinical_review, address_id → patients.addresses.
Money math is enforced by CHECK constraints (total = subtotal − discount + shipping).
"""
from __future__ import annotations

from sqlalchemy import text, BigInteger, Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, CreatedOnlyMixin, IdMixin, SoftDeleteMixin, TimestampMixin
from . import statuses as S

ORDER_MATH_CHECK = "total = subtotal - discount + shipping_cost"
LINE_MATH_CHECK = "line_total = unit_price * quantity"


class Cart(IdMixin, TimestampMixin, Base):
    __tablename__ = "carts"
    __table_args__ = (
        CheckConstraint(f"status {S.in_check(S.CART_STATUSES)}", name="status_domain"),
        # one ACTIVE cart per user
        Index("uq_carts_active_per_user", "user_id", unique=True, postgresql_where="status = 'ACTIVE'"),
        Index("ix_carts_user", "user_id"),
        {"schema": "commerce", "comment": "Shopping carts — one active per user, converted into an order at checkout."},
    )

    user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="soft-ref → identity.users.id")
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="ACTIVE", server_default="ACTIVE")
    converted_order_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("commerce.orders.id", ondelete="SET NULL"), nullable=True,
        comment="resulting order at conversion")


class CartItem(IdMixin, TimestampMixin, Base):
    __tablename__ = "cart_items"
    __table_args__ = (
        CheckConstraint("quantity >= 1", name="quantity_at_least_one"),
        CheckConstraint("unit_price_snapshot >= 0", name="unit_price_nonnegative"),
        UniqueConstraint("cart_id", "product_id", name="uq_cart_items_cart_product"),
        Index("ix_cart_items_product", "product_id"),
        {"schema": "commerce", "comment": "Cart lines with price snapshot (price at add-to-cart time)."},
    )

    cart_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("commerce.carts.id", ondelete="CASCADE"), nullable=False)
    product_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="soft-ref → products.products.id")
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default=text("1"))
    unit_price_snapshot: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="Toman at add time")


class Order(IdMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "orders"
    __table_args__ = (
        CheckConstraint("code ~ '^ORD-[0-9]{6,10}$'", name="code_format"),
        CheckConstraint(f"status {S.in_check(S.ORDER_STATUSES)}", name="status_domain"),
        CheckConstraint(f"order_type {S.in_check(S.ORDER_TYPES)}", name="order_type_domain"),
        CheckConstraint("subtotal >= 0 AND discount >= 0 AND shipping_cost >= 0 AND total >= 0", name="amounts_nonnegative"),
        CheckConstraint("discount <= subtotal", name="discount_within_subtotal"),
        # invariant money math — DB-enforced (spec §79 race-safety)
        CheckConstraint(ORDER_MATH_CHECK, name="total_math"),
        CheckConstraint("(status <> 'CANCELLED') OR (cancelled_reason IS NOT NULL)", name="cancel_has_reason"),
        CheckConstraint("order_type <> 'PRESCRIPTION' OR prescription_id IS NOT NULL", name="rx_order_has_prescription"),
        UniqueConstraint("code", name="uq_orders_code"),
        Index("ix_orders_user_time", "user_id", "created_at"),
        Index("ix_orders_status_time", "status", "created_at"),
        Index("ix_orders_prescription", "prescription_id", postgresql_where="prescription_id IS NOT NULL"),
        {"schema": "commerce", "comment": "Orders (shop + prescription). Money math DB-enforced; address snapshotted (never re-read)."},
    )

    code: Mapped[str] = mapped_column(String(20), nullable=False, comment="ORD-14050001")
    user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="soft-ref → identity.users.id")
    order_type: Mapped[str] = mapped_column(String(12), nullable=False, default="SHOP", server_default="SHOP")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="CART", server_default="CART")
    prescription_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → prescriptions.prescriptions.id")
    subtotal: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default=text("0"), comment="Toman")
    discount: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default=text("0"), comment="Toman")
    shipping_cost: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default=text("0"), comment="Toman")
    total: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default=text("0"), comment="Toman = subtotal − discount + shipping")
    address_snapshot: Mapped[dict | None] = mapped_column(JSONB, nullable=True, comment="frozen delivery address at checkout")
    address_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → patients.addresses.id (snapshot source)")
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    verified_by_user_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → identity.users.id (operator)")
    verified_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    cancelled_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)


class OrderItem(IdMixin, CreatedOnlyMixin, Base):
    __tablename__ = "order_items"
    __table_args__ = (
        CheckConstraint("quantity >= 1", name="quantity_at_least_one"),
        CheckConstraint("unit_price >= 0", name="unit_price_nonnegative"),
        CheckConstraint("line_total >= 0", name="line_total_nonnegative"),
        # line math invariant — DB-enforced
        CheckConstraint(LINE_MATH_CHECK, name="line_math"),
        Index("ix_order_items_order", "order_id"),
        Index("ix_order_items_product", "product_id", postgresql_where="product_id IS NOT NULL"),
        {"schema": "commerce", "comment": "Order lines with product snapshot (name/sku frozen at purchase)."},
    )

    order_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("commerce.orders.id", ondelete="CASCADE"), nullable=False)
    product_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → products.products.id")
    name_fa: Mapped[str] = mapped_column(String(200), nullable=False, comment="snapshot")
    name_en: Mapped[str] = mapped_column(String(200), nullable=False, comment="snapshot")
    sku_snapshot: Mapped[str | None] = mapped_column(String(30), nullable=True)
    unit_price: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="Toman snapshot")
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    line_total: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="unit_price × quantity")
    is_available: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))


class Invoice(IdMixin, TimestampMixin, Base):
    """پیش‌فاکتور (proforma) — billing document. No soft delete: financial record,
    cancellable via status only (ED-49)."""
    __tablename__ = "invoices"
    __table_args__ = (
        CheckConstraint("code ~ '^INV-[0-9]{6,10}$'", name="code_format"),
        CheckConstraint(f"status {S.in_check(S.INVOICE_STATUSES)}", name="status_domain"),
        CheckConstraint("subtotal >= 0 AND discount >= 0 AND shipping_cost >= 0 AND total >= 0", name="amounts_nonnegative"),
        CheckConstraint("discount <= subtotal", name="discount_within_subtotal"),
        CheckConstraint(ORDER_MATH_CHECK, name="total_math"),
        CheckConstraint("status <> 'CONFIRMED' OR confirmed_at IS NOT NULL", name="confirmed_has_timestamp"),
        CheckConstraint("status <> 'PAID' OR paid_at IS NOT NULL", name="paid_has_timestamp"),
        CheckConstraint("status <> 'CANCELLED' OR cancelled_at IS NOT NULL", name="cancelled_has_timestamp"),
        UniqueConstraint("code", name="uq_invoices_code"),
        Index("ix_invoices_order", "order_id"),
        Index("ix_invoices_status_time", "status", "created_at"),
        Index("ix_invoices_medical_file", "medical_file_id", postgresql_where="medical_file_id IS NOT NULL"),
        {"schema": "commerce", "comment": "Proforma invoices — items snapshot JSONB, immutable money math, lifecycle via status."},
    )

    code: Mapped[str] = mapped_column(String(20), nullable=False, comment="INV-14050001")
    order_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("commerce.orders.id", ondelete="RESTRICT"), nullable=False)
    medical_file_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → clinical_review.medical_files.id")
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="DRAFT", server_default="DRAFT")
    items_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False, comment="frozen proforma line items")
    subtotal: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="Toman")
    discount: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default=text("0"))
    shipping_cost: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default=text("0"))
    total: Mapped[int] = mapped_column(BigInteger, nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    issued_by_user_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → identity.users.id (operator/expert2)")
    expires_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True, comment="proforma validity window")
    confirmed_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)
    paid_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)
