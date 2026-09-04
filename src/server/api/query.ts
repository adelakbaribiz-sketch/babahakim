// ── BabaHakim Backend · List Query Contract (PHASE 08, ED-100) ────────────
// ONE standard for pagination / sorting / search on every list endpoint:
//   ?page=1&limit=20&sort=createdAt&order=desc&q=...
// Sorting is a whitelist per endpoint (injection-safe); limits are clamped;
// invalid values fall back to defaults (never 500). Endpoints add their own
// domain filters on top of this parsed base.
import { z } from 'zod'

export interface ListQuery {
  page: number
  limit: number
  offset: number
  sort: string
  order: 'asc' | 'desc'
  q: string
  raw: URLSearchParams
}

export const DEFAULT_SORT_FIELDS = ['createdAt', 'updatedAt'] as const

export function parseListQuery(
  url: string,
  opts: {
    defaultLimit?: number
    maxLimit?: number
    defaultSort?: string
    sortable?: readonly string[]
    defaultOrder?: 'asc' | 'desc'
  } = {},
): ListQuery {
  const raw = new URL(url).searchParams
  const defaultLimit = opts.defaultLimit ?? 20
  const maxLimit = opts.maxLimit ?? 100
  const sortable = opts.sortable ?? DEFAULT_SORT_FIELDS

  const num = (key: string, fallback: number, min: number, max: number) => {
    const v = raw.get(key)
    if (v === null || v.trim() === '' || !Number.isFinite(Number(v))) return fallback
    return Math.min(Math.max(Math.trunc(Number(v)), min), max)
  }
  const page = num('page', 1, 1, 10_000)
  const limit = num('limit', defaultLimit, 1, maxLimit)

  let sort = raw.get('sort') || opts.defaultSort || 'createdAt'
  if (!sortable.includes(sort)) sort = opts.defaultSort || 'createdAt'

  const order = raw.get('order') === 'asc' ? 'asc' : opts.defaultOrder ?? 'desc'

  return {
    page, limit, offset: (page - 1) * limit, sort, order,
    q: (raw.get('q') || '').trim().slice(0, 120),
    raw,
  }
}

/** zod schema for body-driven single filters used by several endpoints. */
export const idSchema = z.string().min(1).max(64)
