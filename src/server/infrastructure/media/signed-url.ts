// ── BabaHakim Backend · Media Signed URLs (PHASE 10, ED-112) ────────────────
// Short-lived HMAC URLs for file renditions. The signature binds
// (fileId, version, variant, exp) — a URL minted for `compressed` CANNOT be
// flipped to `original` by editing the query string (fixes the pre-PHASE-10
// gap where only imageId+exp were covered). Verification is timing-safe and
// expiry is absolute epoch seconds.
import { createHmac, timingSafeEqual } from 'crypto'
import { getSecrets } from '@/lib/security/env'
import { MEDIA_POLICY } from './config'

export interface SignedMediaUrl {
  path: string
  exp: number
  sig: string
}

function signature(fileId: string, version: number, variant: string, exp: number): string {
  const mac = createHmac('sha256', getSecrets().signSecret)
    .update(`${fileId}.${version}.${variant}.${exp}`)
    .digest('hex')
  return mac.slice(0, 32)
}

/** Mint a signed URL for one exact rendition (default 5 minutes, max 1 hour). */
export function signMediaUrl(
  fileId: string, version: number, variant: string, opts: { ttlSec?: number; download?: boolean } = {},
): SignedMediaUrl {
  const ttl = Math.min(Math.max(1, opts.ttlSec ?? MEDIA_POLICY.signedUrl.defaultTtlSec), MEDIA_POLICY.signedUrl.maxTtlSec)
  const exp = Math.floor(Date.now() / 1000) + ttl
  const sig = signature(fileId, version, variant, exp)
  const q = new URLSearchParams({ v: String(version), variant, exp: String(exp), sig })
  if (opts.download) q.set('download', '1')
  return { path: `/api/v1/files/${fileId}/content?${q.toString()}`, exp, sig }
}

/** Verify (fileId, version, variant, exp, sig). Constant-time, expiry-checked. */
export function verifyMediaSig(
  fileId: string, version: number, variant: string, exp: string, sig: string,
): boolean {
  const expNum = parseInt(exp, 10)
  if (!Number.isFinite(expNum) || expNum < Math.floor(Date.now() / 1000)) return false
  if (!Number.isInteger(version) || version < 1) return false
  const expect = Buffer.from(signature(fileId, version, variant, expNum))
  const got = Buffer.from(String(sig || ''))
  return expect.length === got.length && timingSafeEqual(expect, got)
}
