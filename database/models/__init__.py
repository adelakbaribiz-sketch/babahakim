"""BabaHakim — SQLAlchemy model catalogue (PHASE 04 Database Architecture).

Import order matters only for readability; SQLAlchemy resolves FK targets by
qualified table name across the whole MetaData at configure time.

Usage:
    from models import Base, User, ...           # any entity
    from models import soft_delete_tables, updated_at_tables, APPEND_ONLY_TABLES
"""
from __future__ import annotations

from .base import (
    APPEND_ONLY_TABLES,
    Base,
    CreatedOnlyMixin,
    IdMixin,
    SoftDeleteMixin,
    TimestampMixin,
    soft_delete_tables,
    updated_at_tables,
)
from . import statuses  # noqa: F401 — canonical value sets

# identity
from .identity import Permission, RefreshToken, Role, RolePermission, User  # noqa: F401
# patients
from .patients import (  # noqa: F401
    Address, Answer, ContactLog, PatientProfile, Question, QuestionOption,
    Questionnaire, QuestionnaireResponse, Referral,
)
# medical_records
from .medical_records import Image  # noqa: F401
# ai
from .ai import AIAnalysis, AIModel, Dataset, DatasetItem, DatasetVersion  # noqa: F401
# clinical_review
from .clinical_review import (  # noqa: F401
    CaseEvent, Diagnosis, Disease, DoctorReview, ExpertReview, FollowUp, MedicalFile,
)
# products
from .products import (  # noqa: F401
    DiseaseProduct, Inventory, InventoryMovement, Product, ProductPriceHistory,
)
# prescriptions
from .prescriptions import Prescription, PrescriptionItem  # noqa: F401
# commerce
from .commerce import Cart, CartItem, Invoice, Order, OrderItem  # noqa: F401
# payments
from .payments import Payment  # noqa: F401
# shipping
from .shipping import Shipment  # noqa: F401
# notifications
from .notifications import Notification, SMSLog  # noqa: F401
# tickets
from .tickets import Ticket, TicketMessage  # noqa: F401
# finance
from .finance import Expense, FinancialTransaction  # noqa: F401
# administration
from .administration import AuditLog  # noqa: F401
# reporting
from .reporting import DailyRevenue  # noqa: F401

__all__ = [
    "Base", "IdMixin", "TimestampMixin", "SoftDeleteMixin", "CreatedOnlyMixin",
    "APPEND_ONLY_TABLES", "soft_delete_tables", "updated_at_tables", "statuses",
    # identity
    "User", "RefreshToken", "Role", "Permission", "RolePermission",
    # patients
    "PatientProfile", "Address", "ContactLog", "Questionnaire", "Question",
    "QuestionOption", "QuestionnaireResponse", "Answer", "Referral",
    # medical records
    "Image",
    # ai
    "AIModel", "AIAnalysis", "Dataset", "DatasetVersion", "DatasetItem",
    # clinical review
    "MedicalFile", "CaseEvent", "Disease", "Diagnosis", "ExpertReview",
    "DoctorReview", "FollowUp",
    # products
    "Product", "ProductPriceHistory", "Inventory", "InventoryMovement", "DiseaseProduct",
    # prescriptions
    "Prescription", "PrescriptionItem",
    # commerce
    "Cart", "CartItem", "Order", "OrderItem", "Invoice",
    # payments
    "Payment",
    # shipping
    "Shipment",
    # notifications
    "Notification", "SMSLog",
    # tickets
    "Ticket", "TicketMessage",
    # finance
    "FinancialTransaction", "Expense",
    # administration
    "AuditLog",
    # reporting
    "DailyRevenue",
]
