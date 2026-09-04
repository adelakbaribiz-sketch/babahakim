// ── BabaHakim Backend · Bootstrap (PHASE 08, ED-99/102) ────────────────────
// One-time wiring of cross-cutting side effects. Imported lazily by the
// handler on first request (and by tests). Global-guarded for HMR.
// No top-level await — dynamic imports stay inside subscriber callbacks.
//   events → notification fan-out (lib/notify) + cache invalidation
//   jobs   → AI analysis (async, out of the request path) + follow-up scan
import { subscribe, Events } from '@/server/infrastructure/events'
import { registerJob, setDeadLetterHook, scheduleRecurring, enqueue } from '@/server/infrastructure/jobs'
import { logger } from '@/server/core/logger'

// guard key is versioned: bumping it re-runs wiring after HMR when shared
// singletons changed shape (e.g. cache backing store) — cheap and safe (idempotent)
// v4: PHASE 11 adds AI/ML wiring (feedback loop, drift monitor, prompt seed)
const BOOTSTRAP_KEY = '__bhBootstrapped_v4'
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

  // ── PHASE 10: media engine wiring (ED-116) ─────────────────────────────
  // ready product images invalidate the catalog cache (same ED-98 path)
  subscribe(Events.MediaFileReady, (e) => {
    const p = e.payload as { category?: string }
    if (p?.category === 'PRODUCT_IMAGE') return clearCatalog()
  })
  // quarantined uploads: notify the owner (FILE_QUARANTINED) + operators
  subscribe(Events.MediaFileInfected, async (e) => {
    const p = e.payload as { ownerId: string; fileId: string; findings?: string[] }
    await notify(p.ownerId, 'FILE_QUARANTINED', { link: '/records' })
    await notifyOperators('TICKET_UPDATED', `MEDIA_QUARANTINE:${p.fileId}`)
  })

  // media worker job: scan → renditions → metadata → READY (ED-114)
  registerJob('media-process', async (payload: { fileId: string; versionId: string }) => {
    const { processFile } = await import('@/server/infrastructure/media/pipeline')
    await processFile(payload.fileId, payload.versionId)
  })

  // media lifecycle: inbox TTL / TEMPORARY expiry / trash purge (ED-117)
  registerJob('media-lifecycle', async () => {
    const { runLifecycleTick } = await import('@/server/infrastructure/media/lifecycle')
    await runLifecycleTick()
  })
  scheduleRecurring('media-lifecycle', 5 * 60_000)

  // ── jobs: async AI analysis (ED-102 — out of the request path) ───────────
  registerJob('ai-analysis', async (payload: { caseId: string; imageId: string }) => {
    const { runAIAnalysis } = await import('@/server/infrastructure/ai/pipeline')
    const result = await runAIAnalysis(payload.caseId, payload.imageId)
    const { db } = await import('@/lib/db')
    await db.caseEvent.create({ data: { caseId: payload.caseId, action: 'AI_RUN', comment: `تحلیل اولیه توسط ${result.modelName}@v${result.modelVersion} انجام شد` } })
  })
  registerJob('notify-operators', async (payload: { event: string; extraFa?: string }) => {
    await notifyOperators(payload.event, payload.extraFa)
  })

  // ── PHASE 11: AI/ML jobs — evaluation + monitor (drift/cost/bias) ────────
  registerJob('ai-evaluation', async (payload: { modelId?: string; datasetId?: string; includeDraft?: boolean; createdById?: string }) => {
    const { evaluateModel } = await import('@/server/infrastructure/ai/evaluation')
    await evaluateModel(payload)
  })
  registerJob('ai-monitor', async () => {
    const { runDriftCheck, captureBaseline } = await import('@/server/infrastructure/ai/monitoring')
    const { costStats } = await import('@/server/infrastructure/ai/cost')
    // drift (captures baseline on first run for a model with ≥10 analyses)
    const { db } = await import('@/lib/db')
    const model = await db.aIModel.findFirst({ where: { isActive: true } })
    if (model) {
      const check = await runDriftCheck()
      if (!check.checked && check.reason === 'NO_BASELINE') await captureBaseline(model.id)
    }
    await costStats() // budget guard (publishes AiBudgetAlert over threshold)
  })
  scheduleRecurring('ai-monitor', 5 * 60_000)

  // ── PHASE 11: feedback loop — reviews land as dataset labels ─────────────
  subscribe(Events.AiReviewDecided, async (e) => {
    const p = e.payload as { analysisId: string; decision: 'ACCEPTED' | 'MODIFIED' | 'REJECTED'; reviewerRole: 'EXPERT_1' | 'EXPERT_2' | 'DOCTOR'; reviewerId: string; comment?: string; corrections?: { indicator: string; value: string }[] }
    const { recordReviewLabel } = await import('@/server/infrastructure/ai/datasets')
    await recordReviewLabel({
      analysisId: p.analysisId, reviewerRole: p.reviewerRole, reviewerId: p.reviewerId,
      decision: p.decision, comment: p.comment, corrections: p.corrections,
    })
  })

  // ── PHASE 11: MLOps events → admin notifications ──────────────────────
  subscribe(Events.AiDriftDetected, async (e) => {
    const p = e.payload as { modelName: string; features: { feature: string; psi: number }[] }
    const extraFa = `DRIFT ${p.modelName}: ${p.features.map((f) => `${f.feature} Ψ=${f.psi}`).join('، ')}`
    await notifyOperators('TICKET_UPDATED', extraFa)
  })
  subscribe(Events.AiEvaluationCompleted, () => { /* logged by evaluation; admin UI polls reports */ })
  subscribe(Events.AiBudgetAlert, async (e) => {
    const p = e.payload as { total: number; cap: number; ratio: number; severity: string }
    if (p.severity === 'EXCEEDED') {
      await notifyOperators('TICKET_UPDATED', `AI_BUDGET_EXCEEDED: ${p.total}/${p.cap}`)
    }
  })

  // PHASE 11: seed prompt registry rows (idempotent, immutable versions).
  // Lazy one-shot job — keeps the no-top-level-await discipline: the code
  // registry is the source of truth; DB rows are the admin-visible copy.
  registerJob('ai-prompt-seed', async () => {
    const { ensurePromptsSeeded } = await import('@/server/infrastructure/ai/prompts')
    await ensurePromptsSeeded()
  })
  enqueue('ai-prompt-seed', {}, { maxAttempts: 3, backoffMs: 5000 })

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
      // media jobs that exhausted retries surface as FAILED (lifecycle TTL
      // then removes any staged bytes — no zombie PENDING rows)
      if (job.type === 'media-process') {
        const payload = job.payload as { fileId: string }
        await db.storedFile.update({
          where: { id: payload.fileId },
          data: { status: 'FAILED', rejectionReason: 'PROCESSING_FAILED' },
        }).catch(() => { /* file may already be gone */ })
      }
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

  logger.info('backend bootstrap complete', { subscribers: 16, jobs: 7 })
}
