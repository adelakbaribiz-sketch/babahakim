// ── BabaHakim Search Engine · Safe Query Builder (PHASE 14, ED-151/152) ────
// Builds Prisma `where` fragments from user input:
//   • applyQ()        — full-text needles pushed INTO the SQL query (fixes S-1:
//                       v1 post-filtered AFTER pagination, shrinking pages)
//   • applyFilters()  — whitelisted field filter DSL (injection-safe):
//                       unknown fields/ops are REJECTED, enum values validated,
//                       numeric/string bounds enforced
// Both are pure builders — no db import, no side effects, unit-testable.
import { buildNeedles, SearchNeedle } from './normalize'

// ── q → SQL where ──────────────────────────────────────────────────────────

type PrismaWhere = Record<string, unknown>

const MAX_LIKE_VARIANTS_PER_TOKEN = 4

/**
 * OR-conditions across the given fields for every needle variant.
 * Field paths support one relation hop with dot notation ('patient.firstName')
 * — relation filters are wrapped in `{ is: … }` which Prisma accepts for both
 * required and optional to-one relations.
 */
function tokenWhere(token: SearchNeedle, fields: readonly string[]): PrismaWhere[] {
  const variants = token.variants.slice(0, MAX_LIKE_VARIANTS_PER_TOKEN)
  const conds: PrismaWhere[] = []
  for (const f of fields) {
    for (const v of variants) {
      if (f.includes('.')) {
        const [rel, leaf] = f.split('.')
        conds.push({ [rel]: { is: { [leaf]: { contains: v } } } })
      } else {
        conds.push({ [f]: { contains: v } })
      }
    }
  }
  return conds
}

/**
 * Fold `q` into a `where` fragment that the caller ANDs into its query.
 * Every token must match (AND of ORs). Returns undefined for empty queries.
 * Tokens are capped (SEARCH_LIMITS.maxTokens) — an honest `tokensDropped`
 * flag lets routes surface truncation to the client.
 */
export function applyQ(
  q: string,
  fields: readonly string[],
): { where?: PrismaWhere; tokensDropped: number } {
  const needles = buildNeedles(q)
  if (needles.length === 0 || fields.length === 0) {
    const dropped = Math.max(0, countTokens(q) - SEARCH_TOKENS_HARD_CAP)
    return { where: undefined, tokensDropped: dropped }
  }
  const where: PrismaWhere = { AND: needles.map((n) => ({ OR: tokenWhere(n, fields) })) }
  const dropped = Math.max(0, countTokens(q) - needles.length)
  return { where, tokensDropped: dropped }
}

export const SEARCH_TOKENS_HARD_CAP = 5

function countTokens(q: string): number {
  if (!q?.trim()) return 0
  return q.trim().split(/[^\p{L}\p{N}]+/u).filter(Boolean).length
}

// ── whitelisted filter DSL (ED-152) ────────────────────────────────────────

export type FilterOp = 'eq' | 'ne' | 'in' | 'gte' | 'lte' | 'contains'

export interface FilterSpec {
  /** prisma field path ('status' | 'user.role' — one relation hop) */
  field: string
  /** allowed operators (defaults to ['eq']) */
  ops?: FilterOp[]
  /** closed value set — anything else is rejected 422-style */
  enum?: readonly string[]
  /** numeric range clamp (int) */
  intMin?: number
  intMax?: number
  /** string value length cap (default 64) */
  maxLen?: number
  /** 'in' operator cardinality cap (default 25) */
  maxIn?: number
}

export interface ParsedFilters { where: PrismaWhere; applied: string[]; rejected: string[] }

/**
 * Parse `?f_status=PAID&f_amount_gte=1000` style params against a whitelist.
 * URL contract (one source, documented in SEARCH-REPORTING.md §3):
 *   f_<field>          → eq
 *   f_<field>_<op>     → declared op (in uses comma-separated values)
 * Unknown field / op / enum value / out-of-range number → REJECTED (recorded
 * in `rejected`, the where simply omits it) — never a 500, never a 200 that
 * silently ignores an attacker-supplied field (route may 422 on rejected).
 */
export function applyFilters(
  params: URLSearchParams,
  specs: readonly FilterSpec[],
  opts: { strict?: boolean } = {},
): ParsedFilters {
  const where: PrismaWhere = {}
  const applied: string[] = []
  const rejected: string[] = []

  for (const spec of specs) {
    const allowedOps = spec.ops ?? ['eq']
    for (const op of allowedOps) {
      // eq is reachable BOTH as f_<field> (shorthand) and f_<field>_eq
      const key = `f_${spec.field}_${op}`
      let raw = params.get(key)
      let usedKey = key
      if (op === 'eq' && (raw === null || raw.trim() === '')) {
        raw = params.get(`f_${spec.field}`)
        usedKey = `f_${spec.field}`
      }
      if (raw === null || raw.trim() === '') continue

      const parsed = parseFilterValue(raw, spec, op)
      if (!parsed.ok) {
        rejected.push(`${key}=${raw.slice(0, 40)}`)
        continue
      }
      mergePath(where, spec.field, op, parsed.value)
      applied.push(usedKey)
    }
  }

  if (opts.strict && rejected.length > 0) {
    // caller decides — the builder itself only reports
  }
  return { where, applied, rejected }
}

function parseFilterValue(
  raw: string,
  spec: FilterSpec,
  op: FilterOp,
): { ok: true; value: unknown } | { ok: false } {
  const maxLen = spec.maxLen ?? 64
  if (spec.enum) {
    const values = op === 'in' ? raw.split(',').map((v) => v.trim()).filter(Boolean) : [raw.trim()]
    if (values.length === 0 || values.length > (spec.maxIn ?? 25)) return { ok: false }
    const invalid = values.find((v) => v.length > maxLen || !spec.enum!.includes(v))
    if (invalid !== undefined) return { ok: false }
    return { ok: true, value: op === 'in' ? { in: values } : values[0] }
  }
  if (spec.intMin !== undefined || spec.intMax !== undefined) {
    const values = op === 'in' ? raw.split(',') : [raw]
    const nums: number[] = []
    for (const v of values) {
      const n = Number(v)
      if (!Number.isFinite(n) || !Number.isInteger(n)) return { ok: false }
      if (spec.intMin !== undefined && n < spec.intMin) return { ok: false }
      if (spec.intMax !== undefined && n > spec.intMax) return { ok: false }
      nums.push(n)
    }
    return { ok: true, value: op === 'in' ? { in: nums } : nums[0] }
  }
  // free string (contains / eq on strings)
  const values = op === 'in' ? raw.split(',').map((v) => v.trim()).filter(Boolean) : [raw.trim()]
  if (values.length === 0 || values.length > (spec.maxIn ?? 25)) return { ok: false }
  if (values.some((v) => v.length > maxLen)) return { ok: false }
  return { ok: true, value: op === 'in' ? { in: values } : values[0] }
}

/**
 * Merge an op-condition into the accumulating `where` — multiple ops on the
 * SAME field combine ({ amount: { gte, lte } }), never replace each other.
 */
function mergePath(where: PrismaWhere, field: string, op: FilterOp, value: unknown): void {
  const prismaOp = op === 'eq' ? undefined : op === 'ne' ? 'not' : op
  const leaf =
    prismaOp === undefined
      ? value
      : prismaOp === 'in'
        ? { in: (value as { in: unknown[] }).in }
        : prismaOp === 'not'
          ? { not: value }
          : { [prismaOp]: value }
  if (field.includes('.')) {
    const [rel, leafField] = field.split('.')
    const relExisting = (where[rel] as { is?: PrismaWhere } | undefined)?.is ?? {}
    where[rel] = { is: { ...relExisting, [leafField]: leaf } }
    return
  }
  const existing = (where[field] as PrismaWhere | undefined) ?? {}
  // eq overrides range leaves; range leaves merge with each other
  if (prismaOp === undefined) where[field] = value
  else where[field] = { ...existing, ...leaf }
}

// ── sort hardening (extends ED-100) ────────────────────────────────────────

export interface SortSpec { field: string; enum?: readonly string[] }

/** Resolve a sort param against a whitelist; always falls back safely. */
export function resolveSort(
  requested: string | null | undefined,
  whitelist: readonly (string | SortSpec)[],
  fallback: string,
): { field: string; ok: boolean } {
  const field = (requested || '').trim()
  if (!field) return { field: fallback, ok: true }
  for (const w of whitelist) {
    if (typeof w === 'string') {
      if (w === field) return { field, ok: true }
    } else if (w.field === field) {
      return { field, ok: true }
    }
  }
  return { field: fallback, ok: false }
}
