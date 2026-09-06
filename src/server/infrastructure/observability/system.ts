// ── BabaHakim Observability · System Metrics (PHASE 15, ED-176) ───────────
// CPU / Memory / Disk / Event-loop lag probes. Pure Node APIs with guards —
// every probe degrades to `null` instead of throwing when the runtime lacks
// the API (Bun/Node differences, statfs availability). Spec §57 mandates
// CPU, Memory, Disk monitoring; the sampler job records these into gauges
// and the time-series ring.
import { gauge } from '@/server/core/metrics'
import os from 'os'
import { statfs } from 'fs/promises'

export interface SystemSnapshot {
  at: string
  uptimeSec: number
  cpu: {
    processPercent: number | null // this process' CPU share (delta-based)
    loadAvg1: number | null // normalized per core
    cores: number
  } | null
  memory: {
    rssBytes: number
    heapUsedBytes: number
    heapTotalBytes: number
    externalBytes: number
    systemFreeBytes: number
    systemTotalBytes: number
    systemUsedPercent: number | null
  } | null
  disk: {
    path: string
    freeBytes: number | null
    totalBytes: number | null
    usedPercent: number | null
  } | null
  eventLoopLagMs: number | null
  node: { version: string; platform: string; env: string }
}

const STORAGE_PATH = process.env.BH_STORAGE_PATH || 'storage'

// HMR-safe probe state
const g = globalThis as unknown as {
  __bhSysProbe?: { lastCpu: { user: number; system: number; at: number }; loop: { last: number; drift: number } }
  __bhLoopTimer?: unknown
}
const probe = g.__bhSysProbe ?? {
  lastCpu: { user: 0, system: 0, at: Date.now() },
  loop: { last: Date.now(), drift: 0 },
}
g.__bhSysProbe = probe

/** Event-loop lag: drift of a 200ms heartbeat — high drift = a blocked loop. */
export function measureEventLoopLag(): number {
  return Math.max(0, probe.loop.drift)
}

// start the heartbeat once (unref'd — never holds the process open)
if (g.__bhLoopTimer === undefined) {
  const timer = setInterval(() => {
    const now = Date.now()
    probe.loop.drift = now - probe.loop.last - 200
    probe.loop.last = now
  }, 200)
  ;(timer as unknown as { unref?: () => void }).unref?.()
  g.__bhLoopTimer = timer
}

async function diskUsage(): Promise<SystemSnapshot['disk']> {
  try {
    const st = await statfs(STORAGE_PATH)
    const total = Number(st.blocks) * Number(st.bsize)
    const free = Number(st.bavail) * Number(st.bsize)
    if (!total) return null
    return { path: STORAGE_PATH, freeBytes: free, totalBytes: total, usedPercent: +(((total - free) / total) * 100).toFixed(1) }
  } catch {
    return null // statfs unavailable (or path missing) — degrade silently
  }
}

function processCpuPercent(): number | null {
  try {
    const usage = process.cpuUsage()
    const now = Date.now()
    const wall = (now - probe.lastCpu.at) || 1
    const total = (usage.user + usage.system - probe.lastCpu.user - probe.lastCpu.system) / 1000 // µs→ms
    probe.lastCpu = { user: usage.user, system: usage.system, at: now }
    const pct = (total / wall) * 100
    return Number.isFinite(pct) ? +pct.toFixed(1) : null
  } catch {
    return null
  }
}

export async function systemSnapshot(): Promise<SystemSnapshot> {
  const cpuPct = processCpuPercent()
  const cores = os.cpus()?.length ?? 0
  const load1 = typeof os.loadavg === 'function' ? os.loadavg()[0] : null
  let mem: SystemSnapshot['memory'] = null
  try {
    const m = process.memoryUsage()
    const total = os.totalmem?.() ?? 0
    const free = os.freemem?.() ?? 0
    mem = {
      rssBytes: m.rss,
      heapUsedBytes: m.heapUsed,
      heapTotalBytes: m.heapTotal,
      externalBytes: m.external,
      systemFreeBytes: free,
      systemTotalBytes: total,
      systemUsedPercent: total ? +(((total - free) / total) * 100).toFixed(1) : null,
    }
  } catch { /* keep null */ }
  const lag = measureEventLoopLag()
  // feed gauges so the series ring carries system health (sampler also calls)
  gauge('system_cpu_process_percent', undefined, cpuPct ?? -1)
  if (mem) {
    gauge('system_mem_heap_used_bytes', undefined, mem.heapUsedBytes)
    gauge('system_mem_rss_bytes', undefined, mem.rssBytes)
    gauge('system_mem_system_used_percent', undefined, mem.systemUsedPercent ?? -1)
  }
  gauge('system_event_loop_lag_ms', undefined, lag)
  const disk = await diskUsage()
  if (disk?.usedPercent != null) gauge('system_disk_used_percent', undefined, disk.usedPercent)
  return {
    at: new Date().toISOString(),
    uptimeSec: Math.round(process.uptime()),
    cpu: {
      processPercent: cpuPct,
      loadAvg1: cores ? +((load1 ?? 0) / cores).toFixed(2) : null,
      cores,
    },
    memory: mem,
    disk,
    eventLoopLagMs: +lag.toFixed(1),
    node: { version: process.version, platform: process.platform, env: process.env.NODE_ENV ?? 'development' },
  }
}
