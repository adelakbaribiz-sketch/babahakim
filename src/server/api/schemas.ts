// ── BabaHakim Backend · Shared request schemas (PHASE 08, ED-96) ──────────
// Reusable zod primitives shared by application DTOs. Enum sets mirror
// src/lib/constants (single source of truth — imported, never duplicated).
import { z } from 'zod'
import { normalizeNationalId, isValidIranianNationalId } from '@/lib/national-id-format'

// Business enums (re-exported so DTO files do not import each other)
export const PRIORITY = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT'])
export const TICKET_CATEGORY = z.enum(['GENERAL', 'ORDER', 'PAYMENT', 'MEDICAL', 'SHIPPING', 'OTHER'])
export const SHIPMENT_METHOD = z.enum(['MOTORCYCLE', 'CAR', 'POST'])
// PHASE 10: unified with MEDIA_POLICY types (storage IMAGE_TYPES parity — the
// old TONGUE|SKIN|FACE|OTHER set could not express RECEIPT/DELIVERY/PRODUCT)
export const IMAGE_TYPE = z.enum(['TONGUE', 'FACE', 'RECEIPT', 'DELIVERY', 'PRODUCT', 'AVATAR', 'DOCUMENT'])
export const PAYMENT_METHOD = z.enum(['ZARINPAL', 'CARD_TO_CARD'])
export const PAYMENT_DECISION = z.enum(['APPROVE', 'REJECT', 'MORE_INFO'])
export const AI_AGREEMENT = z.enum(['ACCEPTED', 'REJECTED', 'MODIFIED'])

// Normalizes Persian/Arabic digits then strips non-digits → `09xxxxxxxxx`
export const phoneSchema = z
  .string()
  .transform((s) => s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/\D/g, ''))
  .pipe(z.string().regex(/^09\d{9}$/, 'شماره موبایل معتبر نیست (۰۹xxxxxxxxx)'))

// National ID: digits normalized, 10 digits, official mod-11 checksum
export const nationalIdSchema = z
  .string()
  .transform(normalizeNationalId)
  .pipe(z.string()
    .regex(/^\d{10}$/, 'کد ملی باید ۱۰ رقم باشد')
    .refine(isValidIranianNationalId, 'کد ملی معتبر نیست'))

// Birth date: real calendar date, not in the future, at most 120 years ago
export const birthDateSchema = z.coerce.date({ error: 'تاریخ تولد معتبر نیست' })
  .refine((d) => d.getTime() <= Date.now(), 'تاریخ تولد نمی‌تواند در آینده باشد')
  .refine((d) => d.getTime() >= Date.now() - 120 * 365.25 * 864e5, 'تاریخ تولد معتبر نیست')

export const cuid = z.string().min(1).max(64)
export const codeField = z.string().min(1).max(64)
export const safeText = (max: number) => z.string().trim().max(max)
export const requiredText = (max: number, label: string) =>
  z.string().trim().min(1, `${label} الزامی است`).max(max)

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})
