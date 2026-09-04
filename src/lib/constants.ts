// Central constants: roles, permissions, workflow states & transitions

// Workflow Engine (Phase 02) — canonical case machine lives in src/lib/workflow/
// PHASE 09 (F03/ED-107): resolveTransition imports from the PURE module —
// importing engine.ts here dragged @/lib/db (Prisma) into the browser bundle.
import { CASE_MACHINE } from '@/lib/workflow/machines/case'
import type { TransitionDef } from '@/lib/workflow/types'
import { resolveTransition } from '@/lib/workflow/pure'
// PHASE 07 (§9/§27): status colors come ONLY from design-system tokens — never hardcoded
import { statusClass } from '@/design-system/tokens'

export const ROLES = ['ADMIN', 'EXPERT_1', 'EXPERT_2', 'OPERATOR', 'DOCTOR', 'PATIENT'] as const
export type Role = (typeof ROLES)[number]

export const ROLE_LABELS: Record<Role, { fa: string; en: string }> = {
  ADMIN: { fa: 'مدیر سیستم', en: 'Administrator' },
  EXPERT_1: { fa: 'کارشناس اول', en: 'Expert 1' },
  EXPERT_2: { fa: 'کارشناس دوم', en: 'Expert 2' },
  OPERATOR: { fa: 'اپراتور', en: 'Operator' },
  DOCTOR: { fa: 'پزشک', en: 'Doctor' },
  PATIENT: { fa: 'کاربر / بیمار', en: 'User / Patient' },
}

// ── Permission catalogue ────────────────────────────────────────────────
export const PERMISSIONS = [
  'view_patients', 'edit_patients', 'view_images', 'view_medical_files',
  'view_queue', 'claim_cases', 'expert1_assessment', 'create_prescription', 'edit_prescription',
  'expert2_review', 'send_to_doctor', 'approve_prescription',
  'create_invoice', 'view_financials', 'verify_payment', 'manage_prices',
  'manage_products', 'manage_diseases', 'manage_users', 'manage_questionnaire',
  'view_reports', 'manage_tickets', 'manage_orders', 'manage_shipments',
  'view_audit_logs', 'view_ai_analyses', 'manage_ai_models', 'view_all_cases',
  'manage_followups', 'view_dashboard_stats', 'view_sms_log',
  'manage_workflow_recovery', // PHASE 12: workflow governance console + force-recovery (ADMIN)
] as const
export type Permission = (typeof PERMISSIONS)[number]

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  ADMIN: [...PERMISSIONS],
  EXPERT_1: ['view_patients', 'view_images', 'view_medical_files', 'view_queue', 'claim_cases',
    'expert1_assessment', 'create_prescription', 'edit_prescription', 'view_ai_analyses',
    'manage_followups', 'view_reports', 'view_all_cases'],
  EXPERT_2: ['view_patients', 'view_images', 'view_medical_files', 'view_queue', 'view_all_cases',
    'expert2_review', 'edit_prescription', 'send_to_doctor', 'create_invoice', 'view_financials',
    'manage_orders', 'manage_shipments', 'view_ai_analyses', 'view_reports', 'claim_cases'],
  DOCTOR: ['view_patients', 'view_images', 'view_medical_files', 'view_queue', 'view_all_cases',
    'approve_prescription', 'view_ai_analyses'],
  OPERATOR: ['view_patients', 'view_medical_files', 'view_all_cases', 'verify_payment',
    'create_invoice', // PHASE 08 audit A15: realign with ED-04/BR matrix (§2) — operator issues proformas
    'manage_orders', 'manage_shipments', 'manage_tickets', 'manage_followups', 'view_financials',
    'manage_products', 'manage_prices', 'view_reports', 'view_dashboard_stats', 'view_sms_log', 'claim_cases'],
  PATIENT: [],
}

// ── Case workflow (state machine) ──────────────────────────────────────
export const CASE_STATUS = [
  'NEW', 'WAITING_FOR_EXPERT_1', 'EXPERT_1_REVIEW', 'WAITING_FOR_USER_APPROVAL',
  'WAITING_FOR_EXPERT_1_PRESCRIPTION', 'WAITING_FOR_EXPERT_2', 'REVISION_REQUESTED',
  'WAITING_FOR_DOCTOR', 'PRESCRIPTION_APPROVED', 'PREPARING_ORDER', 'PROFORMA_CREATED',
  'WAITING_FOR_USER_CONFIRMATION', 'WAITING_FOR_PAYMENT', 'PAYMENT_CONFIRMED',
  'PREPARING_SHIPMENT', 'SHIPPED', 'DELIVERED', 'FOLLOW_UP', 'REFERRED_AGAIN', 'CLOSED', 'CANCELLED',
] as const
export type CaseStatus = (typeof CASE_STATUS)[number]

export const STATUS_META: Record<CaseStatus, { fa: string; en: string; color: string }> = {
  NEW: { fa: 'جدید', en: 'New', color: statusClass.neutral },
  WAITING_FOR_EXPERT_1: { fa: 'در صف کارشناس اول', en: 'Waiting for Expert 1', color: statusClass.info },
  EXPERT_1_REVIEW: { fa: 'بررسی کارشناس اول', en: 'Expert 1 Review', color: statusClass.progress },
  WAITING_FOR_USER_APPROVAL: { fa: 'در انتظار تأیید کاربر', en: 'Waiting for User Approval', color: statusClass.warning },
  WAITING_FOR_EXPERT_1_PRESCRIPTION: { fa: 'در انتظار نسخه کارشناس اول', en: 'Waiting for Expert 1 Prescription', color: statusClass.progress },
  WAITING_FOR_EXPERT_2: { fa: 'در انتظار کارشناس دوم', en: 'Waiting for Expert 2', color: statusClass.info },
  REVISION_REQUESTED: { fa: 'اصلاح درخواست‌شده', en: 'Revision Requested', color: statusClass.revision },
  WAITING_FOR_DOCTOR: { fa: 'در انتظار پزشک', en: 'Waiting for Doctor', color: statusClass.navy },
  PRESCRIPTION_APPROVED: { fa: 'نسخه تأیید شد', en: 'Prescription Approved', color: statusClass.success },
  PREPARING_ORDER: { fa: 'آماده‌سازی سفارش', en: 'Preparing Order', color: statusClass.progress },
  PROFORMA_CREATED: { fa: 'پیش‌فاکتور صادر شد', en: 'Proforma Created', color: statusClass.navy },
  WAITING_FOR_USER_CONFIRMATION: { fa: 'در انتظار تأیید پیش‌فاکتور', en: 'Waiting for Proforma Confirmation', color: statusClass.warning },
  WAITING_FOR_PAYMENT: { fa: 'در انتظار پرداخت', en: 'Waiting for Payment', color: statusClass.warning },
  PAYMENT_CONFIRMED: { fa: 'پرداخت تأیید شد', en: 'Payment Confirmed', color: statusClass.success },
  PREPARING_SHIPMENT: { fa: 'آماده‌سازی ارسال', en: 'Preparing Shipment', color: statusClass.progress },
  SHIPPED: { fa: 'ارسال شد', en: 'Shipped', color: statusClass.info },
  DELIVERED: { fa: 'تحویل شد', en: 'Delivered', color: statusClass.success },
  FOLLOW_UP: { fa: 'پیگیری درمان', en: 'Follow Up', color: statusClass.revision },
  REFERRED_AGAIN: { fa: 'ارجاع مجدد', en: 'Referred Again', color: statusClass.revision },
  CLOSED: { fa: 'بسته شد', en: 'Closed', color: statusClass.neutral },
  CANCELLED: { fa: 'لغو شد', en: 'Cancelled', color: statusClass.danger },
}

export type WorkflowAction =
  | 'CLAIM' | 'SUBMIT_ASSESSMENT' | 'USER_APPROVE' | 'USER_DECLINE'
  | 'SUBMIT_PRESCRIPTION' | 'EXPERT2_REVIEW' | 'DOCTOR_APPROVE' | 'DOCTOR_REJECT' | 'DOCTOR_REVISION'
  | 'CREATE_PROFORMA' | 'CONFIRM_PROFORMA' | 'REJECT_PROFORMA' | 'MARK_PAID'
  | 'START_SHIPPING' | 'MARK_DELIVERED' | 'SCHEDULE_FOLLOWUP' | 'COMPLETE_FOLLOWUP' | 'REFER_AGAIN' | 'CANCEL'

// ── Workflow Engine (Phase 02) ─────────────────────────────────────────
// The canonical case state machine now lives in src/lib/workflow/machines/case.ts
// and is executed by src/lib/workflow/engine.ts (declarative, audited, extensible).
// The exports below are backward-compatible shims so existing imports keep working.
/** @deprecated use CASE_MACHINE transitions via the workflow engine instead */
export const TRANSITIONS: TransitionDef[] = CASE_MACHINE.transitions as TransitionDef[]

/** @deprecated use resolveTransition(CASE_MACHINE, status, action, role) instead */
export function canTransition(status: string, action: string, role: string) {
  return resolveTransition(CASE_MACHINE, status, action, role as never)
}

export const ORDER_STATUS_META: Record<string, { fa: string; en: string; color: string }> = {
  CART: { fa: 'سبد خرید', en: 'Cart', color: statusClass.neutral },
  PENDING_CONFIRMATION: { fa: 'در انتظار تأیید', en: 'Pending Confirmation', color: statusClass.warning },
  CONFIRMED: { fa: 'تأیید شد', en: 'Confirmed', color: statusClass.progress },
  PAYMENT_PENDING: { fa: 'در انتظار پرداخت', en: 'Payment Pending', color: statusClass.warning },
  PAID: { fa: 'پرداخت شد', en: 'Paid', color: statusClass.success },
  PREPARING: { fa: 'آماده‌سازی', en: 'Preparing', color: statusClass.progress },
  READY_TO_SHIP: { fa: 'آماده ارسال', en: 'Ready to Ship', color: statusClass.info },
  SHIPPED: { fa: 'ارسال شد', en: 'Shipped', color: statusClass.navy },
  DELIVERED: { fa: 'تحویل شد', en: 'Delivered', color: statusClass.success },
  CANCELLED: { fa: 'لغو شد', en: 'Cancelled', color: statusClass.danger },
  REFUNDED: { fa: 'بازپرداخت', en: 'Refunded', color: statusClass.neutral },
}

export const PAYMENT_STATUS_META: Record<string, { fa: string; en: string; color: string }> = {
  PENDING: { fa: 'در انتظار', en: 'Pending', color: statusClass.info },
  AWAITING_VERIFY: { fa: 'در انتظار تأیید اپراتور', en: 'Awaiting Verify', color: statusClass.warning },
  PAID: { fa: 'پرداخت‌شده', en: 'Paid', color: statusClass.success },
  FAILED: { fa: 'ناموفق', en: 'Failed', color: statusClass.danger },
  REJECTED: { fa: 'رد‌شده', en: 'Rejected', color: statusClass.danger },
  REFUNDED: { fa: 'بازپرداخت', en: 'Refunded', color: statusClass.neutral },
}

export const TICKET_STATUS_META: Record<string, { fa: string; en: string; color: string }> = {
  OPEN: { fa: 'باز', en: 'Open', color: statusClass.warning },
  IN_PROGRESS: { fa: 'در حال بررسی', en: 'In Progress', color: statusClass.progress },
  WAITING_USER: { fa: 'در انتظار کاربر', en: 'Waiting User', color: statusClass.warning },
  WAITING_EXPERT: { fa: 'در انتظار کارشناس', en: 'Waiting Expert', color: statusClass.info },
  RESOLVED: { fa: 'حل شد', en: 'Resolved', color: statusClass.success },
  CLOSED: { fa: 'بسته', en: 'Closed', color: statusClass.neutral },
}

// مِزاج‌ها (Temperaments — Traditional Persian Medicine)
export const MIZAJ_OPTIONS = [
  { code: 'HOT_DRY', fa: 'گرم و خشک', en: 'Hot & Dry' },
  { code: 'HOT_WET', fa: 'گرم و تر', en: 'Hot & Wet' },
  { code: 'COLD_DRY', fa: 'سرد و خشک', en: 'Cold & Dry' },
  { code: 'COLD_WET', fa: 'سرد و تر', en: 'Cold & Wet' },
  { code: 'BALANCED', fa: 'معتدل', en: 'Balanced' },
]
