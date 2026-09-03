"""Products context — catalog, immutable price history, inventory + movements ledger.

Real FKs: price_history/inventories/inventory_movements → products, disease_products → products.
Soft refs: disease_id → clinical_review.diseases (D4), order/shipment/file ids, user ids.
"""
from __future__ import annotations

from sqlalchemy import text, BigInteger, Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, CreatedOnlyMixin, IdMixin, SoftDeleteMixin, TimestampMixin
from . import statuses as S


class Product(IdMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "products"
    __table_args__ = (
        CheckConstraint("sku ~ '^[A-Z0-9-]{3,30}$'", name="sku_format"),
        CheckConstraint("current_price >= 0", name="current_price_nonnegative"),
        CheckConstraint("purchase_price >= 0", name="purchase_price_nonnegative"),
        # OTC vs prescription-only are mutually exclusive (spec §64/§66)
        CheckConstraint("NOT (is_otc AND requires_prescription)", name="otc_excludes_prescription"),
        UniqueConstraint("sku", name="uq_products_sku"),
        # Persian/English fuzzy search (pg_trgm GIN) — normalized text is indexed app-side
        Index("ix_products_name_fa_trgm", "name_fa", postgresql_using="gin",
              postgresql_ops={"name_fa": "gin_trgm_ops"}),
        Index("ix_products_name_en_trgm", "name_en", postgresql_using="gin",
              postgresql_ops={"name_en": "gin_trgm_ops"}),
        Index("ix_products_category", "category", postgresql_where="deleted_at IS NULL"),
        Index("ix_products_otc", "is_otc", postgresql_where="deleted_at IS NULL AND is_active"),
        {"schema": "products", "comment": "Drug/product catalog. current_price is denormalized from append-only price history."},
    )

    sku: Mapped[str] = mapped_column(String(30), nullable=False)
    name_fa: Mapped[str] = mapped_column(String(200), nullable=False)
    name_en: Mapped[str] = mapped_column(String(200), nullable=False)
    brand: Mapped[str | None] = mapped_column(String(100), nullable=True)
    category: Mapped[str | None] = mapped_column(String(50), nullable=True)
    description_fa: Mapped[str | None] = mapped_column(Text, nullable=True)
    description_en: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_storage_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_otc: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"), comment="sellable without prescription (spec §66)")
    requires_prescription: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    usage_fa: Mapped[str | None] = mapped_column(Text, nullable=True, comment="نحوه مصرف")
    restrictions: Mapped[str | None] = mapped_column(Text, nullable=True)
    current_price: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default=text("0"), comment="sales price (Toman) — mirrors latest price history row")
    purchase_price: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default=text("0"), comment="purchase price (Toman)")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))


class ProductPriceHistory(IdMixin, CreatedOnlyMixin, Base):
    """APPEND-ONLY (trigger-guarded). Spec §15: هیچ قیمت قدیمی از بین نرود."""
    __tablename__ = "product_price_history"
    __table_args__ = (
        CheckConstraint("new_price >= 0", name="new_price_nonnegative"),
        CheckConstraint("old_price IS NULL OR old_price >= 0", name="old_price_nonnegative"),
        CheckConstraint(f"reason {S.in_check(S.PRICE_CHANGE_REASONS)} OR reason IS NULL", name="reason_domain"),
        Index("ix_product_price_history_product_time", "product_id", "created_at"),
        {"schema": "products", "comment": "Immutable price ledger (manual/bulk/import changes with source row evidence)."},
    )

    product_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("products.products.id", ondelete="RESTRICT"), nullable=False,
        comment="RESTRICT — price rows must survive their product")
    old_price: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    new_price: Mapped[int] = mapped_column(BigInteger, nullable=False)
    changed_by_user_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → identity.users.id")
    reason: Mapped[str | None] = mapped_column(String(20), nullable=True)
    source_row: Mapped[dict | None] = mapped_column(JSONB, nullable=True, comment="Excel/CSV source row evidence")


class Inventory(IdMixin, TimestampMixin, Base):
    __tablename__ = "inventories"
    __table_args__ = (
        CheckConstraint("quantity_on_hand >= 0", name="on_hand_nonnegative"),
        CheckConstraint("quantity_reserved >= 0", name="reserved_nonnegative"),
        CheckConstraint("reorder_level >= 0", name="reorder_nonnegative"),
        CheckConstraint("quantity_reserved <= quantity_on_hand", name="reserved_within_on_hand"),
        UniqueConstraint("product_id", name="uq_inventories_product"),
        # low-stock report scans only deficient products
        Index("ix_inventories_low_stock", "product_id",
              postgresql_where="quantity_on_hand <= reorder_level"),
        {"schema": "products", "comment": "Current stock per product (1:1). Movements ledger is the source of truth."},
    )

    product_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("products.products.id", ondelete="RESTRICT"), nullable=False)
    quantity_on_hand: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    quantity_reserved: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"), comment="reserved by open orders")
    reorder_level: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    last_counted_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True, comment="physical count")


class InventoryMovement(IdMixin, CreatedOnlyMixin, Base):
    """APPEND-ONLY ledger (trigger-guarded). Signed quantities with running balance."""
    __tablename__ = "inventory_movements"
    __table_args__ = (
        # direction discipline per movement type (root-cause integrity)
        CheckConstraint(
            "CASE WHEN movement_type IN ('STOCK_IN', 'RESERVE', 'RETURN') THEN quantity > 0 "
            "WHEN movement_type IN ('STOCK_OUT', 'RELEASE', 'DAMAGE') THEN quantity < 0 "
            "ELSE quantity <> 0 END",
            name="movement_sign"),
        CheckConstraint(f"movement_type {S.in_check(S.INVENTORY_MOVEMENT_TYPES)}", name="movement_type_domain"),
        CheckConstraint("balance_after >= 0", name="balance_nonnegative"),
        Index("ix_inventory_movements_product_time", "product_id", "created_at"),
        Index("ix_inventory_movements_order", "order_id", postgresql_where="order_id IS NOT NULL"),
        {"schema": "products", "comment": "Inventory ledger: every stock change with signed delta + running balance + reference."},
    )

    product_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("products.products.id", ondelete="RESTRICT"), nullable=False)
    movement_type: Mapped[str] = mapped_column(String(12), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, comment="signed delta (+in / −out)")
    balance_after: Mapped[int] = mapped_column(Integer, nullable=False, comment="quantity_on_hand after applying delta")
    order_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → commerce.orders.id")
    shipment_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → shipping.shipments.id")
    medical_file_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → clinical_review.medical_files.id")
    actor_user_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, comment="soft-ref → identity.users.id")
    note: Mapped[str | None] = mapped_column(Text, nullable=True)


class DiseaseProduct(Base):
    """Disease ↔ product association (spec §13: داروهای مرتبط).
    disease_id is a soft-ref (diseases belong to clinical_review context — D4)."""
    __tablename__ = "disease_products"
    __table_args__ = (
        Index("ix_disease_products_product", "product_id"),
        {"schema": "products", "comment": "Suggested products per disease. disease side is a soft reference (D4)."},
    )

    disease_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, comment="soft-ref → clinical_review.diseases.id")
    product_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("products.products.id", ondelete="CASCADE"), primary_key=True)
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"), comment="first-line suggestion")
