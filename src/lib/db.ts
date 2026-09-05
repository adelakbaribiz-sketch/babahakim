// ── BabaHakim Backend · Prisma Client (instrumented, PHASE 15 ED-174) ──────
// The single Prisma client. PHASE 08 created it noise-free; PHASE 15 wraps
// it in a client extension so EVERY query feeds the metrics registry:
//   db_queries_total{model,op}  db_query_ms{model,op}  db_errors_total
// The extension adds no behavior — it times `query()` and counts; the base
// client type is preserved for all existing call sites (cast at the seam).
// HMR: globalThis guard keeps ONE client (and therefore one extension) alive.
import { PrismaClient } from '@prisma/client'
import { METRIC_NAMES, inc, observe } from '@/server/core/metrics'

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient
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
          const start = performance.now()
          try {
            const result = await query(args)
            inc(METRIC_NAMES.dbQueries, labels)
            observe(METRIC_NAMES.dbLatency, labels, performance.now() - start)
            return result
          } catch (e) {
            inc(METRIC_NAMES.dbQueries, labels)
            inc(METRIC_NAMES.dbErrors, { op: operation })
            observe(METRIC_NAMES.dbLatency, labels, performance.now() - start)
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

export const db =
  globalForPrisma.prisma ??
  instrumented(
    new PrismaClient({
      // query logging is opt-in (BH_DB_LOG=1) — default noise-free (audit A14 fix)
      log: process.env.BH_DB_LOG === '1' ? ['query', 'warn', 'error'] : ['warn', 'error'],
    }),
  )

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
