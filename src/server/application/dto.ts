// ── BabaHakim Backend · Application DTOs (zod input contracts, ED-96) ──────
// One schema per use case — validated at the API boundary, typed downstream.
// Messages keep the exact Persian wording the v1 UI/E2E expects.
import { z } from 'zod'
import {
  PRIORITY, TICKET_CATEGORY, SHIPMENT_METHOD, PAYMENT_METHOD, PAYMENT_DECISION,
  AI_AGREEMENT, phoneSchema, cuid, requiredText, safeText,
} from '@/server/api/schemas'

// ── auth ───────────────────────────────────────────────────────────────────
export const loginSchema = z.object({
  phone: phoneSchema,
  password: z.string().min(1, 'رمز عبور الزامی است').max(128),
})

export const registerSchema = z.object({
  phone: phoneSchema,
  password: z.string().min(8, 'رمز عبور باید حداقل ۸ کاراکتر باشد')
    .regex(/[A-Za-z]/, 'رمز عبور باید شامل حرف و رقم باشد')
    .regex(/\d/, 'رمز عبور باید شامل حرف و رقم باشد')
    .max(128),
  firstName: requiredText(100, 'نام'),
  lastName: requiredText(100, 'نام خانوادگی'),
  referralCode: safeText(24).optional().nullable(),
  acceptTerms: z.boolean().optional().default(false),
})

export const otpRequestSchema = z.object({ phone: phoneSchema })
export const otpVerifySchema = z.object({
  challengeId: cuid, code: z.string().regex(/^\d{6}$/, 'کد ۶ رقمی وارد کنید'),
})

// ── cases ──────────────────────────────────────────────────────────────────
export const caseCreateSchema = z.object({
  // PHASE 09 (S3/F16): min 10 mirrored server-side — the client gate is UX-only,
  // the authoritative rule lives here (no frontend-only business rule).
  description: requiredText(4000, 'شرح حال (توضیح مشکل)').min(10, 'شرح حال باید حداقل ۱۰ کاراکتر باشد'),
  imageId: cuid,
  priority: PRIORITY.default('NORMAL'),
})

export const caseListFilterSchema = z.object({
  status: safeText(40).optional().default(''),
})

const WORKFLOW_ACTIONS = [
  'CLAIM', 'SUBMIT_ASSESSMENT', 'USER_APPROVE', 'USER_DECLINE',
  'SUBMIT_PRESCRIPTION', 'EXPERT2_REVIEW', 'DOCTOR_APPROVE', 'DOCTOR_REJECT', 'DOCTOR_REVISION',
  'CREATE_PROFORMA', 'CONFIRM_PROFORMA', 'REJECT_PROFORMA', 'MARK_PAID',
  'START_SHIPPING', 'MARK_DELIVERED', 'SCHEDULE_FOLLOWUP', 'COMPLETE_FOLLOWUP', 'REFER_AGAIN', 'CANCEL',
] as const

export const caseActionBaseSchema = z.object({
  action: z.enum(WORKFLOW_ACTIONS),
}).passthrough() // per-action fields validated inside caseActionService

// ── orders / shop ──────────────────────────────────────────────────────────
export const checkoutSchema = z.object({}).passthrough() // body optional; cart is the source

export const orderPatchSchema = z.object({
  action: z.enum(['CONFIRM', 'CANCEL', 'PREPARING', 'READY', 'REFUND']),
  reason: safeText(500).optional().default(''),
})

export const cartAddSchema = z.object({
  productId: cuid,
  quantity: z.number().int().min(1).max(99).default(1),
})

export const cartPatchSchema = z.object({
  itemId: cuid,
  quantity: z.number().int().min(0).max(99),
})

// ── payments ───────────────────────────────────────────────────────────────
export const paymentStartSchema = z.object({
  orderId: cuid,
  method: PAYMENT_METHOD.default('ZARINPAL'),
})

export const paymentVerifySchema = z.object({
  decision: PAYMENT_DECISION,
  note: safeText(1000).optional().default(''),
})

export const receiptSchema = z.object({
  trackingCode: safeText(60).optional().nullable(),
  amount: z.number().min(0).optional().nullable(),
  note: safeText(1000).optional().nullable(),
  imageId: cuid.optional().nullable(),
})

// ── prescriptions (case action payloads) ───────────────────────────────────
export const assessmentSchema = z.object({
  summary: requiredText(4000, 'متن ارزیابی اولیه'),
  diseases: z.array(z.string().max(120)).max(12).optional().default([]),
  aiAgreement: AI_AGREEMENT.optional().default('MODIFIED'),
  aiComment: safeText(2000).optional().default(''),
  confidence: z.number().min(0).max(100).optional().nullable(),
  basedOnAI: z.boolean().optional().default(true),
  // PHASE 11: per-indicator corrected values — the true ground-truth feed for
  // the learning dataset (optional; agreement code alone still records a label)
  aiCorrections: z.array(z.object({
    indicator: z.string().min(1).max(64),
    value: z.string().min(1).max(120),
  })).max(20).optional().default([]),
})

export const prescriptionItemSchema = z.object({
  productId: cuid.optional().nullable(),
  drugName: requiredText(200, 'نام دارو'),
  dosage: safeText(120).optional().nullable(),
  frequency: safeText(120).optional().nullable(),
  duration: safeText(120).optional().nullable(),
  instructions: safeText(2000).optional().nullable(),
  warnings: safeText(2000).optional().nullable(),
})

export const prescriptionSubmitSchema = z.object({
  notes: safeText(4000).optional().default(''),
  items: z.array(prescriptionItemSchema).min(1, 'نسخه باید حداقل یک قلم داشته باشد').max(40),
})

export const expert2ReviewSchema = z.object({
  notes: safeText(4000).optional().default(''),
  items: z.array(z.object({
    id: cuid,
    available: z.boolean().optional().default(true),
    missing: z.boolean().optional().default(false),
    unitPrice: z.number().min(0).max(10_000_000_000).optional(),
  })).max(60).optional().default([]),
})

export const doctorDecisionSchema = z.object({
  comment: safeText(4000).optional().default(''),
  followUpDays: z.number().int().min(1).max(365).optional().nullable(),
})

export const proformaSchema = z.object({
  shippingCost: z.number().min(0).max(10_000_000).optional(),
  note: safeText(500).optional().default(''),
})

export const shippingSchema = z.object({
  shipmentId: cuid.optional(),
  method: SHIPMENT_METHOD.optional(),
  driverName: safeText(120).optional().nullable(),
  driverPhone: safeText(20).optional().nullable(),
  receiverPhone: safeText(20).optional().nullable(),
  trackingCode: safeText(60).optional().nullable(),
  vehicleType: safeText(60).optional().nullable(),
  cost: z.number().min(0).max(10_000_000).optional(),
  note: safeText(1000).optional().nullable(),
  status: z.enum(['SHIPPED', 'DELIVERED', 'IN_TRANSIT', 'FAILED']).optional(),
  reason: safeText(500).optional().default(''),
})

// ── follow-ups ─────────────────────────────────────────────────────────────
export const followupPatchSchema = z.object({
  id: cuid,
  status: z.enum(['COMPLETED', 'CANCELLED', 'DUE', 'OVERDUE']).optional(),
  note: safeText(2000).optional(),
  resultNote: safeText(2000).optional(),
  reason: safeText(500).optional().default(''),
})

// ── tickets ────────────────────────────────────────────────────────────────
export const ticketCreateSchema = z.object({
  subject: requiredText(200, 'موضوع'),
  message: requiredText(4000, 'متن پیام'),
  category: TICKET_CATEGORY.optional().default('GENERAL'),
  priority: PRIORITY.optional().default('NORMAL'),
  caseId: cuid.optional().nullable(),
})

export const ticketMessageSchema = z.object({
  message: requiredText(4000, 'متن پیام'),
  isInternal: z.boolean().optional().default(false),
})

export const ticketPatchSchema = z.object({
  status: z.enum(['IN_PROGRESS', 'WAITING_USER', 'WAITING_EXPERT', 'RESOLVED', 'CLOSED', 'REOPEN']).optional(),
  priority: PRIORITY.optional(),
  assignedToId: cuid.optional().nullable(),
})

// ── profile / questionnaire ────────────────────────────────────────────────
export const profileUpdateSchema = z.object({
  firstName: safeText(100).optional(),
  lastName: safeText(100).optional(),
  email: z.union([z.string().email('ایمیل معتبر نیست').max(190), z.literal(''), z.null()]).optional(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  birthDate: z.coerce.date().optional().nullable(),
  province: safeText(60).optional().nullable(),
  city: safeText(60).optional().nullable(),
  postalCode: z.union([z.string().regex(/^\d{10}$/, 'کد پستی باید ۱۰ رقم باشد'), z.literal(''), z.null()]).optional(),
  addressLine: safeText(500).optional().nullable(),
  emergencyPhone: z.union([phoneSchema, z.literal(''), z.null()]).optional(),
  allergies: safeText(2000).optional().nullable(),
  pastIllnesses: safeText(2000).optional().nullable(),
  currentMeds: safeText(2000).optional().nullable(),
  pregnancy: z.enum(['NONE', 'PREGNANT', 'NURSING', 'POSSIBLE']).optional().nullable(),
  referredBy: safeText(120).optional().nullable(),
  heightCm: z.coerce.number().int().min(30).max(250).optional().nullable(),
  weightKg: z.coerce.number().min(2).max(400).optional().nullable(),
})

export const questionnaireSubmitSchema = z.object({
  answers: z.array(z.object({ questionId: cuid, optionId: cuid })).min(1, 'پاسخ‌ها ارسال نشده است').max(60),
})

// ── notifications ──────────────────────────────────────────────────────────
export const markReadSchema = z.object({ id: cuid.optional() })

// ── admin ──────────────────────────────────────────────────────────────────
export const adminUserPatchSchema = z.object({
  id: cuid,
  role: z.enum(['ADMIN', 'EXPERT_1', 'EXPERT_2', 'OPERATOR', 'DOCTOR', 'PATIENT']).optional(),
  isActive: z.boolean().optional(),
  deleted: z.boolean().optional(),
}).passthrough()

export const diseaseCreateSchema = z.object({
  code: requiredText(40, 'کد'),
  nameFa: requiredText(200, 'نام فارسی'),
  nameEn: safeText(200).optional().default(''),
}).passthrough()

/** Generic "loose" PATCH contract: validated id + passthrough field bag. */
export const looseIdSchema = z.object({ id: cuid }).passthrough()

export const productSchema = z.object({
  sku: requiredText(60, 'SKU'), nameFa: requiredText(200, 'نام فارسی'), nameEn: safeText(200).optional().default(''),
  brand: safeText(120).optional().default(''), category: safeText(120).optional().default(''),
  descriptionFa: safeText(2000).optional().default(''), descriptionEn: safeText(2000).optional().default(''),
  usageFa: safeText(2000).optional().default(''),
  currentPrice: z.number().int().min(0).max(10_000_000_000),
  purchasePrice: z.number().int().min(0).max(10_000_000_000).optional(),
  restrictions: safeText(2000).optional().nullable(),
  stock: z.number().int().min(0).max(1_000_000),
  requiresPrescription: z.boolean().optional().default(false),
}).passthrough()

export const priceEngineSchema = z.object({
  mode: z.enum(['preview', 'commit', 'bulk']),
  csv: z.string().max(200_000).optional().default(''),
  percent: z.number().min(-100).max(100).optional(),
  category: safeText(120).optional().nullable(),
})

export const deletionRequestPatchSchema = z.object({
  requestId: cuid,
  action: z.enum(['ANONYMIZE', 'REJECT']),
  note: safeText(500).optional().default(''),
})

// ── workflow governance (PHASE 12) ──────────────────────────────────────────
export const workflowRecoverSchema = z.object({
  entityType: z.enum([
    'CASE', 'PRESCRIPTION', 'ORDER', 'PAYMENT', 'SHIPMENT', 'TICKET', 'FOLLOWUP',
    'AI_REVIEW', 'DELETION_REQUEST', 'MEDICAL_IMAGE', 'INVOICE',
  ]),
  entityId: cuid,
  targetStatus: z.string().min(1, 'وضعیت هدف الزامی است').max(50),
  reason: requiredText(500, 'دلیل بازیابی').min(3, 'دلیل بازیابی باید حداقل ۳ کاراکتر باشد'),
})

// ── external integrations (PHASE 13) ────────────────────────────────────────
export const integrationSmokeSchema = z.object({
  kind: z.enum([
    'PAYMENT', 'SMS', 'EMAIL', 'MAPS', 'AI', 'STORAGE', 'SHIPPING', 'CRM', 'ANALYTICS',
  ], { message: 'نوع Integration نامعتبر است' }),
})
