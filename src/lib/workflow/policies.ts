// ── PHASE 12: Workflow Policy Layer (Timeout / Retry / Failure / Recovery) ──
//
// Declarative, data-driven policies for EVERY registered machine. This module
// is PURE and CLIENT-SAFE (no @/lib/db, no @/server/** imports — same
// discipline as pure.ts, enforced by scripts/frontend-audit.mjs) so the
// browser bundle, unit tests and the governance runtime all resolve the
// same policy data.
//
// Dimensions covered (PHASE 12 mandate):
//   Timeouts  → TimeoutPolicy  (SLA per status: REMIND / ESCALATE / AUTO_TRANSITION)
//   Retries   → RetryPolicy    (system-initiated operations, backoff strategy)
//   Failures  → FailurePolicy  (failure-state taxonomy per machine)
//   Recovery  → FailurePolicy.recoveryActions + engine.executeAdminRecovery
//
// A status may carry a LADDER of policies (24h REMIND → 72h ESCALATE): the
// governance runtime evaluates each policy independently against the entry.
import type { Role } from '@/lib/constants'
import type { EntityType } from './types'

const MIN = 60_000
const HOUR = 3_600_000
const DAY = 24 * HOUR

/* ── Timeout (SLA) policies ───────────────────────────────────────────── */

export type TimeoutLevel = 'REMIND' | 'ESCALATE' | 'AUTO_TRANSITION'

export interface TimeoutPolicy {
  entity: EntityType
  /** Status the instance must currently sit in. */
  status: string
  /** Time allowed in the status before the policy fires. */
  afterMs: number
  level: TimeoutLevel
  /** REMIND: roles to nudge. ESCALATE: ADMIN is always included. */
  notifyRoles?: readonly Role[]
  /** Nudge the record owner (patient) as well. */
  notifyOwner?: boolean
  /** AUTO_TRANSITION: machine action fired by the SYSTEM actor. */
  autoAction?: string
  /** REMIND/AUTO re-fire cooldown (default 24h for REMIND, 5min for AUTO). */
  cooldownMs?: number
  /** REMIND cap before the policy goes silent (default 3). */
  maxReminders?: number
  descFa: string
}

/**
 * Canonical SLA matrix. Values are deliberately conservative for a clinic
 * operating in a single timezone (Asia/Tehran): day-scale SLAs for human
 * queues, hour-scale for machine queues, minutes for gateway sessions.
 * Tuning happens HERE only — never in ad-hoc timers (backend SoT, ED-121).
 */
export const TIMEOUT_POLICIES: readonly TimeoutPolicy[] = [
  // ── CASE (clinical golden path) ──
  { entity: 'CASE', status: 'WAITING_FOR_EXPERT_1', afterMs: 24 * HOUR, level: 'REMIND', notifyRoles: ['EXPERT_1', 'OPERATOR'], descFa: 'پرونده ۲۴ ساعت در صف کارشناس اول مانده است' },
  { entity: 'CASE', status: 'WAITING_FOR_EXPERT_1', afterMs: 72 * HOUR, level: 'ESCALATE', notifyRoles: ['EXPERT_2'], descFa: 'تشدید: پرونده ۳ روز بدون دریافت کارشناس اول' },
  { entity: 'CASE', status: 'EXPERT_1_REVIEW', afterMs: 48 * HOUR, level: 'REMIND', notifyRoles: ['EXPERT_1'], descFa: 'بررسی کارشناس اول ۴۸ ساعت معطل مانده است' },
  { entity: 'CASE', status: 'WAITING_FOR_USER_APPROVAL', afterMs: 72 * HOUR, level: 'REMIND', notifyOwner: true, descFa: 'یادآوری بیمار: تأیید ارزیابی اولیه' },
  { entity: 'CASE', status: 'WAITING_FOR_USER_APPROVAL', afterMs: 7 * DAY, level: 'ESCALATE', descFa: 'تشدید: یک هفته بدون تأیید بیمار' },
  { entity: 'CASE', status: 'WAITING_FOR_EXPERT_1_PRESCRIPTION', afterMs: 48 * HOUR, level: 'REMIND', notifyRoles: ['EXPERT_1'], descFa: 'ثبت نسخه توسط کارشناس اول ۴۸ ساعت طول کشیده است' },
  { entity: 'CASE', status: 'WAITING_FOR_EXPERT_2', afterMs: 24 * HOUR, level: 'REMIND', notifyRoles: ['EXPERT_2'], descFa: 'پرونده ۲۴ ساعت در صف کارشناس دوم مانده است' },
  { entity: 'CASE', status: 'WAITING_FOR_EXPERT_2', afterMs: 72 * HOUR, level: 'ESCALATE', descFa: 'تشدید: ۳ روز در صف کارشناس دوم' },
  { entity: 'CASE', status: 'REVISION_REQUESTED', afterMs: 48 * HOUR, level: 'REMIND', notifyRoles: ['EXPERT_1', 'EXPERT_2'], descFa: 'اصلاح نسخه ۴۸ ساعت معطل مانده است' },
  { entity: 'CASE', status: 'WAITING_FOR_DOCTOR', afterMs: 24 * HOUR, level: 'REMIND', notifyRoles: ['DOCTOR'], descFa: 'پرونده ۲۴ ساعت در صف پزشک مانده است' },
  { entity: 'CASE', status: 'WAITING_FOR_DOCTOR', afterMs: 72 * HOUR, level: 'ESCALATE', descFa: 'تشدید: ۳ روز در صف پزشک' },
  { entity: 'CASE', status: 'PROFORMA_CREATED', afterMs: 72 * HOUR, level: 'REMIND', notifyOwner: true, descFa: 'یادآوری بیمار: تأیید پیش‌فاکتور' },
  { entity: 'CASE', status: 'WAITING_FOR_USER_CONFIRMATION', afterMs: 72 * HOUR, level: 'REMIND', notifyOwner: true, descFa: 'یادآوری بیمار: تأیید نهایی سفارش' },
  { entity: 'CASE', status: 'WAITING_FOR_PAYMENT', afterMs: 72 * HOUR, level: 'REMIND', notifyOwner: true, descFa: 'یادآوری بیمار: تکمیل پرداخت' },
  { entity: 'CASE', status: 'WAITING_FOR_PAYMENT', afterMs: 10 * DAY, level: 'ESCALATE', notifyRoles: ['OPERATOR'], descFa: 'تشدید: ۱۰ روز بدون پرداخت' },
  { entity: 'CASE', status: 'SHIPPED', afterMs: 5 * DAY, level: 'REMIND', notifyRoles: ['OPERATOR'], descFa: 'ثبت تحویل ۵ روز معطل مانده است' },

  // ── ORDER (shop + prescription fulfillment) ──
  { entity: 'ORDER', status: 'PENDING_CONFIRMATION', afterMs: 12 * HOUR, level: 'REMIND', notifyRoles: ['OPERATOR', 'EXPERT_2'], descFa: 'سفارش ۱۲ ساعت در انتظار تأیید مانده است' },
  { entity: 'ORDER', status: 'PENDING_CONFIRMATION', afterMs: 48 * HOUR, level: 'ESCALATE', descFa: 'تشدید: ۲ روز بدون تأیید سفارش' },
  { entity: 'ORDER', status: 'PAYMENT_PENDING', afterMs: 48 * HOUR, level: 'REMIND', notifyOwner: true, descFa: 'یادآوری پرداخت سفارش' },
  { entity: 'ORDER', status: 'CONFIRMED', afterMs: 48 * HOUR, level: 'REMIND', notifyRoles: ['OPERATOR'], descFa: 'سفارش تأییدشده ۴۸ ساعت بدون اقدام مانده است' },
  { entity: 'ORDER', status: 'PREPARING', afterMs: 48 * HOUR, level: 'REMIND', notifyRoles: ['OPERATOR'], descFa: 'آماده‌سازی سفارش ۴۸ ساعت طول کشیده است' },
  { entity: 'ORDER', status: 'READY_TO_SHIP', afterMs: 24 * HOUR, level: 'REMIND', notifyRoles: ['OPERATOR'], descFa: 'سفارش آماده ۲۴ ساعت بدون ارسال مانده است' },
  { entity: 'ORDER', status: 'SHIPPED', afterMs: 7 * DAY, level: 'REMIND', notifyRoles: ['OPERATOR'], descFa: 'ثبت تحویل سفارش ۷ روز معطل مانده است' },

  // ── PAYMENT ──
  // Gateway session expiry: an unverified PENDING gateway payment is failed
  // automatically after 30 minutes (safe — only fires from PENDING; if the
  // callback won the race the transition resolves to INVALID_TRANSITION no-op).
  { entity: 'PAYMENT', status: 'PENDING', afterMs: 30 * MIN, level: 'AUTO_TRANSITION', autoAction: 'GATEWAY_FAIL', cooldownMs: 5 * MIN, descFa: 'انقضای نشست درگاه: پرداخت ناموفق می‌شود' },
  { entity: 'PAYMENT', status: 'AWAITING_VERIFY', afterMs: 48 * HOUR, level: 'REMIND', notifyRoles: ['OPERATOR'], descFa: 'رسید کارت‌به‌کارت ۴۸ ساعت بدون بررسی مانده است' },
  { entity: 'PAYMENT', status: 'AWAITING_VERIFY', afterMs: 7 * DAY, level: 'ESCALATE', descFa: 'تشدید: یک هفته رسید بررسی‌نشده' },

  // ── TICKET ──
  { entity: 'TICKET', status: 'OPEN', afterMs: 24 * HOUR, level: 'REMIND', notifyRoles: ['OPERATOR'], descFa: 'تیکت ۲۴ ساعت بدون پاسخ مانده است' },
  { entity: 'TICKET', status: 'OPEN', afterMs: 72 * HOUR, level: 'ESCALATE', descFa: 'تشدید: ۳ روز بدون پاسخ به تیکت' },
  { entity: 'TICKET', status: 'IN_PROGRESS', afterMs: 48 * HOUR, level: 'REMIND', notifyRoles: ['OPERATOR', 'EXPERT_1'], descFa: 'پیگیری تیکت در جریان ۴۸ ساعت معطل مانده است' },
  { entity: 'TICKET', status: 'WAITING_EXPERT', afterMs: 48 * HOUR, level: 'REMIND', notifyRoles: ['EXPERT_1', 'EXPERT_2'], descFa: 'تیکت در انتظار کارشناس ۴۸ ساعت مانده است' },
  { entity: 'TICKET', status: 'WAITING_USER', afterMs: 72 * HOUR, level: 'REMIND', notifyOwner: true, descFa: 'یادآوری کاربر: پاسخ تیکت پشتیبانی' },

  // ── PRESCRIPTION ──
  { entity: 'PRESCRIPTION', status: 'PENDING_EXPERT_2', afterMs: 24 * HOUR, level: 'REMIND', notifyRoles: ['EXPERT_2'], descFa: 'نسخه ۲۴ ساعت در صف کارشناس دوم مانده است' },
  { entity: 'PRESCRIPTION', status: 'PENDING_DOCTOR', afterMs: 24 * HOUR, level: 'REMIND', notifyRoles: ['DOCTOR'], descFa: 'نسخه ۲۴ ساعت در صف پزشک مانده است' },
  { entity: 'PRESCRIPTION', status: 'REVISION_REQUESTED', afterMs: 48 * HOUR, level: 'REMIND', notifyRoles: ['EXPERT_1', 'EXPERT_2'], descFa: 'اصلاح نسخه ۴۸ ساعت معطل مانده است' },

  // ── AI_REVIEW (human-in-the-loop oversight, FR-AI-06) ──
  { entity: 'AI_REVIEW', status: 'PENDING_REVIEW', afterMs: 12 * HOUR, level: 'REMIND', notifyRoles: ['EXPERT_1', 'EXPERT_2', 'DOCTOR'], descFa: 'تحلیل AI ۱۲ ساعت بدون بازبینی انسانی مانده است' },
  { entity: 'AI_REVIEW', status: 'PENDING_REVIEW', afterMs: 48 * HOUR, level: 'ESCALATE', descFa: 'تشدید: تحلیل AI ۲ روز بدون بازبینی' },

  // ── FOLLOWUP ──
  { entity: 'FOLLOWUP', status: 'DUE', afterMs: 24 * HOUR, level: 'REMIND', notifyRoles: ['OPERATOR', 'EXPERT_1'], descFa: 'پیگیری سررسیدشده ۲۴ ساعت انجام نشده است' },
  { entity: 'FOLLOWUP', status: 'OVERDUE', afterMs: 72 * HOUR, level: 'ESCALATE', descFa: 'تشدید: پیگیری ۳ روز معوق' },

  // ── SHIPMENT ──
  { entity: 'SHIPMENT', status: 'PREPARING', afterMs: 24 * HOUR, level: 'REMIND', notifyRoles: ['OPERATOR'], descFa: 'آماده‌سازی مرسوله ۲۴ ساعت طول کشیده است' },
  { entity: 'SHIPMENT', status: 'SHIPPED', afterMs: 5 * DAY, level: 'REMIND', notifyRoles: ['OPERATOR'], descFa: 'ثبت تحویل مرسوله ۵ روز معطل مانده است' },
  { entity: 'SHIPMENT', status: 'IN_TRANSIT', afterMs: 7 * DAY, level: 'ESCALATE', notifyRoles: ['OPERATOR'], descFa: 'تشدید: مرسوله ۷ روز در راه است' },

  // ── DELETION_REQUEST (privacy compliance deadline) ──
  { entity: 'DELETION_REQUEST', status: 'PENDING', afterMs: 48 * HOUR, level: 'REMIND', notifyRoles: ['ADMIN'], descFa: 'درخواست حذف داده ۴۸ ساعت بدون بررسی مانده است' },
  { entity: 'DELETION_REQUEST', status: 'PENDING', afterMs: 7 * DAY, level: 'ESCALATE', notifyRoles: ['ADMIN'], descFa: 'تشدید: مهلت حریم خصوصی — یک هفته' },
  { entity: 'DELETION_REQUEST', status: 'PROCESSING', afterMs: 48 * HOUR, level: 'REMIND', notifyRoles: ['ADMIN'], descFa: 'پردازش درخواست حذف ۴۸ ساعت معطل مانده است' },

  // ── MEDICAL_IMAGE (clinical AI input gate) ──
  { entity: 'MEDICAL_IMAGE', status: 'PENDING', afterMs: 1 * HOUR, level: 'REMIND', notifyRoles: ['OPERATOR'], descFa: 'اعتبارسنجی تصویر یک ساعت معطل مانده است (کارگر پردازش گیر کرده؟)' },
  { entity: 'MEDICAL_IMAGE', status: 'REJECTED', afterMs: 72 * HOUR, level: 'REMIND', notifyOwner: true, descFa: 'یادآوری بیمار: بارگذاری مجدد تصویر پذیرفته‌نشده' },

  // ── INVOICE ──
  { entity: 'INVOICE', status: 'SENT', afterMs: 72 * HOUR, level: 'REMIND', notifyOwner: true, descFa: 'یادآوری بیمار: بررسی پیش‌فاکتور' },
  { entity: 'INVOICE', status: 'CONFIRMED', afterMs: 7 * DAY, level: 'REMIND', notifyRoles: ['OPERATOR'], descFa: 'فاکتور تأییدشده ۷ روز بدون پرداخت مانده است' },
]

/* ── Retry policies (system-initiated operations) ─────────────────────── */

export interface RetryPolicy {
  entity: EntityType
  /** Operation family the policy governs. */
  scope: 'AUTO_TRANSITION' | 'GOVERNANCE_NOTIFY' | 'BATCH_TRANSITION'
  maxAttempts: number
  backoff: 'LINEAR' | 'EXPONENTIAL'
  baseMs: number
  descFa: string
}

export const RETRY_POLICIES: readonly RetryPolicy[] = [
  { entity: 'PAYMENT', scope: 'AUTO_TRANSITION', maxAttempts: 3, backoff: 'EXPONENTIAL', baseMs: 2_000, descFa: 'گذار خودکار درگاه با پشتیبان نمایی' },
  { entity: 'FOLLOWUP', scope: 'BATCH_TRANSITION', maxAttempts: 2, backoff: 'LINEAR', baseMs: 5_000, descFa: 'اسکن سررسید پیگیری‌ها' },
  { entity: 'MEDICAL_IMAGE', scope: 'BATCH_TRANSITION', maxAttempts: 3, backoff: 'EXPONENTIAL', baseMs: 2_000, descFa: 'اعتبارسنجی تصویر توسط کارگر' },
]

/** Default retry for any (entity, scope) pair without an explicit policy. */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  entity: 'CASE' as EntityType, scope: 'AUTO_TRANSITION', maxAttempts: 3, backoff: 'EXPONENTIAL', baseMs: 2_000,
  descFa: 'سیاست پیش‌فرض سیستم',
}

/* ── Failure & recovery taxonomy ───────────────────────────────────────── */

export interface FailurePolicy {
  entity: EntityType
  /** Statuses that represent a failed/aborted outcome (vs. success-terminal). */
  failureStatuses: readonly string[]
  /** Machine actions available as a documented recovery path. */
  recoveryActions: readonly string[]
  /** Whether ADMIN force-recovery (engine.executeAdminRecovery) is allowed. */
  forceRecovery: boolean
  descFa: string
}

export const FAILURE_POLICIES: readonly FailurePolicy[] = [
  { entity: 'CASE', failureStatuses: ['CANCELLED'], recoveryActions: [], forceRecovery: true, descFa: 'لغو پرونده؛ بازیابی فقط از طریق فرار اضطراری مدیر' },
  { entity: 'PRESCRIPTION', failureStatuses: ['REJECTED', 'SUPERSEDED'], recoveryActions: ['REVISE'], forceRecovery: true, descFa: 'نسخه رد/جایگزین‌شده؛ چرخه از نسخه جدید آغاز می‌شود' },
  { entity: 'ORDER', failureStatuses: ['CANCELLED', 'REFUNDED'], recoveryActions: ['REFUND'], forceRecovery: true, descFa: 'سفارش لغو/بازپرداخت‌شده' },
  { entity: 'PAYMENT', failureStatuses: ['FAILED', 'REJECTED'], recoveryActions: ['RETRY', 'REQUEST_INFO'], forceRecovery: true, descFa: 'پرداخت ناموفق؛ بیمار می‌تواند RETRY کند' },
  { entity: 'SHIPMENT', failureStatuses: ['FAILED'], recoveryActions: [], forceRecovery: true, descFa: 'ارسال ناموفق؛ ثبت مجدد ارسال لازم است' },
  { entity: 'TICKET', failureStatuses: [], recoveryActions: ['REOPEN'], forceRecovery: true, descFa: 'تیکت بسته‌شده با REOPEN کاربر باز می‌شود' },
  { entity: 'FOLLOWUP', failureStatuses: ['CANCELLED'], recoveryActions: [], forceRecovery: true, descFa: 'پیگیری لغو‌شده' },
  { entity: 'AI_REVIEW', failureStatuses: ['REJECTED'], recoveryActions: ['RESET'], forceRecovery: true, descFa: 'تحلیل AI رد‌شده؛ RESET مدیر بازبینی را باز می‌گرداند' },
  { entity: 'DELETION_REQUEST', failureStatuses: ['REJECTED'], recoveryActions: [], forceRecovery: true, descFa: 'درخواست حذف رد‌شده؛ کاربر درخواست جدید ثبت می‌کند' },
  { entity: 'MEDICAL_IMAGE', failureStatuses: ['REJECTED'], recoveryActions: ['REVALIDATE'], forceRecovery: true, descFa: 'تصویر رد‌شده؛ بیمار تصویر جدید بارگذاری می‌کند' },
  { entity: 'INVOICE', failureStatuses: ['CANCELLED'], recoveryActions: [], forceRecovery: true, descFa: 'فاکتور لغو‌شده؛ صدور مجدد صورت‌حساب' },
]

/* ── Pure resolvers ───────────────────────────────────────────────────── */

/** All timeout policies for one (entity, status). */
export function timeoutPoliciesFor(entity: EntityType, status: string): TimeoutPolicy[] {
  return TIMEOUT_POLICIES.filter((p) => p.entity === entity && p.status === status)
}

/** Statuses of an entity that carry at least one timeout policy. */
export function timeoutPolicyStatuses(entity: EntityType): string[] {
  return [...new Set(TIMEOUT_POLICIES.filter((p) => p.entity === entity).map((p) => p.status))]
}

/** Snapshot of the catalog (admin introspection / docs / tests). */
export function allTimeoutPolicies(): TimeoutPolicy[] {
  return [...TIMEOUT_POLICIES]
}

export function retryPolicyFor(entity: EntityType, scope: RetryPolicy['scope']): RetryPolicy {
  return RETRY_POLICIES.find((p) => p.entity === entity && p.scope === scope)
    ?? { ...DEFAULT_RETRY_POLICY, entity, scope }
}

export function failurePolicyFor(entity: EntityType): FailurePolicy {
  return FAILURE_POLICIES.find((p) => p.entity === entity)
    ?? { entity, failureStatuses: [], recoveryActions: [], forceRecovery: true, descFa: '—' }
}

/* ── SLA arithmetic + governance decision (pure, unit-tested) ─────────── */

/** Projection of a WorkflowState row the decision function needs. */
export interface GovernanceEntry {
  status: string
  enteredAt: Date
  lastRemindedAt?: Date | null
  reminderCount: number
  escalatedAt?: Date | null
}

export type GovernanceDecision =
  | { fire: true; level: TimeoutLevel; policy: TimeoutPolicy }
  | { fire: false; reason: 'NOT_DUE' | 'COOLDOWN' | 'MAX_REMINDERS' | 'ALREADY_ESCALATED' | 'COOLDOWN_AUTO' }

/** Absolute deadline = enteredAt + afterMs. */
export function slaDeadline(entry: Pick<GovernanceEntry, 'enteredAt'>, policy: TimeoutPolicy): Date {
  return new Date(entry.enteredAt.getTime() + policy.afterMs)
}

/** Milliseconds past the deadline (negative when still inside the SLA). */
export function breachMs(entry: Pick<GovernanceEntry, 'enteredAt'>, policy: TimeoutPolicy, now: Date): number {
  return now.getTime() - slaDeadline(entry, policy).getTime()
}

/**
 * Should THIS policy fire for THIS entry at THIS time? Pure — the runtime
 * (governance.ts) owns all DB writes and side effects.
 *
 * Ladder semantics:
 *  - REMIND  fires while overdue, respecting cooldown + maxReminders.
 *  - ESCALATE fires ONCE (escalatedAt is the latch).
 *  - AUTO_TRANSITION re-fires on a short cooldown (5 min default) so a
 *    transient failure retries with backoff — idempotency is guaranteed by
 *    the machine graph itself (a moved entity no longer matches the policy).
 */
export function governanceDecision(entry: GovernanceEntry, policy: TimeoutPolicy, now: Date): GovernanceDecision {
  if (breachMs(entry, policy, now) < 0) return { fire: false, reason: 'NOT_DUE' }

  if (policy.level === 'ESCALATE') {
    if (entry.escalatedAt) return { fire: false, reason: 'ALREADY_ESCALATED' }
    return { fire: true, level: policy.level, policy }
  }

  if (policy.level === 'AUTO_TRANSITION') {
    const cooldown = policy.cooldownMs ?? 5 * MIN
    const lastAttempt = entry.lastRemindedAt?.getTime() ?? 0
    if (now.getTime() - lastAttempt < cooldown) return { fire: false, reason: 'COOLDOWN_AUTO' }
    return { fire: true, level: policy.level, policy }
  }

  // REMIND
  const cooldown = policy.cooldownMs ?? 24 * HOUR
  const maxReminders = policy.maxReminders ?? 3
  if (entry.reminderCount >= maxReminders) return { fire: false, reason: 'MAX_REMINDERS' }
  if (entry.lastRemindedAt && now.getTime() - entry.lastRemindedAt.getTime() < cooldown) {
    return { fire: false, reason: 'COOLDOWN' }
  }
  return { fire: true, level: policy.level, policy }
}

/** Backoff delay before retry attempt N (1-based), in ms. */
export function computeBackoffMs(policy: RetryPolicy, attempt: number): number {
  const n = Math.max(1, attempt)
  return policy.backoff === 'EXPONENTIAL'
    ? policy.baseMs * Math.pow(2, n - 1)
    : policy.baseMs * n
}

/** Human-readable SLA label for docs/admin UI (Persian). */
export function slaLabel(policy: TimeoutPolicy): string {
  const ms = policy.afterMs
  if (ms % DAY === 0) return `${ms / DAY} روز`
  if (ms % HOUR === 0) return `${ms / HOUR} ساعت`
  if (ms % MIN === 0) return `${ms / MIN} دقیقه`
  return `${ms} میلی‌ثانیه`
}
