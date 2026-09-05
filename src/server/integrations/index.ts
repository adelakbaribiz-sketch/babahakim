// ── BabaHakim External Integration Layer (PHASE 13) · public surface ──────
// Every service imports adapters from HERE (CI gate I2: no direct imports of
// providers/* outside this layer). Cross-cutting guarantees for ALL 9 kinds:
//   Timeout · Retry · Idempotency · ErrorHandling · Logging · Monitoring ·
//   Fallback · Credential safety (ED-135..150)
export * from './core/types'
export {
  resolveIntegrationConfig, resolveMode, CREDENTIAL_SPECS, redact, redactedJson, maskSecret,
  paymentSettings, smsSettings, emailSettings, mapsSettings, aiServiceSettings, shippingSettings,
  crmSettings, analyticsSettings, zarinpalMerchantId, zarinpalMerchantMasked, smsProviderKey,
  emailApiKey, shippingApiKey, crmApiKey, analyticsApiKey,
  __setIntegrationModeForTests,
} from './core/config'
export { callIntegration, callIntegrationQuietly, classifyHttpStatus, classifyNetworkError, logSyntheticCall } from './core/resilience'
export { integrationStatus, __resetRegistryForTests, __overrideForTests, payment, sms, email, maps, shipping, crm, analytics, storage } from './core/registry'
export { allCircuits, resetCircuit } from './core/circuit-breaker'
export { recentFailures, aggregate, purgeIntegrationLogs } from './core/telemetry'

// provider contracts (types only re-exported; instances via registry)
export type { PaymentProvider, CreatePaymentInput, CreatePaymentResult, VerifyPaymentInput, VerifyPaymentResult } from './providers/payment'
export type { SmsProvider, SendSmsInput, SendSmsResult } from './providers/sms'
export type { EmailProvider, SendEmailInput, SendEmailResult } from './providers/email'
export type { MapsProvider, GeocodeInput, GeocodeResult } from './providers/maps'
export type { ShippingProvider, RegisterShipmentInput, RegisterShipmentResult, TrackShipmentResult, ShipmentTrackStatus } from './providers/shipping'
export type { CrmProvider, CrmContact } from './providers/crm-analytics'
export type { AnalyticsProvider, AnalyticsEvent } from './providers/crm-analytics'
export type { StorageIntegration } from './providers/storage'
export { emailChannelEnabled } from './providers/email'
export { HttpAIProvider } from './providers/ai'
