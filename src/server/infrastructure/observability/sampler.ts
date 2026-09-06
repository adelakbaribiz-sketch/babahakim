// ── BabaHakim Observability · Sampler & Evaluators (PHASE 15, ED-179) ─────
// Recurring jobs registered by bootstrap v8:
//   metrics-sampler (30s)  — system probes → gauges → series ring; every
//                            other tick persists a MetricPoint (60s cadence,
//                            7-day durable window)
//   alert-evaluator (60s)  — health signals + metrics + integration status
//                            → runAlertTick (lifecycle + notify + cooldown)
//   business counters      — event-bus subscriptions (in-process counters)
//   today metrics (60s)    — bounded indexed count/sum queries for the
//                            business tiles (never windowed scans)
//   observability-retention (daily) — hard purge per ED-172
import { logger, childLogger } from '@/server/core/logger'
import { snapshotSeries, metricsValues, inc, gauge, METRIC_NAMES } from '@/server/core/metrics'
import { systemSnapshot, measureEventLoopLag } from './system'
import { queueHealth } from '@/server/infrastructure/jobs'
import { runAlertTick, purgeAlerts } from './alerts'
import { dbPing } from '@/lib/db'
import { signalsFrom } from './alertRules'

const log = childLogger({ svc: 'observability' })

const g = globalThis as unknown as { __bhSamplerTick?: number }
g.__bhSamplerTick = g.__bhSamplerTick ?? 0

/** 30s tick: probes → gauges → series ring; every 2nd tick → MetricPoint. */
export async function runSamplerTick(persistEvery = 2): Promise<void> {
  try {
    await systemSnapshot() // writes gauges (CPU/mem/disk/loop)
    queueHealth() // refreshes queue gauges
    const snap = snapshotSeries()
    g.__bhSamplerTick = (g.__bhSamplerTick ?? 0) + 1
    if (g.__bhSamplerTick % persistEvery === 0) {
      const { db } = await import('@/lib/db')
      const payload = JSON.stringify({
        at: snap.at,
        uptimeSec: snap.uptimeSec,
        counters: snap.counters,
        gauges: snap.gauges,
        histP95: Object.fromEntries(Object.entries(snap.histograms).map(([k, h]) => [k, h.p95])),
      })
      if (payload.length < 200_000) { // hard cap — never store an unbounded blob
        await db.metricPoint.create({ data: { data: payload } })
      }
    }
  } catch (e) {
    log.warn('sampler tick failed', { error: e instanceof Error ? e.message : String(e) })
  }
}

/** 60s tick: alert rules over live signals (never throws — engine guards). */
export async function runAlertEvaluation(): Promise<void> {
  try {
    const { db } = await import('@/lib/db')
    const ping = await dbPing()
    const queue = queueHealth()
    const sys = await systemSnapshot()
    const values = metricsValues()
    // integration health (PHASE 13 telemetry) folded into the same engine —
    // replaces the standalone integrations-monitor notify path (ED-179)
    const { integrationStatus } = await import('@/server/integrations')
    const integrationsDown: string[] = []
    try {
      for (const r of integrationStatus()) {
        if (r.mode !== 'live') continue
        if (r.circuit.state === 'OPEN' || (r.stats.total >= 5 && r.stats.successRate < 0.8)) {
          integrationsDown.push(`${r.kind}:${r.providerName}`)
        }
      }
    } catch { /* integration status unavailable — skip silently */ }
    const signals = signalsFrom(values, {
      dbOk: ping.ok,
      dbPingMs: ping.ms,
      queue: { pending: queue.pending, dead: queue.dead, workerAlive: queue.workerAlive },
      mem: { heapUsed: sys.memory?.heapUsedBytes ?? 0, heapTotal: sys.memory?.heapTotalBytes ?? 0 },
      loopLagMs: sys.eventLoopLagMs ?? 0,
      diskUsedPercent: sys.disk?.usedPercent ?? null,
    })
    await runAlertTick({ ...signals, integrationsDown }, values, db)
  } catch (e) {
    log.warn('alert evaluation failed', { error: e instanceof Error ? e.message : String(e) })
  }
}

/** Business counters — fire on domain events (in-process, monotonic). */
export function registerBusinessCounters(): void {
  // local import to avoid a static cycle events.ts → this module
  void import('@/server/infrastructure/events').then(({ subscribe, Events }) => {
    const bump = (event: string) => () => inc(METRIC_NAMES.business, { event })
    subscribe(Events.UserRegistered, bump('user.registered'))
    subscribe(Events.CaseCreated, bump('case.created'))
    subscribe(Events.AiAnalysisCompleted, bump('ai.analysis.completed'))
    subscribe(Events.OrderCreated, bump('order.created'))
    subscribe(Events.OrderPaid, bump('order.paid'))
    subscribe(Events.PaymentVerified, bump('payment.verified'))
    subscribe(Events.ShipmentDelivered, bump('shipment.delivered'))
    subscribe(Events.TicketCreated, bump('ticket.created'))
    subscribe(Events.MediaFileInfected, bump('media.infected'))
    subscribe(Events.AiDriftDetected, bump('ai.drift'))
  })
}

/** 60s: "today" tiles from bounded indexed queries (ED-168 — aggregate over
 *  a ≤24h window, never an unbounded scan). */
export async function refreshTodayMetrics(): Promise<void> {
  try {
    const { db } = await import('@/lib/db')
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const [users, cases, analyses, orders, paidAgg] = await Promise.all([
      db.user.count({ where: { createdAt: { gte: todayStart } } }),
      db.medicalCase.count({ where: { createdAt: { gte: todayStart } } }),
      db.aIAnalysis.count({ where: { createdAt: { gte: todayStart } } }),
      db.order.count({ where: { createdAt: { gte: todayStart } } }),
      db.payment.aggregate({ where: { status: 'PAID', verifiedAt: { gte: todayStart } }, _sum: { amount: true }, _count: true }),
    ])
    gauge('biz_users_today', undefined, users)
    gauge('biz_cases_today', undefined, cases)
    gauge('biz_ai_today', undefined, analyses)
    gauge('biz_orders_today', undefined, orders)
    gauge('biz_paid_today', undefined, paidAgg._count)
    gauge('biz_revenue_today_toman', undefined, paidAgg._sum.amount ?? 0)
  } catch (e) {
    log.warn('today metrics failed', { error: e instanceof Error ? e.message : String(e) })
  }
}

/** Daily: hard purges (ED-172 — ops tables are not medical records). */
export async function runObservabilityRetention(): Promise<void> {
  try {
    const { db } = await import('@/lib/db')
    const now = Date.now()
    const cut = (days: number) => new Date(now - days * 86_400_000)
    const [logs, points] = await Promise.all([
      db.serviceLog.deleteMany({ where: { t: { lt: cut(3) } } }),
      db.metricPoint.deleteMany({ where: { at: { lt: cut(7) } } }),
    ])
    const alerts = await purgeAlerts(90, db)
    log.info('observability retention purge', { serviceLogs: logs.count, metricPoints: points.count, alertEvents: alerts })
  } catch (e) {
    log.warn('retention purge failed', { error: e instanceof Error ? e.message : String(e) })
  }
}

export { logger, measureEventLoopLag }
