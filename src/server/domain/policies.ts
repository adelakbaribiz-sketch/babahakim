// ── BabaHakim Domain Layer (PHASE 08, ED-93) ───────────────────────────────
// PURE business rules — no HTTP, no Prisma, no Next imports. Policies are
// the single source of truth for invariants; application services enforce
// them inside transactional boundaries and unit-test them directly.

import { BusinessRuleError, ValidationError } from '@/server/core/errors'

// ════════════════════════════ ORDER / CHECKOUT ════════════════════════════

export const SHOP_SHIPPING_COST = 50_000 // ریال — EDIT: خرده‌فروشی (previously hard-coded in 3 routes)

export interface CartLine { productId: string; unitPrice: number; quantity: number; stock: number; nameFa: string; nameEn: string; requiresPrescription: boolean }

export function computeTotals(lines: Array<{ unitPrice: number; quantity: number }>, shippingCost = SHOP_SHIPPING_COST) {
  const subtotal = lines.reduce((s, i) => s + i.unitPrice * i.quantity, 0)
  return { subtotal, shippingCost, total: subtotal + shippingCost }
}

/** Stock guard — throws before any write (ED-104: no negative stock). */
export function assertStockAvailable(lines: CartLine[]): void {
  for (const l of lines) {
    if (l.stock < l.quantity) {
      throw new BusinessRuleError(`موجودی «${l.nameFa}» کافی نیست (موجودی: ${l.stock})`, { productId: l.productId, stock: l.stock, requested: l.quantity })
    }
  }
}

export function assertCartHasItems(count: number): void {
  if (count === 0) throw new ValidationError('سبد خرید خالی است')
}

// ════════════════════════════ CASE CREATION ═══════════════════════════════

export interface CaseImageRef { ownerId: string; type: string; status: string }

export function assertCaseImageUsable(image: CaseImageRef | null, patientId: string): void {
  if (!image) throw new BusinessRuleError('تصویر یافت نشد یا متعلق به شما نیست', undefined)
  if (image.ownerId !== patientId) throw new BusinessRuleError('تصویر یافت نشد یا متعلق به شما نیست')
  if (image.type !== 'TONGUE') throw new ValidationError('تصویر باید از نوع زبان باشد')
  if (image.status !== 'VALIDATED') throw new ValidationError('کیفیت تصویر تأیید نشده است؛ لطفاً تصویر جدیدی ارسال کنید')
}

export function assertQuestionnaireCompleted(hasResponse: boolean): void {
  if (!hasResponse) throw new ValidationError('قبل از ایجاد پرونده، پرسشنامه مزاج‌شناسی را تکمیل کنید')
}

// ════════════════════════════ QUESTIONNAIRE SCORING ═══════════════════════

export type MizajScores = { HOT: number; COLD: number; WET: number; DRY: number }

export function emptyScores(): MizajScores {
  return { HOT: 0, COLD: 0, WET: 0, DRY: 0 }
}

/** Minimum answer coverage — 60% of the active questionnaire's questions. */
export function minAnswersRequired(totalQuestions: number): number {
  return Math.ceil(totalQuestions * 0.6)
}

export function assertEnoughAnswers(valid: number, totalQuestions: number): void {
  if (valid < minAnswersRequired(totalQuestions)) {
    throw new ValidationError('لطفاً به همه سؤالات پاسخ دهید | Please answer all questions')
  }
}

/** Mizaj determination — pure mapping from 4-dimension scores to labels. */
export function determineMizaj(scores: MizajScores): { mizajFa: string; mizajEn: string; summaryFa: string } {
  const { HOT: heat, COLD: cold, WET: wet, DRY: dry } = scores
  const temp = Math.abs(heat - cold) <= 3 ? 'BALANCED' : heat > cold ? 'HOT' : 'COLD'
  const moist = Math.abs(wet - dry) <= 3 ? 'BALANCED' : wet > dry ? 'WET' : 'DRY'

  let mizajFa = 'معتدل', mizajEn = 'Balanced'
  if (temp === 'HOT' && moist === 'DRY') { mizajFa = 'گرم و خشک'; mizajEn = 'Hot & Dry' }
  else if (temp === 'HOT' && moist === 'WET') { mizajFa = 'گرم و تر'; mizajEn = 'Hot & Wet' }
  else if (temp === 'COLD' && moist === 'DRY') { mizajFa = 'سرد و خشک'; mizajEn = 'Cold & Dry' }
  else if (temp === 'COLD' && moist === 'WET') { mizajFa = 'سرد و تر'; mizajEn = 'Cold & Wet' }
  else if (temp === 'HOT') { mizajFa = 'غالباً گرم'; mizajEn = 'Predominantly Hot' }
  else if (temp === 'COLD') { mizajFa = 'غالباً سرد'; mizajEn = 'Predominantly Cold' }
  else if (moist === 'DRY') { mizajFa = 'غالباً خشک'; mizajEn = 'Predominantly Dry' }
  else if (moist === 'WET') { mizajFa = 'غالباً تر'; mizajEn = 'Predominantly Wet' }

  const summaryFa = `امتیازها — گرما: ${heat}، برودت: ${cold}، رطوبت: ${wet}، خشکی: ${dry}`
  return { mizajFa, mizajEn, summaryFa }
}

// ════════════════════════════ PAYMENT ═════════════════════════════════════

export function assertOrderPayable(orderStatus: string): void {
  if (['PAID', 'SHIPPED', 'DELIVERED'].includes(orderStatus)) {
    throw new BusinessRuleError('این سفارش قبلاً پرداخت شده است')
  }
}

export function assertNoActivePayment(activePaymentExists: boolean): void {
  if (activePaymentExists) throw new BusinessRuleError('برای این سفارش پرداخت فعالی وجود دارد')
}
