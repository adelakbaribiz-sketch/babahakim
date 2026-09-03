"""BabaHakim — canonical status/type value sets (single source for CHECK constraints).

Mirrors src/lib/constants.ts + workflow machines (Phase 02) so the database
enforces the exact same vocabulary as the application state machines.
"""
from __future__ import annotations

# ── Identity ────────────────────────────────────────────────────────────
ROLES = ("ADMIN", "EXPERT_1", "EXPERT_2", "OPERATOR", "DOCTOR", "PATIENT")
GENDERS = ("MALE", "FEMALE", "OTHER")
LOCALES = ("fa", "en")

# ── Contact log ─────────────────────────────────────────────────────────
CONTACT_CHANNELS = ("CALL", "SMS", "EMAIL", "CHAT", "OTHER")
CONTACT_DIRECTIONS = ("INBOUND", "OUTBOUND")
CONTACT_OUTCOMES = ("REACHED", "NO_ANSWER", "CALLBACK_REQUESTED", "FOLLOWED_UP", "OTHER")

# ── Questionnaire (mizaj — Traditional Persian Medicine) ────────────────
MIZAJ_RESULTS = ("HOT_DRY", "HOT_WET", "COLD_DRY", "COLD_WET", "BALANCED")
MIZAJ_DIMENSIONS = ("HOT", "COLD", "WET", "DRY")

# ── Medical images ──────────────────────────────────────────────────────
IMAGE_TYPES = ("TONGUE", "FACE", "RECEIPT", "DELIVERY", "PRODUCT", "OTHER")
IMAGE_STATUSES = ("PENDING", "VALIDATED", "REJECTED", "PROCESSED")
IMAGE_MIMES = ("image/jpeg", "image/png", "image/webp")

# ── Case workflow (21 statuses — CASE_MACHINE, Phase 02) ────────────────
CASE_STATUSES = (
    "NEW", "WAITING_FOR_EXPERT_1", "EXPERT_1_REVIEW", "WAITING_FOR_USER_APPROVAL",
    "WAITING_FOR_EXPERT_1_PRESCRIPTION", "WAITING_FOR_EXPERT_2", "REVISION_REQUESTED",
    "WAITING_FOR_DOCTOR", "PRESCRIPTION_APPROVED", "PREPARING_ORDER", "PROFORMA_CREATED",
    "WAITING_FOR_USER_CONFIRMATION", "WAITING_FOR_PAYMENT", "PAYMENT_CONFIRMED",
    "PREPARING_SHIPMENT", "SHIPPED", "DELIVERED", "FOLLOW_UP", "REFERRED_AGAIN",
    "CLOSED", "CANCELLED",
)
CASE_PRIORITIES = ("LOW", "NORMAL", "HIGH", "URGENT")
TREATMENT_OUTCOMES = ("IMPROVED", "NO_CHANGE", "WORSENED", "UNKNOWN")  # spec §82

# ── AI ──────────────────────────────────────────────────────────────────
AI_MODEL_APPROVAL_STATUSES = ("DRAFT", "IN_TRAINING", "EVALUATION", "APPROVED", "DEPLOYED", "RETIRED")
AI_ANALYSIS_STATUSES = ("QUEUED", "RUNNING", "COMPLETED", "FAILED")
AI_REVIEW_STATUSES = ("PENDING_REVIEW", "ACCEPTED", "MODIFIED", "REJECTED")
DATASET_STATUSES = ("DRAFT", "ACTIVE", "ARCHIVED")
DATASET_VERSION_STATUSES = ("BUILDING", "READY", "TRAINING", "ARCHIVED")
DATASET_SPLIT_STRATEGIES = ("PATIENT_LEVEL", "IMAGE_LEVEL")  # §63 leakage prevention
DATASET_SPLITS = ("TRAIN", "VAL", "TEST")
DATASET_ITEM_REVIEW_STATUSES = ("PENDING", "REVIEWED", "VALIDATED", "LABELLED", "EXCLUDED")  # §83

# ── Clinical review ─────────────────────────────────────────────────────
AI_AGREEMENTS = ("AGREED", "MODIFIED", "REJECTED")
EXPERT_REVIEW_STAGES = ("EXPERT_1", "EXPERT_2")
DRUG_AVAILABILITIES = ("FULL", "PARTIAL", "UNAVAILABLE")  # ED-06
EXPERT_DECISIONS = ("PROCEED", "NEEDS_REVISION", "REJECT")
DOCTOR_DECISIONS = ("APPROVED", "REJECTED", "REVISION_REQUESTED")
FOLLOWUP_STATUSES = ("PENDING", "DUE", "COMPLETED", "OVERDUE", "CANCELLED")

# ── Prescription (machine, Phase 02: 7 states + SUPERSEDED) ─────────────
PRESCRIPTION_STATUSES = (
    "DRAFT", "PENDING_EXPERT_2", "PENDING_DOCTOR", "APPROVED",
    "REJECTED", "REVISION_REQUESTED", "FINALIZED", "SUPERSEDED",
)

# ── Commerce / orders (11 statuses — ORDER_MACHINE) ─────────────────────
ORDER_STATUSES = (
    "CART", "PENDING_CONFIRMATION", "CONFIRMED", "PAYMENT_PENDING", "PAID",
    "PREPARING", "READY_TO_SHIP", "SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED",
)
ORDER_TYPES = ("PRESCRIPTION", "SHOP")
CART_STATUSES = ("ACTIVE", "CONVERTED", "ABANDONED")
INVOICE_STATUSES = ("DRAFT", "SENT", "CONFIRMED", "PAID", "CANCELLED")

# ── Payments (6 statuses — PAYMENT_MACHINE) ─────────────────────────────
PAYMENT_STATUSES = ("PENDING", "AWAITING_VERIFY", "PAID", "FAILED", "REJECTED", "REFUNDED")
PAYMENT_METHODS = ("ZARINPAL", "CARD_TO_CARD", "OTHER")

# ── Shipping (SHIPMENT_MACHINE) ─────────────────────────────────────────
SHIPMENT_STATUSES = ("PREPARING", "SHIPPED", "IN_TRANSIT", "DELIVERED", "FAILED", "RETURNED")
SHIPMENT_METHODS = ("MOTORCYCLE", "CAR", "POST", "COURIER")

# ── Tickets (TICKET_MACHINE) ────────────────────────────────────────────
TICKET_STATUSES = ("OPEN", "IN_PROGRESS", "WAITING_USER", "WAITING_EXPERT", "RESOLVED", "CLOSED")
TICKET_CATEGORIES = ("GENERAL", "ORDER", "PAYMENT", "MEDICAL", "SHIPPING", "OTHER")
TICKET_PRIORITIES = ("LOW", "NORMAL", "HIGH", "URGENT")

# ── Referral ────────────────────────────────────────────────────────────
REFERRAL_STATUSES = ("PENDING", "ACTIVE", "SETTLED")

# ── Notifications / SMS ─────────────────────────────────────────────────
SMS_STATUSES = ("QUEUED", "SENT", "DELIVERED", "FAILED")
SMS_PROVIDERS = ("KAVENEGAR", "OTHER")

# ── Finance ─────────────────────────────────────────────────────────────
FINANCE_TXN_TYPES = ("INCOME", "EXPENSE", "REFUND", "COMMISSION", "SHIPPING_COST", "ADJUSTMENT")
FINANCE_TXN_CATEGORIES = ("SALES", "SALARY", "TRANSPORT", "MATERIAL", "MARKETING", "OTHER")
EXPENSE_CATEGORIES = ("SALARY", "TRANSPORT", "MATERIAL", "MARKETING", "RENT", "UTILITY", "OTHER")
EXPENSE_STATUSES = ("PENDING", "APPROVED", "REJECTED")

# ── Inventory ───────────────────────────────────────────────────────────
INVENTORY_MOVEMENT_TYPES = ("STOCK_IN", "STOCK_OUT", "RESERVE", "RELEASE", "ADJUSTMENT", "RETURN", "DAMAGE")

# ── Price history reasons ───────────────────────────────────────────────
PRICE_CHANGE_REASONS = ("IMPORT", "BULK_INCREASE", "BULK_DECREASE", "MANUAL", "INITIAL")


def in_check(values: tuple[str, ...]) -> str:
    """Render an IN (...) SQL fragment for CHECK constraints."""
    return "IN ({})".format(", ".join(f"'{v}'" for v in values))


PHONE_CHECK = "phone ~ '^\\+?[0-9]{10,15}$'"
