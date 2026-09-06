// ── Reporting SQL helpers (PHASE 14, ED-155) ───────────────────────────────
// Thin, typed helpers over Prisma $queryRaw so every report pushes
// aggregation INTO SQLite (GROUP BY / SUM / COUNT) instead of loading rows
// and reducing in JavaScript (the S-4 anti-pattern this phase eliminates).
//
// Table names: Prisma SQLite maps models 1:1 (no @@map in schema.prisma) —
// e.g. `MedicalCase`, `Payment`, `"Order"` (quoted: ORDER is a SQL keyword).
// All user-controlled values go through tagged-template parameters — never
// string interpolation. Bucket expressions are from a closed set.
import { db } from '@/lib/db'

export type GroupBy = 'day' | 'week' | 'month'

/** SQLite strftime format for each bucket granularity (closed set). */
export function bucketFormat(groupBy: GroupBy): string {
  if (groupBy === 'month') return '%Y-%m'
  if (groupBy === 'week') return '%Y-W%W'
  return '%Y-%m-%d'
}

export interface BucketRow {
  bucket: string
  [k: string]: unknown
}

/**
 * Grouped aggregation over a table with a createdAt time column.
 * `selectExpr` must be a STATIC string built by the report code (no user
 * input) — e.g. `COUNT(*) AS c, SUM(amount) AS total`.
 * Filters must be parameterized `?` placeholders with matching `params`.
 */
/**
 * Grouped time-bucket aggregation. Prisma SQLite stores DateTime as EPOCH
 * MILLISECONDS (INTEGER) — so window params MUST be ms numbers (passing ISO
 * strings silently matches nothing: SQLite type order INTEGER < TEXT) and
 * strftime needs the 'unixepoch' modifier on col/1000.
 */
export async function bucketAggregate(
  table: string,
  selectExpr: string,
  timeColumn: string,
  groupBy: GroupBy,
  fromMs: number,
  toMs: number,
  extraWhere = '',
  params: unknown[] = [],
): Promise<BucketRow[]> {
  const rows = await db.$queryRawUnsafe(
    `SELECT strftime('${bucketFormat(groupBy)}', "${timeColumn}" / 1000, 'unixepoch') AS bucket, ${selectExpr}
     FROM ${table}
     WHERE "${timeColumn}" >= ? AND "${timeColumn}" <= ? ${extraWhere}
     GROUP BY bucket ORDER BY bucket ASC`,
    fromMs, toMs, ...params,
  )
  return rows as BucketRow[]
}

/**
 * Flat grouped aggregation (non-time grouping, e.g. GROUP BY status).
 * Same safety contract: static SQL, parameterized values.
 */
export async function groupAggregate(
  table: string,
  selectExpr: string,
  groupExpr: string,
  where: string,
  params: unknown[] = [],
  orderBy = '',
  limit = 200,
): Promise<BucketRow[]> {
  const rows = await db.$queryRawUnsafe(
    `SELECT ${groupExpr} AS g, ${selectExpr}
     FROM ${table}
     WHERE ${where}
     GROUP BY g ${orderBy ? `ORDER BY ${orderBy}` : ''}
     LIMIT ${Math.trunc(limit)}`,
    ...params,
  )
  return rows as BucketRow[]
}

/** Coerce SQLite aggregates (number | bigint | null) to JS numbers. */
export function num(v: unknown): number {
  if (v === null || v === undefined) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function ms(d: Date): number {
  return d.getTime()
}
