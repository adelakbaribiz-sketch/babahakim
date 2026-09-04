// ── BabaHakim Backend · Cache (PHASE 08, ED-98) ────────────────────────────
// In-process TTL cache with LRU-ish trimming and stampede-safe `cached()`.
// The `CacheStore` port keeps a Redis/Memcached adapter a drop-in swap
// (constraint C2: local memory only for the current deployment).
interface Entry { value: unknown; expiresAt: number }

export interface CacheStore {
  get(key: string): Promise<unknown | undefined>
  set(key: string, value: unknown, ttlMs: number): Promise<void>
  del(key: string): Promise<void>
  clearPrefix(prefix: string): Promise<number>
}

const MAX_ENTRIES = 500

// globalThis-backed store: survives Next.js dev HMR module reloads — ALL module
// generations operate on the SAME underlying Map, so invalidation published by
// an older generation's event subscriber always clears the live generation's
// entries (PHASE 08 audit A16).
const g = globalThis as unknown as { __bhCacheMap?: Map<string, Entry> }

class MemoryCacheStore implements CacheStore {
  private store: Map<string, Entry> = g.__bhCacheMap ?? new Map<string, Entry>()
  constructor() {
    g.__bhCacheMap = this.store
  }

  private sweep() {
    const now = Date.now()
    for (const [k, e] of this.store) if (e.expiresAt <= now) this.store.delete(k)
    // bound memory: drop oldest-inserted entries (Map preserves insertion order)
    while (this.store.size > MAX_ENTRIES) {
      const oldest = this.store.keys().next().value
      if (oldest === undefined) break
      this.store.delete(oldest)
    }
  }

  async get(key: string) {
    const e = this.store.get(key)
    if (!e) return undefined
    if (e.expiresAt <= Date.now()) { this.store.delete(key); return undefined }
    return e.value
  }

  async set(key: string, value: unknown, ttlMs: number) {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs })
    if (this.store.size % 50 === 0) this.sweep()
  }

  async del(key: string) { this.store.delete(key) }

  async clearPrefix(prefix: string) {
    let n = 0
    for (const k of this.store.keys()) {
      if (k.startsWith(prefix)) { this.store.delete(k); n++ }
    }
    return n
  }
}

/** Swappable store (tests inject fakes; prod may inject Redis later). */
export const cacheStore: CacheStore = new MemoryCacheStore()

// in-flight de-dup: concurrent callers of the same key share one promise
const inflight = new Map<string, Promise<unknown>>()

/** Read-through cache — stampede-safe, errors are never cached. */
export async function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const hit = await cacheStore.get(key)
  if (hit !== undefined) return hit as T

  let p = inflight.get(key)
  if (!p) {
    p = (async () => {
      const value = await loader() // errors propagate to ALL awaiters, nothing cached
      await cacheStore.set(key, value, ttlMs)
      return value
    })()
    inflight.set(key, p)
    p.finally(() => inflight.delete(key)).catch(() => {})
  }
  return p as Promise<T>
}

export const cacheKeys = {
  products: (suffix: string) => `catalog:products:${suffix}`,
  dashboard: (role: string, userId: string) => `dash:${role}:${userId}`,
  questionnaire: () => 'questionnaire:active',
}

export const cacheTtl = {
  catalog: 60_000,
  dashboard: 15_000,
  questionnaire: 120_000,
}
