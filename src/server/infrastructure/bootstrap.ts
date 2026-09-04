// ── BabaHakim Backend · Bootstrap (PHASE 08, ED-99/102) ────────────────────
// One-time wiring of cross-cutting side effects. Imported lazily by the
// handler on first request (and by tests). Global-guarded for HMR.
// No top-level await — dynamic imports stay inside subscriber callbacks.
//   events → notification fan-out (lib/notify) + cache invalidation
//   jobs   → AI analysis (async, out of the request path) + follow-up scan
import { subscribe, Events } from '@/server/infrastructure/events'
import { registerJob, setDeadLetterHook, scheduleRecurring } from '@/server/infrastructure/jobs'
import { logger } from '@/server/core/logger'

// guard key is versioned: bumping it re-runs wiring after HMR when shared
// singletons changed shape (e.g. cache backing store) — cheap and safe (idempotent)
const BOOTSTRAP_KEY = '__bhBootstrapped_v2'
const g = globalThis as unknown as { [BOOTSTRAP_KEY]?: boolean }

/** no-op marker — importing the module runs the wiring below exactly once per version. */
export function ensureBackendBootstrapped(): void {
  if (!g[BOOTSTRAP_KEY]) logger.warn('bootstrap re-entry — this should be impossible')
}

async function notify(userId: string, event: string, opts: Record<string, unknown>) {
  const m = await import('@/lib/notify')
  await m.notify(userId, event as never, opts)
}

async function notifyOperators(event: string, extraFa?: string) {
  const { db } = await import('@/lib/db')
  const operators = await db.user.findMany({ where: { role: 'OPERATOR', isActive: true }, select: { id: true } })
  for (const op of operators) await notify(op.id, event, { extraFa })
}

if (!g[BOOTSTRAP_KEY]) {
  g[BOOTSTRAP_KEY] = true

  // ── events → notifications (ED-99: services never call notify directly) ──
  subscribe(Events.UserRegistered, (e) => notify(e.payload as string, 'REGISTERED', { sms: true }))
  subscribe(Events.ImageUploaded, (e) => {
    const p = e.payload as { userId: string }
    return notify(p.userId, 'IMAGE_RECEIVED', { link: '/records' })
  })
  subscribe(Events.QuestionnaireSubmitted, (e) => notify(e.payload as string, 'QUESTIONNAIRE_DONE', { link: '/records' }))
  subscribe(Events.ProfileUpdated, (e) => notify(e.payload as string, 'PROFILE_COMPLETED', {}))
  subscribe(Events.OrderCreated, (e) => {
    const p = e.payload as { userId: string }
    return notify(p.userId, 'NEW_ORDER', { link: '/orders' })
  })
  subscribe(Events.TicketCreated, (e) => {
    const p = e.payload as { code: string }
    return notifyOperators('TICKET_UPDATED', p.code)
  })
  subscribe(Events.TicketReplied, (e) => {
    const p = e.payload as { userId: string; code: string }
    return notify(p.userId, 'TICKET_UPDATED', { extraFa: p.code })
  })

  // ── events → cache invalidation (catalog freshness, ED-98) ───────────────
  // reads the globalThis-backed map at EVENT time (HMR-proof: never closes
  // over a module-generation cacheStore instance)
  const clearCatalog = async () => {
    const map = (globalThis as unknown as { __bhCacheMap?: Map<string, unknown> }).__bhCacheMap
    if (!map) return
    for (const k of [...map.keys()]) if (k.startsWith('catalog:products:')) map.delete(k)
  }
  subscribe(Events.ProductCatalogChanged, clearCatalog)
  subscribe(Events.PriceChanged, clearCatalog)

  // ── jobs: async AI analysis (ED-102 — out of the request path) ───────────
  registerJob('ai-analysis', async (payload: { caseId: string; imageId: string }) => {
    const { runAIAnalysis } = await import('@/lib/ai/run')
    await runAIAnalysis(payload.caseId, payload.imageId)
    const { db } = await import('@/lib/db')
    await db.caseEvent.create({ data: { caseId: payload.caseId, action: 'AI_RUN', comment: 'تحلیل اولیه توسط TongueModelV1 انجام شد' } })
    await (await import('@/server/infrastructure/events')).publish(Events.AiAnalysisCompleted, payload)
  })
  registerJob('notify-operators', async (payload: { event: string; extraFa?: string }) => {
    await notifyOperators(payload.event, payload.extraFa)
  })

  // ── recurring job: follow-up buckets DUE/OVERDUE scan (ED-102) ───────────
  registerJob('followup-scan', async () => {
    const { db } = await import('@/lib/db')
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const tomorrow = new Date(today.getTime() + 86_400_000)
    await db.followUp.updateMany({ where: { status: 'PENDING', dueDate: { lt: today } }, data: { status: 'OVERDUE' } })
    await db.followUp.updateMany({ where: { status: 'PENDING', dueDate: { gte: today, lt: tomorrow } }, data: { status: 'DUE' } })
  })
  scheduleRecurring('followup-scan', 5 * 60_000)

  // dead-letter hook → audit log (system-visible operational trail)
  setDeadLetterHook(async (job, error) => {
    try {
      const { db } = await import('@/lib/db')
      await db.auditLog.create({
        data: {
          userId: null, action: 'JOB_DEAD_LETTER', entity: 'Job', entityId: job.id,
          oldValues: null,
          newValues: JSON.stringify({ type: job.type, attempts: job.attempts, error: error instanceof Error ? error.message : String(error) }),
          ip: 'system', device: 'System', sensitive: false,
        },
      })
    } catch { /* audit best-effort */ }
  })

  logger.info('backend bootstrap complete', { subscribers: 9, jobs: 3 })
}
