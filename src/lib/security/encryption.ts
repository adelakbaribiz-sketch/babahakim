// PHASE 05 — Encryption at rest (AES-256-GCM) + anonymization helpers (ED-65/ED-69).
//
// Envelope format: v1:<iv-b64>:<tag-b64>:<ct-b64> — authenticated encryption;
// tampering fails the GCM tag check. Key from FIELD_ENC_KEY (32 bytes).
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'
import { getSecrets } from './env'

export function encryptField(plaintext: string): string {
  const key = getSecrets().encKey
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return ['v1', iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':')
}

export function decryptField(envelope: string): string | null {
  try {
    const [ver, ivB64, tagB64, ctB64] = envelope.split(':')
    if (ver !== 'v1') return null
    const key = getSecrets().encKey
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'))
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
    const pt = Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()])
    return pt.toString('utf8')
  } catch {
    return null // wrong key or tampered ciphertext — treat as unreadable
  }
}

// ── De-identification for learning datasets (ED-70, spec §11/§63) ──────

/** Deterministic pseudonym: same patient -> same code inside ONE dataset build,
 *  but no PII recoverable from it. Salt must be per-dataset, stored beside it. */
export function pseudonymize(patientKey: string, datasetSalt: string): string {
  return 'PS-' + createHash('sha256').update(`${datasetSalt}:${patientKey}`).digest('hex').slice(0, 16)
}

/** Redact free-text fields from data leaving the clinical context (exports, datasets). */
export function redactText(s: string | null | undefined): string | null {
  if (!s) return null
  return s
    .replace(/09\d{9}/g, '09*********') // Iranian mobiles
    .replace(/\b\d{10}\b/g, '**********') // national ids / postal codes
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
}
