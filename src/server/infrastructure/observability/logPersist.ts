// ── BabaHakim Observability · ServiceLog Persistence (PHASE 15, ED-166) ──
// The logger's durable sink: warn/error lines land in ServiceLog (already
// redacted by the logger v2 pipeline BEFORE this point — double defense:
// the sink also refuses rows whose fields still match raw PII patterns).
// Fire-and-forget semantics: batching with a micro-queue so bursts never
// hammer SQLite; flushes every 2s or 50 rows. IP is hashed (sha256[:12])
// because it is personal data (ED-173).
import { createHash } from 'crypto'
import type { LogLine } from '@/server/core/logger'

const BATCH_MAX = 50
const FLUSH_MS = 2000

interface SinkGlobal {
  __bhLogBuffer?: LogLine[]
  __bhLogFlushTimer?: ReturnType<typeof setTimeout>
}
const g = globalThis as unknown as SinkGlobal
const buffer: LogLine[] = g.__bhLogBuffer ?? []
g.__bhLogBuffer = buffer

export function hashIp(ip: string | undefined): string | null {
  if (!ip || ip === 'unknown') return null
  return createHash('sha256').update(ip).digest('hex').slice(0, 12)
}

/** last-mile guard: a redaction escape would still be caught here. */
function stillLooksDirty(line: LogLine): boolean {
  const blob = JSON.stringify(line)
  return /"(\w*pass\w*|token|secret|authorization|csrf|otp\w*)"\s*:\s*"(?!\[REDACTED\])[^"]{3,}/i.test(blob)
}

async function flush(): Promise<void> {
  if (buffer.length === 0) return
  const batch = buffer.splice(0, BATCH_MAX)
  try {
    const { db } = await import('@/lib/db')
    await db.serviceLog.createMany({
      data: batch.map((l) => ({
        t: new Date(l.t),
        lvl: l.lvl,
        svc: String(l.svc ?? 'unknown'),
        msg: String(l.msg ?? '').slice(0, 2000),
        route: typeof l.route === 'string' ? l.route.slice(0, 120) : null,
        method: typeof l.method === 'string' ? l.method : null,
        status: typeof l.status === 'number' ? l.status : null,
        reqId: typeof l.reqId === 'string' ? l.reqId : null,
        corrId: typeof l.corrId === 'string' ? l.corrId : null,
        traceId: typeof l.traceId === 'string' ? l.traceId : null,
        ipHash: hashIp(typeof l.ip === 'string' ? l.ip : undefined),
        fields: l.fields === undefined || l.fields === null ? null : (typeof l.fields === 'string' ? l.fields : JSON.stringify(l.fields)),
      })),
    })
  } catch {
    // persistence is best-effort — the stdout stream remains the source of truth
  }
}

function scheduleFlush(): void {
  if (g.__bhLogFlushTimer) return
  g.__bhLogFlushTimer = setTimeout(() => {
    g.__bhLogFlushTimer = undefined
    void flush()
  }, FLUSH_MS)
  ;(g.__bhLogFlushTimer as unknown as { unref?: () => void }).unref?.()
}

/** Sink installed by bootstrap (logger calls this for warn/error lines). */
export function serviceLogSink(line: LogLine): void {
  if (stillLooksDirty(line)) {
    // strip fields entirely — the message + metadata still land
    line = { ...line, fields: '[STRIPPED:PII-GUARD]' }
  }
  buffer.push(line)
  if (buffer.length >= BATCH_MAX) {
    void flush()
    return
  }
  scheduleFlush()
}

/** Test/drain helper — flush the buffer synchronously-ish. */
export async function drainServiceLogSink(): Promise<void> {
  clearTimeout(g.__bhLogFlushTimer)
  g.__bhLogFlushTimer = undefined
  await flush()
}

export const __internals = { stillLooksDirty, hashIp }
