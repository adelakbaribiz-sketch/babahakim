// Work-queue definitions — the single source for "which case statuses are
// whose work". Client-safe (no db import): the dashboard read model, the
// queue page filters and the tests all read the same table, so a status can
// never be actionable for a role yet missing from that role's queue (the
// doctor-reject bug left cases in a status no queue listed).

export interface QueueDef {
  key: string
  fa: string
  en: string
  statuses: readonly string[]
}

export const QUEUES: readonly QueueDef[] = [
  { key: 'expert1', fa: 'صف کارشناس اول', en: 'Expert 1 queue', statuses: ['WAITING_FOR_EXPERT_1', 'EXPERT_1_REVIEW', 'WAITING_FOR_EXPERT_1_PRESCRIPTION'] },
  { key: 'returned', fa: 'برگشتی / نیازمند اصلاح', en: 'Returned for revision', statuses: ['REVISION_REQUESTED'] },
  { key: 'expert2', fa: 'صف کارشناس دوم', en: 'Expert 2 queue', statuses: ['WAITING_FOR_EXPERT_2'] },
  { key: 'doctor', fa: 'منتظر بررسی پزشک', en: 'Awaiting doctor', statuses: ['WAITING_FOR_DOCTOR'] },
  { key: 'patient', fa: 'منتظر اقدام بیمار', en: 'Awaiting patient', statuses: ['WAITING_FOR_USER_APPROVAL', 'PROFORMA_CREATED', 'WAITING_FOR_USER_CONFIRMATION', 'WAITING_FOR_PAYMENT'] },
  { key: 'fulfilment', fa: 'آماده‌سازی و ارسال', en: 'Fulfilment', statuses: ['PRESCRIPTION_APPROVED', 'PREPARING_ORDER', 'PAYMENT_CONFIRMED', 'PREPARING_SHIPMENT', 'SHIPPED'] },
  { key: 'followup', fa: 'در انتظار پیگیری', en: 'Awaiting follow-up', statuses: ['DELIVERED', 'FOLLOW_UP', 'REFERRED_AGAIN'] },
] as const

const byKey = (k: string) => QUEUES.find((q) => q.key === k)!.statuses

/** Statuses each staff role must act on (dashboard "work queue"). */
export const ROLE_QUEUE_STATUSES: Record<string, readonly string[]> = {
  EXPERT_1: [...byKey('expert1'), ...byKey('returned')],
  EXPERT_2: [...byKey('expert2'), 'PRESCRIPTION_APPROVED'],
  DOCTOR: byKey('doctor'),
}

export function queueStatuses(key: string): readonly string[] | null {
  return QUEUES.find((q) => q.key === key)?.statuses ?? null
}
