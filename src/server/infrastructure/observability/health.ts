// ── BabaHakim Observability · Health Computation (PHASE 15, ED-175) ───────
// Three probe depths, matching spec §57 exactly:
//   liveness  — is the process able to answer at all? (never touches DB —
//               a broken DB must NOT get a pod killed by liveness)
//   readiness — can we serve traffic? (DB ping + queue worker + storage
//               writable + bootstrap done)
//   health    — full picture for humans: readiness + degraded-but-alive
//               signals (queue backlog, memory, event loop, integrations)
// Public endpoints expose MINIMAL shapes (status + booleans, no topology,
// no versions, no volumes — ED-173 disclosure hygiene). Rich detail lives
// behind the ADMIN-gated observability API.
import { dbPing } from '@/lib/db'
import { queueHealth } from '@/server/infrastructure/jobs'
import { systemSnapshot, type SystemSnapshot } from './system'
import { metricsValues } from '@/server/core/metrics'

export interface LivenessStatus {
  status: 'ok' | 'down'
  uptimeSec: number
}

export interface ReadinessCheck {
  db: boolean
  dbPingMs: number
  queue: boolean
  storage: boolean
  bootstrap: boolean
}

export interface ReadinessStatus {
  status: 'ready' | 'not_ready' | 'degraded'
  checks: ReadinessCheck
}

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'down'
  readiness: ReadinessStatus
  liveness: LivenessStatus
}

// bootstrap flag — set by infrastructure/bootstrap.ts (v8)
const g = globalThis as unknown as { __bhReadinessReady?: boolean }
export function markBootstrapped(): void {
  g.__bhReadinessReady = true
}
export function isBootstrapped(): boolean {
  return g.__bhReadinessReady === true
}

async function storageWritable(): Promise<boolean> {
  // PHASE 17 (REL9 — honest probe): the OLD check only verified the storage
  // directory was traversable — a READ-ONLY mount passed readiness. The new
  // probe writes + reads back + deletes a tiny file through the REAL storage
  // driver, so ENOSPC / EROFS / EIO / chaos storage:down all flip readiness
  // to degraded. Probe keys stay inside the TTL-purged files/temp zone.
  try {
    const { getStorageDriver, ZONES } = await import('@/server/infrastructure/media/storage-driver')
    const driver = getStorageDriver()
    const key = `${ZONES.filesTemp}/.probe-${process.pid}-${Date.now().toString(36)}`
    await driver.put(key, Buffer.from('ok', 'utf8'))
    const back = await driver.get(key)
    await driver.delete(key)
    return back.toString('utf8') === 'ok'
  } catch {
    return false
  }
}

export async function liveness(): Promise<LivenessStatus> {
  // The fact this function returned is itself the proof the event loop is
  // alive — no further checks (k8s semantics, ED-175).
  return { status: 'ok', uptimeSec: Math.round(process.uptime()) }
}

export async function readiness(): Promise<ReadinessStatus> {
  const [ping, storage, queue] = await Promise.all([dbPing(), storageWritable(), Promise.resolve(queueHealth())])
  const boot = isBootstrapped()
  const checks: ReadinessCheck = {
    db: ping.ok,
    dbPingMs: ping.ms,
    queue: queue.workerAlive,
    storage,
    bootstrap: boot,
  }
  // DB or bootstrap failure → NOT ready (traffic must be rerouted).
  // Queue worker down is degraded-ready: API still answers, jobs wait.
  if (!checks.db || !checks.bootstrap) return { status: 'not_ready', checks }
  if (!checks.queue || !checks.storage) return { status: 'degraded', checks }
  return { status: 'ready', checks }
}

export async function health(): Promise<HealthStatus> {
  const [live, ready] = await Promise.all([liveness(), readiness()])
  let status: HealthStatus['status'] = 'down'
  if (ready.status === 'ready') status = 'ok'
  else if (ready.status === 'degraded') status = 'degraded'
  else if (live.status === 'ok' && ready.checks.db) status = 'degraded' // alive but partial
  return { status, readiness: ready, liveness: live }
}

/** Full detail (ADMIN-gated API only) — readiness + system + queue + db. */
export interface ObservabilityDetail {
  health: HealthStatus
  system: SystemSnapshot
  queue: ReturnType<typeof queueHealth>
  db: { pingOk: boolean; pingMs: number }
  seriesRingSize: number
  businessCounters: Record<string, number>
}

export async function observabilityDetail(): Promise<ObservabilityDetail> {
  const [healthStatus, sys] = await Promise.all([health(), systemSnapshot()])
  const ping = await dbPing()
  const values = metricsValues()
  const business: Record<string, number> = {}
  for (const [k, v] of Object.entries(values.counters)) {
    if (k.startsWith('business_total')) business[k] = v
  }
  return {
    health: healthStatus,
    system: sys,
    queue: queueHealth(),
    db: { pingOk: ping.ok, pingMs: ping.ms },
    seriesRingSize: 0, // filled by the service layer (metrics import stays lazy)
    businessCounters: business,
  }
}
