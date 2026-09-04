// ── BabaHakim External Integration · Registry (PHASE 13, ED-150) ──────────
// THE single instantiation path for every adapter (CI gate I2/I8). Services
// resolve providers here — never `new SomeProvider()` at a call site.
// HMR-safe singleton cache keyed by (kind, mode) so dev hot-reloads don't
// leak adapter state; tests can reset or inject overrides.
import { IntegrationKind, ResolvedMode } from './types'
import { resolveIntegrationConfig, __setIntegrationModeForTests } from './config'
import { allCircuits, resetCircuit } from './circuit-breaker'
import { aggregate, recentFailures } from './telemetry'
import { getPaymentProvider, PaymentProvider } from '../providers/payment'
import { getSmsProvider, SmsProvider } from '../providers/sms'
import { getEmailProvider, EmailProvider } from '../providers/email'
import { getMapsProvider, MapsProvider } from '../providers/maps'
import { getCrmProvider, CrmProvider, getAnalyticsProvider, AnalyticsProvider } from '../providers/crm-analytics'
import { getShippingProvider, ShippingProvider } from '../providers/shipping'
import { getStorageIntegration, storageIntegrationConfig, StorageIntegration } from '../providers/storage'

const g = globalThis as unknown as {
  __bhIntegrationProviders?: Map<string, unknown>
  __bhIntegrationOverrides?: Map<string, unknown>
}
const cache: Map<string, unknown> = g.__bhIntegrationProviders ?? new Map()
g.__bhIntegrationProviders = cache
const overrides: Map<string, unknown> = g.__bhIntegrationOverrides ?? new Map()
g.__bhIntegrationOverrides = overrides

function cached<T>(kind: IntegrationKind, factory: () => T): T {
  const ov = overrides.get(kind)
  if (ov) return ov as T
  const key = `${kind}:${resolveIntegrationConfig(kind, 'x').mode}`
  if (!cache.has(key)) cache.set(key, factory())
  return cache.get(key) as T
}

// ── typed resolvers (public surface used by application services) ─────────
export function payment(): PaymentProvider { return cached('PAYMENT', getPaymentProvider) }
export function sms(): SmsProvider { return cached('SMS', getSmsProvider) }
export function email(): EmailProvider { return cached('EMAIL', getEmailProvider) }
export function maps(): MapsProvider { return cached('MAPS', getMapsProvider) }
export function shipping(): ShippingProvider { return cached('SHIPPING', getShippingProvider) }
export function crm(): CrmProvider { return cached('CRM', getCrmProvider) }
export function analytics(): AnalyticsProvider { return cached('ANALYTICS', getAnalyticsProvider) }
export function storage(): StorageIntegration { return cached('STORAGE', getStorageIntegration) }

/** Test helper: force a provider instance for one kind. */
export function __overrideForTests(kind: IntegrationKind, instance: unknown | undefined): void {
  if (instance) overrides.set(kind, instance)
  else overrides.delete(kind)
}

/** Test helper: full reset (providers, breakers, telemetry). */
export function __resetRegistryForTests(mode?: 'live' | 'mock' | 'auto'): void {
  cache.clear()
  overrides.clear()
  __setIntegrationModeForTests(mode ? (mode === 'live' ? 'LIVE' : mode === 'mock' ? 'MOCK' : 'AUTO') : undefined)
  for (const k of Object.keys(allCircuits())) resetCircuit(...(k.split(':') as [string, string]))
}

// ── status snapshots for the admin console ────────────────────────────────
export interface IntegrationStatusRow {
  kind: IntegrationKind
  mode: ResolvedMode
  requestedMode: string
  providerName: string
  credentials: { env: string; label: string; present: boolean }[]
  circuit: { state: string; consecutiveFailures: number; lastFailureCode?: string }
  stats: { total: number; successRate: number; p50: number; p95: number; lastError: { code: string; message: string; at: number } | null }
}

const PROVIDER_NAMES: Record<IntegrationKind, () => string> = {
  PAYMENT: () => payment().name,
  SMS: () => sms().name,
  EMAIL: () => email().name,
  MAPS: () => maps().name,
  AI: () => 'http-ai',
  STORAGE: () => storageIntegrationConfig().providerName,
  SHIPPING: () => shipping().name,
  CRM: () => crm().name,
  ANALYTICS: () => analytics().name,
}

/** Status of all 9 kinds: mode, credentials presence, circuit, telemetry. */
export function integrationStatus(): IntegrationStatusRow[] {
  const agg = new Map(aggregate().map((a) => [`${a.kind}:${a.provider}`, a]))
  const circuits = allCircuits()
  return (Object.keys(PROVIDER_NAMES) as IntegrationKind[]).map((kind) => {
    const providerName = PROVIDER_NAMES[kind]()
    const cfg = resolveIntegrationConfig(kind, providerName)
    const a = agg.get(`${kind}:${providerName}`)
    const c = circuits[`${kind}:${providerName}`]
    return {
      kind,
      mode: cfg.mode,
      requestedMode: cfg.requestedMode,
      providerName,
      credentials: cfg.credentials,
      circuit: { state: c?.state ?? 'CLOSED', consecutiveFailures: c?.consecutiveFailures ?? 0, lastFailureCode: c?.lastFailureCode },
      stats: {
        total: a?.total ?? 0,
        successRate: a?.successRate ?? 1,
        p50: a?.p50 ?? 0,
        p95: a?.p95 ?? 0,
        lastError: a?.lastError ?? null,
      },
    }
  })
}

export { recentFailures }
