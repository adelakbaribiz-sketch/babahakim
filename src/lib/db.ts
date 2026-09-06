// ── BabaHakim Backend · Prisma Client (instrumented, PHASE 15 ED-174) ──────
// The single Prisma client. PHASE 08 created it noise-free; PHASE 15 wraps
// it in a client extension so EVERY query feeds the metrics registry:
//   db_queries_total{model,op}  db_query_ms{model,op}  db_errors_total
// The extension adds no behavior — it times `query()` and counts; the base
// client type is preserved for all existing call sites (cast at the seam).
// HMR: globalThis guard keeps ONE client (and therefore one extension) alive.
import { PrismaClient } from '@prisma/client'

// PHASE 16 (I8 fix, ED-137b pattern): lib/* must stay free of @/server/*
// imports (browser-bundle graph) — the metrics sink is INJECTED by bootstrap
// instead of imported (same seam discipline as setLogSink in PHASE 15).
export type DbMetricsSink = (labels: { op: string; entity: string }, ms: number, ok: boolean) => void
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient
  __bhDbMetricsSink?: DbMetricsSink
  // PHASE 17 (ED-187): chaos seam — a fault hook registered by the server-side
  // faults module (test/drill only). Same injection pattern as the metrics
  // sink: lib stays free of @/server imports (browser-bundle graph).
  __bhDbFaultHook?: () => void
}
/** Injected once by bootstrap — keeps this module in the client-safe graph. */
export function setDbMetricsSink(fn: DbMetricsSink): void {
  globalForPrisma.__bhDbMetricsSink = fn // globalThis: survives HMR reloads
}
/** PHASE 17: arm/clear the chaos fault hook (never armed in production). */
export function setDbFaultHook(fn: (() => void) | null): void {
  globalForPrisma.__bhDbFaultHook = fn ?? undefined
}

function instrumented(base: PrismaClient): PrismaClient {
  try {
    const extended = base.$extends({
      query: {
        $allOperations: async ({ operation, model, query, args }: {
          operation: string
          model?: string
          query: (args: unknown) => Promise<unknown>
          args: unknown
        }) => {
          const labels = { op: operation, entity: model ?? 'raw' }
          const sink = globalForPrisma.__bhDbMetricsSink
          const start = performance.now()
          try {
            // PHASE 17 (ED-187): fault-injection seam — throws a Prisma-shaped
            // P1001 when the db:down chaos fault is armed (test/drill only;
            // the hook is undefined in every other environment). Thrown inside
            // the timed region so db_errors_total counts it like a real outage.
            globalForPrisma.__bhDbFaultHook?.()
            const result = await query(args)
            sink?.(labels, performance.now() - start, true)
            return result
          } catch (e) {
            sink?.(labels, performance.now() - start, false)
            throw e
          }
        },
      },
    })
    // the extended client is structurally the PrismaClient for our call
    // graph; the cast documents the instrumentation seam (ED-174)
    return extended as unknown as PrismaClient
  } catch {
    // $extends unavailable (e.g. edge/worker runtime) — degrade to the base
    return base
  }
}

// ── PHASE 16 (ED-182): SQLite write-path tuning — WAL + NORMAL sync ────────
// Measured (perf-db-baseline.json): DELETE journal + synchronous=FULL costs
// ×7.47 per write and blocks readers during every write transaction. WAL is
// persistent in the DB file (the boot call is an idempotent re-assert so
// fresh/reset databases get it too); synchronous=NORMAL and busy_timeout are
// per-connection best-effort on the pooled connection we own. A failure here
// MUST degrade silently — tuning can never block boot.
let tuned = false
async function tuneSqlite(client: PrismaClient): Promise<void> {
  if (tuned) return
  tuned = true
  try {
    await client.$queryRaw`PRAGMA journal_mode=WAL`
    await client.$queryRaw`PRAGMA synchronous=NORMAL`
    await client.$queryRaw`PRAGMA busy_timeout=5000`
  } catch {
    // non-SQLite/managed environments — silently degrade (metrics stay honest)
  }
}

export const db =
  globalForPrisma.prisma ??
  instrumented(
    new PrismaClient({
      // query logging is opt-in (BH_DB_LOG=1) — default noise-free (audit A14 fix)
      log: process.env.BH_DB_LOG === '1' ? ['query', 'warn', 'error'] : ['warn', 'error'],
    }),
  )

// fire-and-forget: WAL re-assert races nothing (idempotent, guarded, ED-182)
void tuneSqlite(db)

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

/** Readiness ping — raw SELECT 1 with a hard 3s budget (never hangs probes). */
export async function dbPing(timeoutMs = 3000): Promise<{ ok: boolean; ms: number }> {
  const start = performance.now()
  try {
    await Promise.race([
      db.$queryRaw`SELECT 1`,
      new Promise((_, rej) => setTimeout(() => rej(new Error('db ping timeout')), timeoutMs)),
    ])
    return { ok: true, ms: Math.round(performance.now() - start) }
  } catch {
    return { ok: false, ms: Math.round(performance.now() - start) }
  }
}
