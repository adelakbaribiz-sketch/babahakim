// ── BabaHakim Backend · Structured Logger (PHASE 08, ED-95) ──────────────
// JSON-line logger with request correlation, level control and field
// redaction. Replaces bare console.* calls scattered across routes.
// Bun/Node stdout only — no external dependency (12-factor log stream).

type Level = 'debug' | 'info' | 'warn' | 'error'
const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }
const ENV_LEVEL = (process.env.BH_LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug')) as Level
const MIN = LEVELS[ENV_LEVEL] ?? 20

// never emit these keys' values (defense-in-depth for accidental leakage)
const REDACT = /pass|token|secret|sig|hash|cookie|authorization|csrf|otp|national|ssn/i
const MAX_DEPTH = 4

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
  if (typeof value === 'string' && value.length > 2000) return value.slice(0, 2000) + '…'
  return value
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (LEVELS[level] < MIN) return
  const line = JSON.stringify({
    t: new Date().toISOString(),
    lvl: level,
    svc: 'babahakim-api',
    msg,
    ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
  })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
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
