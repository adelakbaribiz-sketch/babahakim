// Iranian national ID (کد ملی) storage — blind index + encryption (server only).
//
// The raw value is NEVER stored or logged:
//   nationalIdHash = HMAC-SHA256(indexKey, normalized)  → unique login lookup
//   nationalIdEnc  = AES-256-GCM envelope (encryptField) → authorized display
// indexKey is derived from FIELD_ENC_KEY with a domain separator, so rotating
// JWT_SECRET never breaks logins. FIELD_ENC_KEY must stay stable (it already
// had to, for every encrypted field).
import { createHmac, createHash } from 'crypto'
import { getSecrets } from './env'
import { encryptField, decryptField } from './encryption'
import { normalizeNationalId } from '@/lib/national-id-format'

export { normalizeNationalId, isValidIranianNationalId, maskNationalId } from '@/lib/national-id-format'

let indexKey: Buffer | null = null
function getIndexKey(): Buffer {
  if (!indexKey) indexKey = createHash('sha256').update('bh:national-id-index:v1:').update(getSecrets().encKey).digest()
  return indexKey
}

/** Deterministic blind index — equal ids give equal hashes, nothing recoverable. */
export function nationalIdHash(raw: string): string {
  return createHmac('sha256', getIndexKey()).update(normalizeNationalId(raw)).digest('hex')
}

export function encryptNationalId(raw: string): string {
  return encryptField(normalizeNationalId(raw))
}

export function decryptNationalId(envelope: string | null | undefined): string | null {
  return envelope ? decryptField(envelope) : null
}
