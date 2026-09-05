// ── BabaHakim Backend · Structured Logger v2 (PHASE 08 ED-95 → PHASE 15 ED-166)
// JSON-line logger with request correlation, level control and field
// redaction. Replaces bare console.* calls scattered across routes.
// Bun/Node stdout only — no external dependency (12-factor log stream).
//
// PHASE 15 additions:
//   • trace fields (corrId/traceId) injected automatically from the ALS
//     context — no childLogger needed for correlation (ED-164)
//   • redaction v2: VALUE-level PII scrubbing in addition to key matching
//     (phones 09xxxxxxxxx, JWTs, national ids, base64 blobs, URL tokens)
//   • bounded in-memory ring (tail API) + durable warn/error persistence to
//     ServiceLog through a fire-and-forget sink — emit NEVER blocks/throws
//   • every line is one JSON object — grep/jq friendly (Searchable)
type Level = 'debug' | 'info' | 'warn' | 'error'
const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }
const ENV_LEVEL = (process.env.BH_LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug')) as Level
const MIN = LEVELS[ENV_LEVEL] ?? 20

// never emit these keys' values (defense-in-depth for accidental leakage)
const REDACT = /pass|token|secret|sig|hash|cookie|authorization|csrf|otp|national|ssn|prescription|diagnos|image|file|b64|base64/i
const MAX_DEPTH = 4

// ── value-level PII scrubbing (ED-166) ─────────────────────────────────────
// Applied to every string field AND to `msg` — key-based redaction alone
// cannot catch `log.info('sms sent', { to: '09121234567' })`-style leaks
// where the value rides an innocent key, or messages embedding phones.
const PHONE_RE = /(\+98|0098|0)?9\d{9}\b/g
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{0,}/g
const NATIONAL_ID_RE = /\b\d{10}\b/g
const LONG_B64_RE = /[A-Za-z0-9+/=]{60,}/g
const URL_SECRET_RE = /([?&](?:token|key|secret|password|code|authority|ref)=)[^&\s]+/gi

function scrubString(s: string): string {
  if (s.length > 2000) s = s.slice(0, 2000) + '…'
  let out = s
  out = out.replace(PHONE_RE, (m) => `09••••${m.slice(-4)}`)
  out = out.replace(JWT_RE, '[JWT]')
  out = out.replace(NATIONAL_ID_RE, (m) => (m === '0000000000' ? m : '•••••' + m.slice(-4)))
  out = out.replace(LONG_B64_RE, (m) => `[BLOB:${m.length}]`)
  out = out.replace(URL_SECRET_RE, '$1[REDACTED]')
  return out
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH || value === null || value === undefined) return value
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1))
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACT.test(k) ? '[REDACTED]' : redact(v, depth + 1)
    }
    return out
  }
  if (typeof value === 'string') return scrubString(value)
  return value
}

// ── bounded ring for the tail API (Searchable without a DB roundtrip) ─────
const RING_SIZE = 500
export interface LogLine {
  t: string
  lvl: Level
  svc: string
  msg: string
  [k: string]: unknown
}
const g = globalThis as unknown as { __bhLogRing?: LogLine[]; __bhLogSink?: LogSink; __bhTraceProvider?: TraceProvider }
const ring: LogLine[] = g.__bhLogRing ?? []
g.__bhLogRing = ring

// ── durable sink (fire-and-forget, injected by bootstrap — no DB import
// here: logger sits above the persistence layer and must never block) ──────
export type LogSink = (line: LogLine) => void
export function setLogSink(sink: LogSink | null): void {
  g.__bhLogSink = sink ?? undefined
}

/** Trace-context provider — injected by the API handler (avoids an import
 *  cycle logger ← trace: logger must stay loadable from anywhere). */
export type TraceProvider = () => { corrId?: string; traceId?: string } | undefined
export function setTraceProvider(fn: TraceProvider): void {
  g.__bhTraceProvider = fn
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (LEVELS[level] < MIN) return
  const trace = g.__bhTraceProvider?.()
  const line: LogLine = {
    t: new Date().toISOString(),
    lvl: level,
    svc: 'babahakim-api',
    msg: scrubString(String(msg ?? '')),
    ...(trace ? { corrId: trace.corrId, traceId: trace.traceId } : {}),
    ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
  }
  const json = JSON.stringify(line)
  if (level === 'error') console.error(json)
  else if (level === 'warn') console.warn(json)
  else console.log(json)
  // ring: keep newest entries, drop from the front (bounded memory)
  ring.push(line)
  if (ring.length > RING_SIZE) ring.splice(0, ring.length - RING_SIZE)
  if (level === 'warn' || level === 'error') {
    try { g.__bhLogSink?.(line) } catch { /* sink must never break emit */ }
  }
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit('error', msg, fields),
}

// child logger with sticky context (requestId / actor / service) — zero allocation on emit
export function childLogger(ctx: { reqId?: string; actor?: string; route?: string; svc?: string }) {
  const base = { ...ctx }
  return {
    debug: (msg: string, fields?: Record<string, unknown>) => emit('debug', msg, { ...base, ...fields }),
    info: (msg: string, fields?: Record<string, unknown>) => emit('info', msg, { ...base, ...fields }),
    warn: (msg: string, fields?: Record<string, unknown>) => emit('warn', msg, { ...base, ...fields }),
    error: (msg: string, fields?: Record<string, unknown>) => emit('error', msg, { ...base, ...fields }),
  }
}

/** Newest-first tail of the in-memory ring (bounded — never unbounded). */
export function logTail(n = 100): LogLine[] {
  const take = Math.min(Math.max(1, Math.trunc(n)), RING_SIZE)
  return ring.slice(-take).reverse()
}

export function logRingSize(): number {
  return ring.length
}

// test hooks — reset ring + providers between cases
export const __internals = {
  clearRing: () => { ring.length = 0 },
  scrubString,
  redact,
}
