// ── BabaHakim Backend · Unit of Work / Transactions (PHASE 08, ED-103) ────
// Application services compose multi-entity writes inside `withTransaction`.
// The Prisma client is an infrastructure detail — domain/application code
// depends on this port only. Failure anywhere rolls back EVERYTHING
// (e.g. checkout: order + items + invoice + stock + cart-clear is atomic).
import { db } from '@/lib/db'
import { logger } from '@/server/core/logger'

type PrismaTx = Parameters<Parameters<typeof db.$transaction>[0]>[0]

export type Tx = PrismaTx

/**
 * Atomic boundary. Retries once on transient SQLite write contention
 * ("SQLITE_BUSY") — safe for idempotent business writes.
 */
export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const attempt = async (): Promise<T> => db.$transaction(async (tx) => fn(tx), { timeout: 15_000, maxWait: 5_000 })
  try {
    return await attempt()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/SQLITE_BUSY|database is locked/i.test(msg)) {
      logger.warn('transaction retry on lock contention', { error: msg })
      await new Promise((r) => setTimeout(r, 150))
      return await attempt()
    }
    throw e
  }
}
