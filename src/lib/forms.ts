// ── BabaHakim Client Form Schemas (PHASE 09, ED-111) ───────────────────────
// MIRRORS of the server zod DTOs (src/server/application/dto.ts).
// The server remains the ONLY authority (ED-96) — these copies exist purely
// for instant field-level UX and identical messages. Keep the messages in
// sync when the server schema changes (checked by scripts/frontend-audit.mjs).
import { z } from 'zod'

// ── shared primitives (mirror server/api/schemas.ts) ──────────────────────
const phone = z.string().trim().regex(/^09\d{9}$/, 'شماره موبایل باید ۱۱ رقم و با 09 شروع شود')
const requiredText = (max: number, label: string) => z.string().trim().min(1, `${label} الزامی است`).max(max, `${label} حداکثر ${max} کاراکتر`)
const safeText = (max: number) => z.string().trim().max(max).optional().default('')

// ── auth ───────────────────────────────────────────────────────────────────
export const loginFormSchema = z.object({
  phone,
  password: z.string().min(1, 'رمز عبور الزامی است').max(128),
})

export const registerFormSchema = z.object({
  phone,
  password: z.string().min(8, 'رمز عبور باید حداقل ۸ کاراکتر باشد')
    .regex(/[A-Za-z]/, 'رمز عبور باید شامل حرف و رقم باشد')
    .regex(/\d/, 'رمز عبور باید شامل حرف و رقم باشد')
    .max(128),
  firstName: requiredText(100, 'نام'),
  lastName: requiredText(100, 'نام خانوادگی'),
  referralCode: safeText(24),
})

// ── new case (mirror caseCreateSchema — min 10 enforced server-side, S3) ──
export const newCaseFormSchema = z.object({
  description: requiredText(4000, 'شرح حال (توضیح مشکل)').min(10, 'شرح حال باید حداقل ۱۰ کاراکتر باشد'),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']),
})

// ── ticket (mirror ticketCreateSchema) ────────────────────────────────────
export const ticketFormSchema = z.object({
  subject: requiredText(200, 'موضوع'),
  category: z.enum(['GENERAL', 'ORDER', 'PAYMENT', 'MEDICAL', 'SHIPPING', 'OTHER']),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']),
  message: requiredText(2000, 'پیام'),
})

// ── profile (mirror profilePatchSchema — numeric fields coerced) ──────────
export const profileFormSchema = z.object({
  firstName: requiredText(100, 'نام'),
  lastName: requiredText(100, 'نام خانوادگی'),
  email: z.union([z.literal(''), z.string().email('ایمیل معتبر نیست')]).optional(),
  gender: z.enum(['', 'MALE', 'FEMALE']).optional(),
  heightCm: z.coerce.number({ invalid_type_error: 'قد باید عدد باشد' }).int('قد باید عدد صحیح باشد').min(50, 'قد بین ۵۰ تا ۲۵۰ سانتی‌متر').max(250, 'قد بین ۵۰ تا ۲۵۰ سانتی‌متر').optional(),
  weightKg: z.coerce.number({ invalid_type_error: 'وزن باید عدد باشد' }).min(2, 'وزن بین ۲ تا ۳۰۰ کیلوگرم').max(300, 'وزن بین ۲ تا ۳۰۰ کیلوگرم').optional(),
  emergencyPhone: z.union([z.literal(''), phone]).optional(),
  postalCode: z.union([z.literal(''), z.string().regex(/^\d{10}$/, 'کد پستی باید ۱۰ رقم باشد')]).optional(),
})

// ── admin product (mirror productUpsertSchema) ────────────────────────────
export const productFormSchema = z.object({
  sku: requiredText(40, 'SKU'),
  nameFa: requiredText(200, 'نام فارسی'),
  currentPrice: z.coerce.number({ invalid_type_error: 'قیمت باید عدد باشد' }).int().min(0, 'قیمت نمی‌تواند منفی باشد'),
  stock: z.coerce.number({ invalid_type_error: 'موجودی باید عدد باشد' }).int().min(0, 'موجودی نمی‌تواند منفی باشد'),
})

// ── admin disease (mirror diseaseUpsertSchema) ────────────────────────────
export const diseaseFormSchema = z.object({
  code: requiredText(40, 'کد'),
  nameFa: requiredText(200, 'نام فارسی'),
})

/** Flatten a zod SafeParseError into {path: message} for field display. */
export function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const i of error.issues) out[i.path.join('.')] = i.message
  return out
}
