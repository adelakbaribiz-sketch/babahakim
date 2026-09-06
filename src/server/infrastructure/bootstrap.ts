// ── BabaHakim Backend · Bootstrap (PHASE 08, ED-99/102) ────────────────────
// One-time wiring of cross-cutting side effects. Imported lazily by the
// handler on first request (and by tests). Global-guarded for HMR.
// No top-level await — dynamic imports stay inside subscriber callbacks.
//   events → notification fan-out (lib/notify) + cache invalidation
//   jobs   → AI analysis (async, out of the request path) + follow-up scan
import { subscribe, Events } from '@/server/infrastructure/events'
import { registerJob, setDeadLetterHook, scheduleRecurring, enqueue, runJobRecovery, refreshMirrorFromDb } from '@/server/infrastructure/jobs'
import { logger, setLogSink, setTraceProvider } from '@/server/core/logger'
import { bindNotificationChannels } from '@/lib/notify'
import { sms, email, emailChannelEnabled } from '@/server/integrations'
import { currentTrace } from '@/server/core/trace'
import { markBootstrapped } from '@/server/infrastructure/observability/health'

// guard key is versioned: bumping it re-runs wiring after HMR when shared
// singletons changed shape (e.g. cache backing store) — cheap and safe (idempotent)
// v4: PHASE 11 adds AI/ML wiring (feedback loop, drift monitor, prompt seed)
// v5: PHASE 12 adds workflow governance runtime (SLA tick + drift reconcile)
// v6: PHASE 12 hotfix — re-register job handlers so the recurring governance
//      tick drops stale pre-TS_CAPS module references held through HMR
// v7: PHASE 13 adds integration wiring — HttpAI factory registration (when
//      AI_SERVICE_URL is configured), integrations-monitor job (breaker
//      state changes + degraded providers → admin notice), retention purge
// v8: PHASE 15 adds observability — trace provider + ServiceLog sink,
//      metrics sampler (30s), alert evaluator (60s, subsumes the old
//      integrations-monitor notify path — ED-179), business counters,
//      today tiles, observability retention purge
// v9: PHASE 17 adds reliability — durable-job boot recovery + mirror
//      refresh, job-recovery (5min) / job-retention (daily) / idempotency
//      retention (hourly) recurring jobs
const BOOTSTRAP_KEY = '__bhBootstrapped_v9'
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

  // ── PHASE 15: observability wiring (ED-165/166/179) ──────────────────────
  // trace provider → logger (correlation ids on every line, import-cycle-free)
  setTraceProvider(() => currentTrace())
  // PHASE 16 (I8 fix, ED-137b pattern): db metrics sink injected here so
  // src/lib/db.ts stays free of @/server imports (client-safe graph).
  void Promise.all([import('@/lib/db'), import('@/server/core/metrics')]).then(
    ([{ setDbMetricsSink }, { METRIC_NAMES, inc, observe }]) => {
      setDbMetricsSink((labels, ms, ok) => {
        inc(METRIC_NAMES.dbQueries, labels)
        observe(METRIC_NAMES.dbLatency, labels, ms)
        if (!ok) inc(METRIC_NAMES.dbErrors, { op: labels.op })
      })
    },
  )
  // durable ServiceLog sink (batched, fire-and-forget, PII-guarded)
  void import('@/server/infrastructure/observability/logPersist').then(({ serviceLogSink }) => {
    setLogSink(serviceLogSink)
  })
  // business counters from domain events
  void import('@/server/infrastructure/observability/sampler').then((s) => s.registerBusinessCounters())
  // metrics sampler: probes → gauges → series ring (+MetricPoint every 60s)
  registerJob('metrics-sampler', async () => {
    const { runSamplerTick } = await import('@/server/infrastructure/observability/sampler')
    await runSamplerTick()
  })
  scheduleRecurring('metrics-sampler', 30_000)
  // alert evaluator (60s) — unified rules incl. integrations (ED-179)
  registerJob('alert-evaluator', async () => {
    const { runAlertEvaluation } = await import('@/server/infrastructure/observability/sampler')
    await runAlertEvaluation()
  })
  scheduleRecurring('alert-evaluator', 60_000)
  // "today" business tiles (bounded queries)
  registerJob('business-today', async () => {
    const { refreshTodayMetrics } = await import('@/server/infrastructure/observability/sampler')
    await refreshTodayMetrics()
  })
  scheduleRecurring('business-today', 60_000)
  // retention purge (ServiceLog 3d / MetricPoint 7d / AlertEvent 90d)
  registerJob('observability-retention', async () => {
    const { runObservabilityRetention } = await import('@/server/infrastructure/observability/sampler')
    await runObservabilityRetention()
  })
  scheduleRecurring('observability-retention', 24 * 3600_000)

  // ── PHASE 17: reliability wiring (ED-190/191) ─────────────────────────────
  // crash recovery at boot: stale RUNNING claims (crashed worker) requeue,
  // orphaned PENDING owners are handed off; mirrors rebuild from DB truth
  void runJobRecovery().catch((e) => logger.warn('boot job recovery failed', { error: e instanceof Error ? e.message : String(e) }))
  void refreshMirrorFromDb().catch(() => { /* mirrors rebuild lazily */ })
  registerJob('job-recovery', async () => {
    const { runJobRecovery: recover } = await import('@/server/infrastructure/jobs')
    await recover()
  })
  scheduleRecurring('job-recovery', 5 * 60_000)
  // finished-job history retention (DONE 7d / DEAD 30d hard purge)
  registerJob('job-retention', async () => {
    const { purgeJobHistory } = await import('@/server/infrastructure/jobs')
    await purgeJobHistory()
  })
  scheduleRecurring('job-retention', 24 * 3600_000)
  // idempotency record TTL purge (24h window, hourly sweep)
  registerJob('idempotency-retention', async () => {
    const { purgeIdempotencyRecords } = await import('@/server/infrastructure/idempotency')
    await purgeIdempotencyRecords()
  })
  scheduleRecurring('idempotency-retention', 60 * 60_000)
  // readiness flag: bootstrap finished (health/readiness probes check this)
  markBootstrapped()


  // ── PHASE 13: bind notify channels SYNCHRONOUSLY (before any request is
  // served). Dependency inversion (ED-137b): lib/notify lives in the SHARED
  // client import graph and must never import @/server/* — so the adapters
  // are injected HERE, on the server-only bootstrap path.
  bindNotificationChannels(
    { providerName: sms().name, send: (i) => sms().send(i) },
    emailChannelEnabled() ? { send: (i) => email().send(i) } : undefined,
  )

  // ── events → notifications (ED-99: services never call notify directly) ──
  // PHASE 13: UserRegistered now supplies the phone — pre-13 the sms:true
  // hint was useless without it, so the welcome SMS silently never sent.
  subscribe(Events.UserRegistered, async (e) => {
    const userId = e.payload as string
    const { db } = await import('@/lib/db')
    const u = await db.user.findUnique({ where: { id: userId }, select: { phone: true } })
    await notify(userId, 'REGISTERED', { sms: true, phone: u?.phone ?? null })
  })
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
  // PHASE 12: transitions run through the FOLLOWUP machine per row (bounded
  // batch) — guarded, audited, WorkflowState-synced. The raw updateMany wrote
  // status with no audit trail and no graph check (engine-bypass, now closed).
  registerJob('followup-scan', async () => {
    const { db } = await import('@/lib/db')
    const { executeTransition } = await import('@/lib/workflow/engine')
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const tomorrow = new Date(today.getTime() + 86_400_000)
    const overdue = await db.followUp.findMany({
      where: { status: 'PENDING', dueDate: { lt: today } },
      select: { id: true }, take: 300,
    })
    for (const r of overdue) {
      const res = await executeTransition({
        machine: 'FOLLOWUP', entityId: r.id, action: 'MARK_OVERDUE',
        actor: { id: 'SYSTEM', role: 'SYSTEM' }, payload: {},
      })
      if (!res.ok && res.code !== 'INVALID_TRANSITION') {
        logger.warn('followup MARK_OVERDUE failed', { id: r.id, code: res.code })
      }
    }
    const due = await db.followUp.findMany({
      where: { status: 'PENDING', dueDate: { gte: today, lt: tomorrow } },
      select: { id: true }, take: 300,
    })
    for (const r of due) {
      const res = await executeTransition({
        machine: 'FOLLOWUP', entityId: r.id, action: 'MARK_DUE',
        actor: { id: 'SYSTEM', role: 'SYSTEM' }, payload: {},
      })
      if (!res.ok && res.code !== 'INVALID_TRANSITION') {
        logger.warn('followup MARK_DUE failed', { id: r.id, code: res.code })
      }
    }
  })
  scheduleRecurring('followup-scan', 5 * 60_000)

  // ── PHASE 12: workflow governance runtime (timeout/SLA + drift) ──────────
  // Backfill, drift reconciliation and the SLA ladder (REMIND / ESCALATE /
  // AUTO_TRANSITION) — see src/lib/workflow/governance.ts.
  registerJob('workflow-governance', async () => {
    const { runWorkflowGovernanceTick } = await import('@/lib/workflow/governance')
    await runWorkflowGovernanceTick()
  })
  scheduleRecurring('workflow-governance', 2 * 60_000)

  // ── PHASE 13: external integration wiring ─────────────────────────────
  // Job-based (no top-level await — file discipline): registers the HttpAI
  // provider factory into the PHASE 11 model registry when AI_SERVICE_URL is
  // configured (flipping AIModel.provider='HttpAI' then routes inference
  // through the full resilience stack without code changes, ED-146).
  registerJob('integration-wiring', async () => {
    const { aiServiceSettings } = await import('@/server/integrations')
    if (aiServiceSettings().url) {
      const { registerProviderFactory } = await import('@/server/infrastructure/ai/registry')
      const { HttpAIProvider } = await import('@/server/integrations')
      registerProviderFactory('HttpAI', () => new HttpAIProvider())
      logger.info('HttpAI provider registered (AI_SERVICE_URL configured)')
    }
  })
  enqueue('integration-wiring', {}, { maxAttempts: 3 })

  // PHASE 15 (ED-179): the standalone integrations-monitor job was subsumed
  // by the unified alert-evaluator (60s) — breaker OPEN / success<80% now
  // flow through AlertEvent with dedup + cooldown + auto-resolve instead of
  // an ad-hoc once-per-state set.

  // PHASE 13: IntegrationCallLog retention purge — 90-day window (mirrors
  // the AIInferenceLog retention decision; keeps the table bounded).
  registerJob('integrations-retention', async () => {
    const { purgeIntegrationLogs } = await import('@/server/integrations')
    await purgeIntegrationLogs(90)
  })
  scheduleRecurring('integrations-retention', 24 * 3600 * 1000)

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

  // ── PHASE 14: search/reporting engine wiring (ED-156/158) ─────────────
  // async report exports: job → bounded engine run → StoredFile (TEMPORARY,
  // 24h TTL) → REPORT_EXPORT_READY notification
  registerJob('report-export', async (payload) => {
    const { runExportJob } = await import('@/server/infrastructure/reporting/export/exportService')
    await runExportJob(payload)
  })

  // report cache invalidation (ED-158): money/catalog/walk events flush the
  // report:* prefix so dashboards never show stale aggregates
  const clearReports = async () => {
    const map = (globalThis as unknown as { __bhCacheMap?: Map<string, unknown> }).__bhCacheMap
    if (!map) return
    for (const k of [...map.keys()]) if (k.startsWith('report:')) map.delete(k)
  }
  for (const evt of [Events.PaymentVerified, Events.OrderPaid, Events.OrderCreated, Events.PriceChanged, Events.ProductCatalogChanged, Events.CaseCreated, Events.CaseTransitioned, Events.UserRegistered]) {
    subscribe(evt, clearReports)
  }

  logger.info('backend bootstrap complete', { subscribers: 24, jobs: 13 })
}
