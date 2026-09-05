// ── BabaHakim Integration · Storage Provider (PHASE 13, ED-147) ───────────
// STORAGE joins the unified integration layer: the PHASE 10 StorageDriver
// port (ED-109) stays THE abstraction; this module wraps it with call
// logging + telemetry + error mapping so storage health is visible in the
// SAME admin console as every other kind. The local driver needs no
// timeout/retry (fs) — S3/MinIO (ADR-0006, STORAGE_* env reserved) will
// inherit the full resilience stack when the driver lands (D-13-1).
import { getStorageDriver, StorageDriver } from '@/server/infrastructure/media/storage-driver'
import { callIntegrationQuietly } from '../core/resilience'
import { resolveIntegrationConfig } from '../core/config'

export interface StorageIntegration {
  readonly name: string
  readonly driver: StorageDriver
  put(key: string, data: Buffer): Promise<void>
  get(key: string): Promise<Buffer>
  delete(key: string): Promise<void>
  healthCheck(): Promise<{ ok: boolean; latencyMs: number; detail: string }>
}

class StorageIntegrationImpl implements StorageIntegration {
  readonly name: string
  readonly driver: StorageDriver

  constructor(driver: StorageDriver) {
    this.driver = driver
    this.name = driver.name
  }

  async put(key: string, data: Buffer): Promise<void> {
    await callIntegrationQuietly('STORAGE', this.name, 'storage.put', async () => {
      await this.driver.put(key, data)
      return { key, bytes: data.length }
    }, { request: { key, bytes: data.length }, policy: { idempotent: false, timeoutMs: 60_000, retries: 0 } })
  }

  async get(key: string): Promise<Buffer> {
    const r = await callIntegrationQuietly<Buffer>('STORAGE', this.name, 'storage.get', async () => {
      return this.driver.get(key)
    }, { request: { key }, policy: { idempotent: false, timeoutMs: 60_000, retries: 0 } })
    if (r === null) throw new Error(`storage get failed: ${key}`)
    return r
  }

  async delete(key: string): Promise<void> {
    await callIntegrationQuietly('STORAGE', this.name, 'storage.delete', async () => {
      await this.driver.delete(key)
      return { key }
    }, { request: { key }, policy: { idempotent: false, timeoutMs: 60_000, retries: 0 } })
  }

  async healthCheck(): Promise<{ ok: boolean; latencyMs: number; detail: string }> {
    const t0 = Date.now()
    try {
      // round-trip a probe object through the driver
      await this.driver.put('trash/integration-health-probe', Buffer.from('ok'))
      await this.driver.delete('trash/integration-health-probe')
      return { ok: true, latencyMs: Date.now() - t0, detail: `driver:${this.name}` }
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - t0, detail: e instanceof Error ? e.message : 'unavailable' }
    }
  }
}

const g = globalThis as unknown as { __bhStorageIntegration?: StorageIntegration }

export function getStorageIntegration(): StorageIntegration {
  if (!g.__bhStorageIntegration) {
    g.__bhStorageIntegration = new StorageIntegrationImpl(getStorageDriver())
  }
  return g.__bhStorageIntegration
}

/** Config snapshot (mode reflects driver availability, not credentials). */
export function storageIntegrationConfig() {
  return resolveIntegrationConfig('STORAGE', getStorageDriver().name)
}
