// PHASE 05 — Secret management: env resolution with production fail-fast.
// Charter rule 6: no secrets in git. Dev fallbacks are ALLOWED but loud;
// production must provide real secrets or the process refuses to serve.
import { createHash } from 'crypto'

function required(name: string): string {
  const v = process.env[name]
  if (!v) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`[SECURITY] ${name} must be set in production — refusing to start (ED-59)`)
    }
    console.warn(`[SECURITY] ${name} not set — using derived DEV-ONLY secret (never in production)`)
    // Deterministic dev-only secret so restarts keep sessions valid; clearly not for prod
    return createHash('sha256').update(`babahakim-dev:${name}`).digest('hex')
  }
  return v
}

let cached: { jwtSecret: Uint8Array; signSecret: string; encKey: Buffer } | null = null

export function getSecrets() {
  if (cached) return cached
  const jwt = required('JWT_SECRET')
  if (jwt.length < 32 && process.env.NODE_ENV === 'production') {
    throw new Error('[SECURITY] JWT_SECRET must be >= 32 chars in production')
  }
  const enc = required('FIELD_ENC_KEY')
  let encKey: Buffer
  try {
    encKey = Buffer.from(enc, 'base64')
    if (encKey.length !== 32) throw new Error('bad length')
  } catch {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('[SECURITY] FIELD_ENC_KEY must be 32 bytes base64 in production')
    }
    encKey = createHash('sha256').update(enc).digest() // derive 32B in dev
  }
  cached = {
    jwtSecret: new TextEncoder().encode(jwt),
    signSecret: jwt,
    encKey,
  }
  return cached
}
