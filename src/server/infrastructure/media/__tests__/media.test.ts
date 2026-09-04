// ── PHASE 10 · Media Engine Unit Tests ────────────────────────────────────
// Pure units — no DB, no HTTP: scanner layers, signed-URL binding, policy
// single-source limits, storage-key structural safety. The async pipeline
// and access matrix are covered by tests/integration/media-engine.test.ts.
import { describe, test, expect } from 'bun:test'
import { scanBuffer } from '@/server/infrastructure/media/scanner'
import { signMediaUrl, verifyMediaSig } from '@/server/infrastructure/media/signed-url'
import {
  MEDIA_POLICY, maxBytesFor, resolveAccessClass, typeAllowedFor, isMediaCategory,
  toMedicalStatus, categoryPolicy,
} from '@/server/infrastructure/media/config'
import {
  assertSafeKey, renditionKey, inboxKey, quarantineKey, trashKey, extForMime,
  ZONES,
} from '@/server/infrastructure/media/storage-driver'
import { sniffMime, sha256Hex, sanitizeFileName } from '@/server/infrastructure/media/pipeline'

// ── helpers: minimal valid image containers ────────────────────────────────
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
function pngBuffer(tail: Buffer = Buffer.alloc(0)): Buffer {
  const iend = Buffer.concat([Buffer.from('00000000', 'hex'), Buffer.from('IEND'), Buffer.from('ae426082', 'hex')])
  return Buffer.concat([PNG_HEAD, iend, tail])
}
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'

// ══════════════════════ SCANNER (ED-111) ═══════════════════════════════════

describe('media scanner', () => {
  test('clean minimal PNG → CLEAN, heuristic engine, no findings', async () => {
    const r = await scanBuffer(pngBuffer(), 'image/png')
    expect(r.status).toBe('CLEAN')
    expect(r.findings.length).toBe(0)
    expect(r.engine).toBe('heuristic')
    expect(r.clamAv).toBe('unavailable') // no MEDIA_CLAMAV_HOST in dev
  })

  test('EICAR test signature → INFECTED (virus layer)', async () => {
    const buf = Buffer.concat([PNG_HEAD, Buffer.from(EICAR, 'latin1')])
    const r = await scanBuffer(buf, 'image/png')
    expect(r.status).toBe('INFECTED')
    expect(r.findings).toContain('EICAR_TEST_SIGNATURE')
  })

  test('embedded PHP polyglot → SUSPECT with PHP_EMBED finding', async () => {
    const buf = Buffer.concat([PNG_HEAD, Buffer.from('<?php system($_GET[cmd]); ?>', 'latin1')])
    const r = await scanBuffer(buf, 'image/png')
    expect(r.status).toBe('SUSPECT')
    expect(r.findings).toContain('PHP_EMBED')
  })

  test('trailing data after PNG IEND → SUSPECT (carrier detection)', async () => {
    const r = await scanBuffer(pngBuffer(Buffer.from('hidden-payload-after-image')), 'image/png')
    expect(r.status).toBe('SUSPECT')
    expect(r.findings).toContain('TRAILING_DATA_AFTER_PNG_IEND')
  })

  test('MZ executable header → SUSPECT', async () => {
    const buf = Buffer.concat([Buffer.from([0x4d, 0x5a]), Buffer.alloc(64)])
    const r = await scanBuffer(buf, 'image/png')
    expect(r.findings).toContain('EXE_HEADER_MZ')
  })

  test('JPEG without EOI → SUSPECT truncated', async () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
    const r = await scanBuffer(buf, 'image/jpeg')
    expect(r.findings).toContain('JPEG_TRUNCATED_NO_EOI')
  })

  test('WebP RIFF size mismatch → SUSPECT', async () => {
    const buf = Buffer.alloc(64)
    buf.write('RIFF', 0, 'latin1')
    buf.writeUInt32LE(10, 4) // lies about the size
    buf.write('WEBP', 8, 'latin1')
    const r = await scanBuffer(buf, 'image/webp')
    expect(r.findings).toContain('WEBP_RIFF_SIZE_MISMATCH')
  })

  test('PDF with embedded JS → SUSPECT', async () => {
    const buf = Buffer.concat([Buffer.from('%PDF-1.7\n/JavaScript (evil)\n', 'latin1'), Buffer.alloc(32)])
    const r = await scanBuffer(buf, 'application/pdf')
    expect(r.findings).toContain('PDF_EMBEDDED_JS')
  })
})

// ══════════════════════ SIGNED URLS (ED-112) ═══════════════════════════════

describe('media signed URLs', () => {
  test('mint + verify round-trip for the exact rendition', () => {
    const s = signMediaUrl('file123abc', 1, 'compressed', { ttlSec: 60 })
    const url = new URL(`http://x${s.path}`)
    expect(verifyMediaSig('file123abc', 1, 'compressed', url.searchParams.get('exp')!, url.searchParams.get('sig')!)).toBe(true)
  })

  test('variant is bound: swapping compressed→original must fail', () => {
    const s = signMediaUrl('file123abc', 1, 'compressed', { ttlSec: 60 })
    const url = new URL(`http://x${s.path}`)
    expect(verifyMediaSig('file123abc', 1, 'original', url.searchParams.get('exp')!, url.searchParams.get('sig')!)).toBe(false)
  })

  test('version is bound: v1 signature cannot fetch v2', () => {
    const s = signMediaUrl('file123abc', 1, 'compressed', { ttlSec: 60 })
    const url = new URL(`http://x${s.path}`)
    expect(verifyMediaSig('file123abc', 2, 'compressed', url.searchParams.get('exp')!, url.searchParams.get('sig')!)).toBe(false)
  })

  test('fileId is bound: signature does not transfer to another file', () => {
    const s = signMediaUrl('file123abc', 1, 'compressed', { ttlSec: 60 })
    const url = new URL(`http://x${s.path}`)
    expect(verifyMediaSig('otherfile9', 1, 'compressed', url.searchParams.get('exp')!, url.searchParams.get('sig')!)).toBe(false)
  })

  test('expired signature is rejected', async () => {
    const s = signMediaUrl('file123abc', 1, 'compressed', { ttlSec: 1 })
    const url = new URL(`http://x${s.path}`)
    expect(verifyMediaSig('file123abc', 1, 'compressed', url.searchParams.get('exp')!, url.searchParams.get('sig')!)).toBe(true)
    // 2.1s covers the 1s floor boundary (exp == now is still valid by design)
    await new Promise((r) => setTimeout(r, 2100))
    expect(verifyMediaSig('file123abc', 1, 'compressed', url.searchParams.get('exp')!, url.searchParams.get('sig')!)).toBe(false)
  })

  test('tampered signature is rejected (timing-safe compare path)', () => {
    const s = signMediaUrl('file123abc', 1, 'compressed', { ttlSec: 60 })
    const url = new URL(`http://x${s.path}`)
    const good = url.searchParams.get('sig')!
    const bad = (good.slice(0, 30) + (good[31] === 'a' ? 'b' : 'a')).slice(0, 32)
    expect(verifyMediaSig('file123abc', 1, 'compressed', url.searchParams.get('exp')!, bad)).toBe(false)
  })

  test('TTL is clamped to the policy maximum', () => {
    const s = signMediaUrl('file123abc', 1, 'thumb', { ttlSec: 99_999 })
    expect(s.exp - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(MEDIA_POLICY.signedUrl.maxTtlSec)
  })
})

// ══════════════════════ POLICY SINGLE SOURCE (ED-107) ═══════════════════════

describe('media policy', () => {
  test('size limits: staff headroom over patients, per category', () => {
    expect(maxBytesFor('MEDICAL_IMAGE', 'PATIENT')).toBe(10 * 1024 * 1024)
    expect(maxBytesFor('MEDICAL_IMAGE', 'ADMIN')).toBe(25 * 1024 * 1024)
    expect(maxBytesFor('AVATAR', 'PATIENT')).toBe(2 * 1024 * 1024)
    expect(maxBytesFor('DOCUMENT', 'DOCTOR')).toBe(20 * 1024 * 1024)
  })

  test('access class: MEDICAL_IMAGE is never PUBLIC, even if requested', () => {
    expect(resolveAccessClass('MEDICAL_IMAGE', 'PUBLIC')).toBe('PRIVATE')
    expect(resolveAccessClass('MEDICAL_IMAGE', 'TEMPORARY')).toBe('PRIVATE')
    expect(resolveAccessClass('PRODUCT_IMAGE', null)).toBe('PUBLIC')
    expect(resolveAccessClass('RECEIPT', 'TEMPORARY')).toBe('TEMPORARY')
  })

  test('unknown category falls back to PRIVATE (fail-closed)', () => {
    expect(resolveAccessClass('NOT_A_CATEGORY', 'PUBLIC')).toBe('PRIVATE')
    expect(isMediaCategory('NOT_A_CATEGORY')).toBe(false)
  })

  test('type ↔ category pairing is enforced', () => {
    expect(typeAllowedFor('MEDICAL_IMAGE', 'TONGUE')).toBe(true)
    expect(typeAllowedFor('MEDICAL_IMAGE', 'PRODUCT')).toBe(false)
    expect(typeAllowedFor('DOCUMENT', 'TONGUE')).toBe(false)
    expect(typeAllowedFor('PRODUCT_IMAGE', 'PRODUCT')).toBe(true)
  })

  test('engine status maps onto the MedicalImage vocabulary', () => {
    expect(toMedicalStatus('READY')).toBe('VALIDATED')
    expect(toMedicalStatus('REJECTED')).toBe('REJECTED')
    expect(toMedicalStatus('INFECTED')).toBe('REJECTED')
    expect(toMedicalStatus('PENDING')).toBe('PENDING')
  })

  test('policy table exposes public variant whitelists', () => {
    expect(categoryPolicy('PRODUCT_IMAGE').publicVariants).toContain('compressed')
    expect(categoryPolicy('MEDICAL_IMAGE').publicVariants.length).toBe(0)
  })
})

// ══════════════════════ STORAGE KEY SAFETY (ED-110) ═════════════════════════

describe('storage driver keys', () => {
  test('traversal attempts are rejected', () => {
    expect(() => assertSafeKey('files/private/../../etc/passwd')).toThrow()
    expect(() => assertSafeKey('..')).toThrow()
    expect(() => assertSafeKey('files/private/foo/../../bar')).toThrow()
  })

  test('absolute paths and backslashes are rejected', () => {
    expect(() => assertSafeKey('/etc/passwd')).toThrow()
    expect(() => assertSafeKey('files\\private\\x')).toThrow()
  })

  test('non-zoned keys are rejected (no naked writes; legacy uploads too)', () => {
    expect(() => assertSafeKey('etc/passwd')).toThrow()
    // 'uploads' is the pre-PHASE-10 flat zone: read by legacy code paths only,
    // never by the engine driver — so the driver rejects it by design.
    expect(() => assertSafeKey('uploads/foo.jpg')).toThrow()
  })

  test('zone-prefixed keys pass', () => {
    expect(() => assertSafeKey('files/private/abc/v1/original.jpg')).not.toThrow()
    expect(() => assertSafeKey('inbox/abc-v1-x')).not.toThrow()
    expect(() => assertSafeKey('quarantine/x')).not.toThrow()
    expect(() => assertSafeKey('trash/x/v1/a-thumb.jpg')).not.toThrow()
  })

  test('key layout is content-addressed and versioned', () => {
    expect(renditionKey(ZONES.filesPrivate, 'a'.repeat(64), 2, 'thumb', 'jpg'))
      .toBe('files/private/aaaaaaaaaaaaaaaa/v2/thumb.jpg')
    expect(inboxKey('f1', 1, 'b'.repeat(64))).toBe('inbox/bbbbbbbbbbbbbbbb-v1-f1')
    expect(quarantineKey('f1', 2, 'c'.repeat(64))).toBe('quarantine/cccccccccccccccc-v2-f1')
    expect(trashKey('d'.repeat(64), 3, 'f9', 'ai', 'jpg')).toBe('trash/dddddddddddddddd/v3/f9-ai.jpg')
  })

  test('mime → extension mapping', () => {
    expect(extForMime('image/jpeg')).toBe('jpg')
    expect(extForMime('image/png')).toBe('png')
    expect(extForMime('application/pdf')).toBe('pdf')
    expect(extForMime('application/x-unknown')).toBe('bin')
  })
})

// ══════════════════════ PIPELINE PURE HELPERS ═══════════════════════════════

describe('pipeline helpers', () => {
  test('sniffMime detects the real container format', () => {
    expect(sniffMime(pngBuffer())).toBe('image/png')
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])
    expect(sniffMime(jpg)).toBe('image/jpeg')
    expect(sniffMime(Buffer.from('plain text'))).toBe(null)
    expect(sniffMime(Buffer.from('%PDF-1.7 rest'))).toBe('application/pdf')
  })

  test('sha256Hex is stable and hex-encoded', () => {
    expect(sha256Hex(Buffer.from('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  test('sanitizeFileName strips path separators and control chars', () => {
    // (fileName is display metadata only — storage keys are content-addressed,
    // so residual leading dots carry no path semantics)
    expect(sanitizeFileName('../../etc/passwd')).toBe('.._.._etc_passwd')
    expect(sanitizeFileName('photo\n.jpg')).toBe('photo_.jpg')
    expect(sanitizeFileName('   ')).toBe(null)
    expect(sanitizeFileName(null)).toBe(null)
    expect(sanitizeFileName('x'.repeat(300))!.length).toBe(180)
  })
})
