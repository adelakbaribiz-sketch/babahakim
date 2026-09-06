// ── BabaHakim Observability · Alert Engine (PHASE 15, ED-177) ─────────────
// Owns the alert LIFECYCLE around the pure rules (alertRules.ts):
//   OPEN (first fire → notify admins) → firing (cooldown suppresses
//   re-notifies for ALERT_THRESHOLDS.cooldownMin) → RESOLVED (rule stops
//   firing → auto-resolve + audit) → may re-open later.
// Delivery: in-app ADMIN notification (always) + SMS for CRITICAL (uses the
// PHASE 13 notify channels — never a direct provider call). Payloads carry
// numbers/keys only — no PII ever lands in an AlertEvent row (ED-173).
import type { PrismaClient } from '@prisma/client'
import { childLogger, logger } from '@/server/core/logger'
import { evaluateRules, ALERT_THRESHOLDS, type RuleViolation, type HealthSignals } from './alertRules'

const log = childLogger({ svc: 'alert-engine' })

const RETENTION_DAYS = 90

type Db = PrismaClient

/** Evaluate rules → reconcile AlertEvent rows → notify on transitions.
 *  Called by the alert-evaluator job (60s cadence). Never throws. */
export async function runAlertTick(health: HealthSignals, snap: { counters: Record<string, number>; histograms: Record<string, { p95: number }> }, db?: Db): Promise<{ fired: string[]; resolved: string[] }> {
  const database = db ?? (await import('@/lib/db')).db
  const violations = evaluateRules(snap, health)
  const byKey = new Map(violations.map((v) => [v.key, v]))
  const fired: string[] = []
  const resolved: string[] = []
  try {
    const rows = await database.alertEvent.findMany({ where: { status: 'OPEN' } })
    const openKeys = new Set(rows.map((r) => r.key))

    // 1) fire / re-fire (cooldown) new violations
    for (const v of violations) {
      const existing = rows.find((r) => r.key === v.key)
      if (!existing) {
        // PHASE 17 fix (real bug found by chaos drills): AlertEvent.key is
        // GLOBALLY unique, but `rows` only carries OPEN alerts. A rule that
        // auto-RESOLVED and then re-fires hit create → P2002 → the whole tick
        // failed — an alert could NEVER fire again after its first resolve.
        // Re-open the prior row instead of colliding with it.
        const prior = await database.alertEvent.findFirst({ where: { key: v.key } })
        if (prior) {
          await database.alertEvent.update({
            where: { id: prior.id },
            data: {
              status: 'OPEN', severity: v.severity,
              msgFa: v.fa, msgEn: v.en,
              payload: v.payload ? JSON.stringify(v.payload) : prior.payload,
              lastSeenAt: new Date(), lastNotifiedAt: new Date(),
              fireCount: { increment: 1 }, resolvedAt: null,
            },
          })
          fired.push(v.key)
          await deliver(v, true)
          log.info('alert re-opened after resolve', { key: v.key })
        } else {
          try {
            await database.alertEvent.create({
              data: {
                key: v.key, severity: v.severity, status: 'OPEN',
                msgFa: v.fa, msgEn: v.en,
                payload: v.payload ? JSON.stringify(v.payload) : null,
                lastNotifiedAt: new Date(),
              },
            })
            fired.push(v.key)
            await deliver(v, true)
          } catch (e) {
            // concurrent tick created the same key first → it is OPEN now;
            // this tick simply treats it as already fired (no crash)
            if ((e as { code?: string }).code === 'P2002') {
              fired.push(v.key)
              log.warn('alert create raced a concurrent tick — treated as fired', { key: v.key })
            } else {
              throw e
            }
          }
        }
      } else {
        const sinceNotified = existing.lastNotifiedAt ? Date.now() - existing.lastNotifiedAt.getTime() : Infinity
        await database.alertEvent.update({
          where: { id: existing.id },
          data: {
            severity: v.severity,
            msgFa: v.fa, msgEn: v.en,
            payload: v.payload ? JSON.stringify(v.payload) : existing.payload,
            lastSeenAt: new Date(),
            fireCount: { increment: 1 },
            ...(sinceNotified > ALERT_THRESHOLDS.cooldownMin * 60_000
              ? { lastNotifiedAt: new Date() }
              : {}),
          },
        })
        fired.push(v.key)
        if (sinceNotified > ALERT_THRESHOLDS.cooldownMin * 60_000) await deliver(v, false)
      }
    }

    // 2) auto-resolve rules that stopped firing
    for (const row of rows) {
      if (byKey.has(row.key)) continue
      await database.alertEvent.update({
        where: { id: row.id },
        data: { status: 'RESOLVED', resolvedAt: new Date(), lastSeenAt: new Date() },
      })
      resolved.push(row.key)
      log.info('alert resolved', { key: row.key })
    }
  } catch (e) {
    log.error('alert tick failed', { error: e instanceof Error ? e.message : String(e) })
  }
  return { fired, resolved }
}

/** Manual resolve from the admin console (audited by the route). */
export async function resolveAlert(id: string, db?: Db): Promise<boolean> {
  const database = db ?? (await import('@/lib/db')).db
  const res = await database.alertEvent.updateMany({
    where: { id, status: 'OPEN' },
    data: { status: 'RESOLVED', resolvedAt: new Date() },
  })
  return res.count > 0
}

async function deliver(v: RuleViolation, firstFire: boolean): Promise<void> {
  try {
    const { notify } = await import('@/lib/notify')
    const database = (await import('@/lib/db')).db
    const admins = await database.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { id: true } })
    const extraFa = `[${v.severity}] ${v.key}: ${v.fa}${firstFire ? '' : ' (ادامه دارد)'}`
    for (const a of admins) {
      await notify(a.id, 'WORKFLOW_ESCALATED', { extraFa: extraFa.slice(0, 180), sms: v.severity === 'CRITICAL' })
    }
  } catch (e) {
    log.warn('alert delivery failed', { key: v.key, error: e instanceof Error ? e.message : String(e) })
  }
}

/** Retention: hard purge of resolved/old AlertEvents (ED-172). */
export async function purgeAlerts(days = RETENTION_DAYS, db?: Db): Promise<number> {
  const database = db ?? (await import('@/lib/db')).db
  const cutoff = new Date(Date.now() - days * 86_400_000)
  const res = await database.alertEvent.deleteMany({ where: { lastSeenAt: { lt: cutoff } } })
  return res.count
}

export { log }
