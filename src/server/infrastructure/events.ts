// ── BabaHakim Backend · Domain Event Bus (PHASE 08, ED-99) ────────────────
// In-process pub/sub. Application services emit domain events instead of
// calling notify/audit/cache directly → side effects are decoupled and
// future-proof (swap to Redis Streams / NATS without touching services).
// Subscriber errors are isolated: a failing side effect NEVER fails the
// business transaction that emitted the event.
import { childLogger } from '@/server/core/logger'

const log = childLogger({ svc: 'event-bus' })

export interface DomainEvent<P = unknown> {
  readonly name: string
  readonly payload: P
  readonly at: string
  readonly reqId?: string
}

export type EventHandler = (event: DomainEvent) => Promise<void> | void

/** Canonical event catalog (aligned with ARCHITECTURE.md §7 core subset). */
export const Events = {
  UserRegistered: 'user.registered',
  UserLogin: 'user.login',
  CaseCreated: 'case.created',
  CaseTransitioned: 'case.transitioned',
  AiAnalysisRequested: 'ai.analysis.requested',
  AiAnalysisCompleted: 'ai.analysis.completed',
  OrderCreated: 'order.created',
  OrderPaid: 'order.paid',
  PaymentStarted: 'payment.started',
  PaymentVerified: 'payment.verified',
  ShipmentDelivered: 'shipment.delivered',
  ProductCatalogChanged: 'catalog.products.changed',
  PriceChanged: 'catalog.price.changed',
  TicketCreated: 'ticket.created',
  TicketReplied: 'ticket.replied',
  ProfileUpdated: 'patient.profile.updated',
  QuestionnaireSubmitted: 'questionnaire.submitted',
  ImageUploaded: 'image.uploaded',
  // PHASE 10 — media engine events (ED-116)
  MediaFileReady: 'media.file.ready',
  MediaFileInfected: 'media.file.infected',
  MediaFilePurged: 'media.file.purged',
  // PHASE 11 — AI/ML engineering events (feedback loop + MLOps)
  AiReviewDecided: 'ai.review.decided', // human label landed on an AI analysis
  AiEvaluationCompleted: 'ai.evaluation.completed',
  AiDriftDetected: 'ai.drift.detected',
  AiBudgetAlert: 'ai.cost.budget',
} as const

export type EventName = (typeof Events)[keyof typeof Events]

// global singleton survives Next.js dev HMR
const g = globalThis as unknown as { __bhEventBus?: { handlers: Map<string, Set<EventHandler>> } }
const bus = g.__bhEventBus ?? { handlers: new Map<string, Set<EventHandler>>() }
g.__bhEventBus = bus

export function subscribe(eventName: string, handler: EventHandler): () => void {
  let set = bus.handlers.get(eventName)
  if (!set) { set = new Set(); bus.handlers.set(eventName, set) }
  set.add(handler)
  return () => set!.delete(handler)
}

/** Publish is fire-and-forget: handler failures are logged, never rethrown. */
export async function publish(name: string, payload: unknown, reqId?: string): Promise<void> {
  const event: DomainEvent = { name, payload, at: new Date().toISOString(), reqId }
  const handlers = bus.handlers.get(name)
  if (!handlers?.size) return
  await Promise.all(
    [...handlers].map(async (h) => {
      try {
        await h(event)
      } catch (e) {
        log.error('event handler failed', { event: name, error: e instanceof Error ? e.message : String(e) })
      }
    }),
  )
}
