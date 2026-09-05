// ── BabaHakim External Integration Core · Config (PHASE 13, ED-136/137) ───
// Single reader of integration env vars — NOTHING else may read these keys
// (CI gate I5 enforces it). Responsibilities:
//   1. credential resolution (fail-safe: LIVE only when complete — ED-138)
//   2. secret masking for logs/persistence (ED-137)
//   3. credential PRESENCE reporting for the admin console (booleans only)
import { IntegrationKind, IntegrationMode, ResolvedMode } from './types'

export interface CredentialSpec {
  env: string
  label: string
}

export interface IntegrationConfig {
  kind: IntegrationKind
  mode: ResolvedMode
  requestedMode: IntegrationMode
  providerName: string
  /** presence booleans ONLY — values never leave this module (ED-137) */
  credentials: { env: string; label: string; present: boolean }[]
  timeoutMs: number
}

const MASK = '****'

/** Env reader with whitespace trim; empty string = absent. */
function env(key: string): string | undefined {
  const v = process.env[key]
  if (v === undefined) return undefined
  const t = v.trim()
  return t.length > 0 ? t : undefined
}

/** Global override — TESTS ONLY (see __setIntegrationModeForTests). */
const g = globalThis as unknown as { __bhIntegrationModeOverride?: IntegrationMode }
export function __setIntegrationModeForTests(mode: IntegrationMode | undefined): void {
  if (mode) g.__bhIntegrationModeOverride = mode
  else delete g.__bhIntegrationModeOverride
}

function requestedMode(): IntegrationMode {
  const raw = (g.__bhIntegrationModeOverride ?? env('INTEGRATION_MODE') ?? 'auto').toLowerCase()
  if (raw === 'live' || raw === 'mock') return raw.toUpperCase() as IntegrationMode
  return 'AUTO'
}

/** ED-138 fail-safe mode resolution. LIVE demanded but creds missing → MOCK
 *  with a loud warning (never a live call with half-configured credentials). */
export function resolveMode(kind: IntegrationKind, required: CredentialSpec[]): { mode: ResolvedMode; requested: IntegrationMode } {
  const requested = requestedMode()
  const missing = required.filter((c) => !env(c.env))
  if (requested === 'MOCK') return { mode: 'mock', requested }
  if (missing.length === 0) return { mode: 'live', requested }
  if (requested === 'LIVE') {
    // fail-safe, not fail-open: explicitly-live without credentials degrades
    // to mock and is loudly visible in logs + admin console.
    return { mode: 'mock', requested }
  }
  return { mode: 'mock', requested }
}

// ── per-kind credential contracts (spec §51 env list) ─────────────────────
export const CREDENTIAL_SPECS: Record<IntegrationKind, CredentialSpec[]> = {
  PAYMENT: [
    { env: 'ZARINPAL_MERCHANT_ID', label: 'Zarinpal Merchant ID' },
  ],
  SMS: [
    { env: 'SMS_PROVIDER_KEY', label: 'Kavenegar API key' },
  ],
  EMAIL: [
    { env: 'EMAIL_API_URL', label: 'Mailer API URL' },
    { env: 'EMAIL_API_KEY', label: 'Mailer API key' },
    { env: 'EMAIL_FROM', label: 'From address' },
  ],
  MAPS: [], // Nominatim is key-less; UA is a policy header, not a secret
  AI: [
    { env: 'AI_SERVICE_URL', label: 'Inference service URL' },
    { env: 'AI_SERVICE_KEY', label: 'Inference service key' },
  ],
  STORAGE: [], // local driver needs none; S3 specs reserved (STORAGE_KEY/SECRET)
  SHIPPING: [
    { env: 'SHIPPING_API_URL', label: 'Courier API URL' },
    { env: 'SHIPPING_API_KEY', label: 'Courier API key' },
  ],
  CRM: [
    { env: 'CRM_API_URL', label: 'CRM API URL' },
    { env: 'CRM_API_KEY', label: 'CRM API key' },
  ],
  ANALYTICS: [
    { env: 'ANALYTICS_ENDPOINT', label: 'Analytics endpoint' },
    { env: 'ANALYTICS_API_KEY', label: 'Analytics key' },
  ],
}

/** Extra non-secret settings (exported for adapters; not credentials). */
export function paymentSettings() {
  return {
    sandbox: (env('ZARINPAL_ENV') || 'sandbox') !== 'live',
    callbackBase: env('ZARINPAL_CALLBACK_BASE') || '',
  }
}

// ── credential VALUE getters (server-only; the single source after I5) ────
// Adapters and factories receive credentials through these — never
// process.env.* at a call site (ED-136 credential discipline).
export function zarinpalMerchantId(): string { return env('ZARINPAL_MERCHANT_ID') || '' }
export function zarinpalMerchantMasked(): string { const v = zarinpalMerchantId(); return v ? maskSecret(v) : 'MOCK-MERCHANT' }
export function smsProviderKey(): string { return env('SMS_PROVIDER_KEY') || '' }
export function emailApiKey(): string { return env('EMAIL_API_KEY') || '' }
export function shippingApiKey(): string { return env('SHIPPING_API_KEY') || '' }
export function crmApiKey(): string { return env('CRM_API_KEY') || '' }
export function analyticsApiKey(): string { return env('ANALYTICS_API_KEY') || '' }

export function smsSettings() {
  return { provider: env('SMS_PROVIDER') || 'kavenegar', sender: env('SMS_SENDER') || '' }
}

export function emailSettings() {
  return { url: env('EMAIL_API_URL') || '', from: env('EMAIL_FROM') || '', enabled: env('EMAIL_ENABLED') === 'true' }
}

export function mapsSettings() {
  return { userAgent: env('MAPS_USER_AGENT') || 'BabaHakim/1.0' }
}

export function aiServiceSettings() {
  return { url: env('AI_SERVICE_URL') || '', key: env('AI_SERVICE_KEY') || '' }
}

export function shippingSettings() {
  return { url: env('SHIPPING_API_URL') || '' }
}

export function crmSettings() {
  return { url: env('CRM_API_URL') || '' }
}

export function analyticsSettings() {
  return { endpoint: env('ANALYTICS_ENDPOINT') || '' }
}

/** Full config snapshot per kind — for the registry and admin console. */
export function resolveIntegrationConfig(kind: IntegrationKind, providerName: string): IntegrationConfig {
  const specs = CREDENTIAL_SPECS[kind]
  const { mode, requested } = resolveMode(kind, specs)
  return {
    kind,
    mode,
    requestedMode: requested,
    providerName,
    credentials: specs.map((c) => ({ env: c.env, label: c.label, present: Boolean(env(c.env)) })),
    timeoutMs: 15_000,
  }
}

// ── secret masking (ED-137) ────────────────────────────────────────────────

const SENSITIVE_KEY_RE = /(token|secret|password|passwd|authorization|api[-_]?key|merchant[-_]?id|credential|sender|session|cookie)/i
const SENSITIVE_HEADER_RE = /^(authorization|cookie|set-cookie|x-api-key)$/i
const MAX_FIELD = 512 // per-field cap for redacted payloads

/** Mask a secret: keep a stable 4-char prefix for correlation, hide the rest. */
export function maskSecret(value: string): string {
  if (value.length <= 4) return MASK
  return `${value.slice(0, 4)}${MASK}(${value.length})`
}

/**
 * Deep redaction of any JSON-able payload before logging/persistence.
 * - keys that look secret → masked value
 * - Authorization-style headers → masked
 * - long strings truncated to MAX_FIELD
 * Returns a plain object safe to store in IntegrationCallLog.requestRedacted.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]'
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return value.length > MAX_FIELD ? `${value.slice(0, MAX_FIELD)}…(${value.length})` : value
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.length > 20 ? [...value.slice(0, 20).map((v) => redact(v, depth + 1)), `[+${value.length - 20}]`] : value.map((v) => redact(v, depth + 1))
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_HEADER_RE.test(k)) out[k] = MASK
      else if (SENSITIVE_KEY_RE.test(k)) out[k] = typeof v === 'string' ? maskSecret(v) : MASK
      else out[k] = redact(v, depth + 1)
    }
    return out
  }
  return String(value)
}

/** Compact JSON string of a redacted payload (bounded, safe for TEXT column). */
export function redactedJson(value: unknown): string | null {
  if (value === undefined || value === null) return null
  try {
    return JSON.stringify(redact(value))
  } catch {
    return '{"note":"unserializable"}'
  }
}
