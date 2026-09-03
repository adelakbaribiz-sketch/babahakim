// Central constants: roles, permissions, workflow states & transitions
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
  NEW: { fa: 'جدید', en: 'New', color: 'bg-slate-500' },
  WAITING_FOR_EXPERT_1: { fa: 'در صف کارشناس اول', en: 'Waiting for Expert 1', color: 'bg-[#57AFE2] text-[#173F76] font-medium' },
  EXPERT_1_REVIEW: { fa: 'بررسی کارشناس اول', en: 'Expert 1 Review', color: 'bg-[#225BBE] text-white' },
  WAITING_FOR_USER_APPROVAL: { fa: 'در انتظار تأیید کاربر', en: 'Waiting for User Approval', color: 'bg-amber-500 text-white' },
  WAITING_FOR_EXPERT_1_PRESCRIPTION: { fa: 'در انتظار نسخه کارشناس اول', en: 'Waiting for Expert 1 Prescription', color: 'bg-[#225BBE] text-white' },
  WAITING_FOR_EXPERT_2: { fa: 'در انتظار کارشناس دوم', en: 'Waiting for Expert 2', color: 'bg-[#57AFE2] text-[#173F76] font-medium' },
  REVISION_REQUESTED: { fa: 'اصلاح درخواست‌شده', en: 'Revision Requested', color: 'bg-violet-500 text-white' },
  WAITING_FOR_DOCTOR: { fa: 'در انتظار پزشک', en: 'Waiting for Doctor', color: 'bg-[#173F76] text-white' },
  PRESCRIPTION_APPROVED: { fa: 'نسخه تأیید شد', en: 'Prescription Approved', color: 'bg-emerald-600 text-white' },
  PREPARING_ORDER: { fa: 'آماده‌سازی سفارش', en: 'Preparing Order', color: 'bg-[#225BBE] text-white' },
  PROFORMA_CREATED: { fa: 'پیش‌فاکتور صادر شد', en: 'Proforma Created', color: 'bg-[#173F76] text-white' },
  WAITING_FOR_USER_CONFIRMATION: { fa: 'در انتظار تأیید پیش‌فاکتور', en: 'Waiting for Proforma Confirmation', color: 'bg-amber-500 text-white' },
  WAITING_FOR_PAYMENT: { fa: 'در انتظار پرداخت', en: 'Waiting for Payment', color: 'bg-amber-600 text-white' },
  PAYMENT_CONFIRMED: { fa: 'پرداخت تأیید شد', en: 'Payment Confirmed', color: 'bg-emerald-600 text-white' },
  PREPARING_SHIPMENT: { fa: 'آماده‌سازی ارسال', en: 'Preparing Shipment', color: 'bg-[#225BBE] text-white' },
  SHIPPED: { fa: 'ارسال شد', en: 'Shipped', color: 'bg-[#57AFE2] text-[#173F76] font-medium' },
  DELIVERED: { fa: 'تحویل شد', en: 'Delivered', color: 'bg-green-700 text-white' },
  FOLLOW_UP: { fa: 'پیگیری درمان', en: 'Follow Up', color: 'bg-violet-600 text-white' },
  REFERRED_AGAIN: { fa: 'ارجاع مجدد', en: 'Referred Again', color: 'bg-violet-700 text-white' },
  CLOSED: { fa: 'بسته شد', en: 'Closed', color: 'bg-slate-700 text-white' },
  CANCELLED: { fa: 'لغو شد', en: 'Cancelled', color: 'bg-rose-700 text-white' },
}

export type WorkflowAction =
  | 'CLAIM' | 'SUBMIT_ASSESSMENT' | 'USER_APPROVE' | 'USER_DECLINE'
  | 'SUBMIT_PRESCRIPTION' | 'EXPERT2_REVIEW' | 'DOCTOR_APPROVE' | 'DOCTOR_REJECT' | 'DOCTOR_REVISION'
  | 'CREATE_PROFORMA' | 'CONFIRM_PROFORMA' | 'REJECT_PROFORMA' | 'MARK_PAID'
  | 'START_SHIPPING' | 'MARK_DELIVERED' | 'SCHEDULE_FOLLOWUP' | 'COMPLETE_FOLLOWUP' | 'REFER_AGAIN' | 'CANCEL'

interface TransitionDef {
  from: CaseStatus[]
  to: CaseStatus
  action: WorkflowAction
  roles: Role[]
  permission?: Permission
  descFa: string
}

export const TRANSITIONS: TransitionDef[] = [
  { action: 'CLAIM', from: ['WAITING_FOR_EXPERT_1'], to: 'EXPERT_1_REVIEW', roles: ['EXPERT_1'], permission: 'claim_cases', descFa: 'کارشناس اول پرونده را دریافت کرد' },
  { action: 'SUBMIT_ASSESSMENT', from: ['EXPERT_1_REVIEW'], to: 'WAITING_FOR_USER_APPROVAL', roles: ['EXPERT_1'], permission: 'expert1_assessment', descFa: 'ارزیابی اولیه ارسال شد' },
  { action: 'USER_APPROVE', from: ['WAITING_FOR_USER_APPROVAL'], to: 'WAITING_FOR_EXPERT_1_PRESCRIPTION', roles: ['PATIENT'], descFa: 'کاربر ادامه درمان را تأیید کرد' },
  { action: 'USER_DECLINE', from: ['WAITING_FOR_USER_APPROVAL'], to: 'CLOSED', roles: ['PATIENT'], descFa: 'کاربر ادامه درمان را رد کرد' },
  { action: 'SUBMIT_PRESCRIPTION', from: ['WAITING_FOR_EXPERT_1_PRESCRIPTION', 'REVISION_REQUESTED'], to: 'WAITING_FOR_EXPERT_2', roles: ['EXPERT_1'], permission: 'create_prescription', descFa: 'نسخه کارشناس اول ثبت شد' },
  { action: 'EXPERT2_REVIEW', from: ['WAITING_FOR_EXPERT_2'], to: 'WAITING_FOR_DOCTOR', roles: ['EXPERT_2'], permission: 'expert2_review', descFa: 'بازبینی کارشناس دوم و ارسال برای پزشک' },
  { action: 'DOCTOR_APPROVE', from: ['WAITING_FOR_DOCTOR'], to: 'PRESCRIPTION_APPROVED', roles: ['DOCTOR'], permission: 'approve_prescription', descFa: 'پزشک نسخه را تأیید کرد' },
  { action: 'DOCTOR_REJECT', from: ['WAITING_FOR_DOCTOR'], to: 'CLOSED', roles: ['DOCTOR'], permission: 'approve_prescription', descFa: 'پزشک نسخه را رد کرد' },
  { action: 'DOCTOR_REVISION', from: ['WAITING_FOR_DOCTOR'], to: 'WAITING_FOR_EXPERT_2', roles: ['DOCTOR'], permission: 'approve_prescription', descFa: 'پزشک اصلاح درخواست کرد' },
  { action: 'CREATE_PROFORMA', from: ['PRESCRIPTION_APPROVED'], to: 'PROFORMA_CREATED', roles: ['EXPERT_2', 'OPERATOR'], permission: 'create_invoice', descFa: 'پیش‌فاکتور ایجاد شد' },
  { action: 'CONFIRM_PROFORMA', from: ['PROFORMA_CREATED', 'WAITING_FOR_USER_CONFIRMATION'], to: 'WAITING_FOR_PAYMENT', roles: ['PATIENT'], descFa: 'پیش‌فاکتور توسط کاربر تأیید شد' },
  { action: 'REJECT_PROFORMA', from: ['PROFORMA_CREATED', 'WAITING_FOR_USER_CONFIRMATION'], to: 'CANCELLED', roles: ['PATIENT'], descFa: 'پیش‌فاکتور رد شد' },
  { action: 'MARK_PAID', from: ['WAITING_FOR_PAYMENT'], to: 'PAYMENT_CONFIRMED', roles: ['OPERATOR', 'EXPERT_2'], permission: 'verify_payment', descFa: 'پرداخت تأیید شد' },
  { action: 'START_SHIPPING', from: ['PAYMENT_CONFIRMED', 'PREPARING_SHIPMENT'], to: 'SHIPPED', roles: ['OPERATOR', 'EXPERT_2'], permission: 'manage_shipments', descFa: 'سفارش ارسال شد' },
  { action: 'MARK_DELIVERED', from: ['SHIPPED'], to: 'DELIVERED', roles: ['OPERATOR', 'EXPERT_2'], permission: 'manage_shipments', descFa: 'تحویل ثبت شد' },
  { action: 'SCHEDULE_FOLLOWUP', from: ['DELIVERED'], to: 'FOLLOW_UP', roles: ['EXPERT_1', 'OPERATOR'], permission: 'manage_followups', descFa: 'پیگیری درمان فعال شد' },
  { action: 'COMPLETE_FOLLOWUP', from: ['FOLLOW_UP'], to: 'CLOSED', roles: ['EXPERT_1', 'OPERATOR'], permission: 'manage_followups', descFa: 'پیگیری تکمیل شد' },
  { action: 'REFER_AGAIN', from: ['FOLLOW_UP', 'DELIVERED'], to: 'REFERRED_AGAIN', roles: ['PATIENT', 'EXPERT_1', 'OPERATOR'], descFa: 'ارجاع مجدد ثبت شد' },
]

export function canTransition(status: string, action: string, role: string) {
  const t = TRANSITIONS.find((tr) => tr.action === action)
  if (!t) return null
  if (!t.from.includes(status as CaseStatus)) return null
  if (!t.roles.includes(role as Role)) return null
  return t
}

export const ORDER_STATUS_META: Record<string, { fa: string; en: string; color: string }> = {
  CART: { fa: 'سبد خرید', en: 'Cart', color: 'bg-slate-500' },
  PENDING_CONFIRMATION: { fa: 'در انتظار تأیید', en: 'Pending Confirmation', color: 'bg-amber-500 text-white' },
  CONFIRMED: { fa: 'تأیید شد', en: 'Confirmed', color: 'bg-[#225BBE] text-white' },
  PAYMENT_PENDING: { fa: 'در انتظار پرداخت', en: 'Payment Pending', color: 'bg-amber-600 text-white' },
  PAID: { fa: 'پرداخت شد', en: 'Paid', color: 'bg-emerald-600 text-white' },
  PREPARING: { fa: 'آماده‌سازی', en: 'Preparing', color: 'bg-[#225BBE] text-white' },
  READY_TO_SHIP: { fa: 'آماده ارسال', en: 'Ready to Ship', color: 'bg-[#57AFE2] text-[#173F76] font-medium' },
  SHIPPED: { fa: 'ارسال شد', en: 'Shipped', color: 'bg-[#173F76] text-white' },
  DELIVERED: { fa: 'تحویل شد', en: 'Delivered', color: 'bg-green-700 text-white' },
  CANCELLED: { fa: 'لغو شد', en: 'Cancelled', color: 'bg-rose-700 text-white' },
  REFUNDED: { fa: 'بازپرداخت', en: 'Refunded', color: 'bg-slate-600 text-white' },
}

export const PAYMENT_STATUS_META: Record<string, { fa: string; en: string; color: string }> = {
  PENDING: { fa: 'در انتظار', en: 'Pending', color: 'bg-[#57AFE2] text-[#173F76] font-medium' },
  AWAITING_VERIFY: { fa: 'در انتظار تأیید اپراتور', en: 'Awaiting Verify', color: 'bg-amber-500 text-white' },
  PAID: { fa: 'پرداخت‌شده', en: 'Paid', color: 'bg-emerald-600 text-white' },
  FAILED: { fa: 'ناموفق', en: 'Failed', color: 'bg-red-600 text-white' },
  REJECTED: { fa: 'رد‌شده', en: 'Rejected', color: 'bg-rose-700 text-white' },
  REFUNDED: { fa: 'بازپرداخت', en: 'Refunded', color: 'bg-slate-600 text-white' },
}

export const TICKET_STATUS_META: Record<string, { fa: string; en: string; color: string }> = {
  OPEN: { fa: 'باز', en: 'Open', color: 'bg-amber-500 text-white' },
  IN_PROGRESS: { fa: 'در حال بررسی', en: 'In Progress', color: 'bg-[#225BBE] text-white' },
  WAITING_USER: { fa: 'در انتظار کاربر', en: 'Waiting User', color: 'bg-amber-600 text-white' },
  WAITING_EXPERT: { fa: 'در انتظار کارشناس', en: 'Waiting Expert', color: 'bg-[#57AFE2] text-[#173F76] font-medium' },
  RESOLVED: { fa: 'حل شد', en: 'Resolved', color: 'bg-emerald-600 text-white' },
  CLOSED: { fa: 'بسته', en: 'Closed', color: 'bg-slate-600 text-white' },
}

// مِزاج‌ها (Temperaments — Traditional Persian Medicine)
export const MIZAJ_OPTIONS = [
  { code: 'HOT_DRY', fa: 'گرم و خشک', en: 'Hot & Dry' },
  { code: 'HOT_WET', fa: 'گرم و تر', en: 'Hot & Wet' },
  { code: 'COLD_DRY', fa: 'سرد و خشک', en: 'Cold & Dry' },
  { code: 'COLD_WET', fa: 'سرد و تر', en: 'Cold & Wet' },
  { code: 'BALANCED', fa: 'معتدل', en: 'Balanced' },
]
