// ── BabaHakim Backend · Identity helpers (moved out of lib/api, ED-93) ────
// Business codes are generated in the Application layer only — routes and
// controllers must never mint domain identifiers.
import { randomUUID } from 'crypto'

/** Human-readable business code, e.g. `TC-MC4XY2A123`. */
export function genCode(prefix: string): string {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 900 + 100)}`
}

/** Opaque correlation id for one HTTP request. */
export function genRequestId(): string {
  return `req_${randomUUID().slice(0, 13)}`
}

export const newId = randomUUID
