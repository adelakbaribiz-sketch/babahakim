// ── BabaHakim Backend · Malware Scanner (PHASE 10, ED-111) ─────────────────
// Layered defense-in-depth strategy (honest about what each layer is):
//
//   L0 route edge   — MIME allowlist + magic-byte sniff + declared/detected
//                     consistency (mediaFileService, rejects before storage)
//   L1 signatures   — EICAR test-file detection + embedded active-content
//                     markers (<?php, <script, eval(, ...) anywhere in the
//                     buffer → polyglot/carrier suspicion
//   L2 structure    — trailing data after the image end marker, RIFF size
//                     mismatch, executable headers (MZ/ELF) → suspicion
//   L3 re-encode    — every derived rendition is re-encoded by sharp, which
//                     strips metadata and neutralizes image-embedded payloads;
//                     the ORIGINAL is kept quarantined from anonymous access
//   L4 ClamAV       — clamd INSTREAM when MEDIA_CLAMAV_HOST/PORT is set
//                     (production); absent in dev → engine reports "heuristic"
//
// INFECTED → quarantine + owner/admin notification. SUSPECT → quarantine +
// manual review (staff can inspect the scan report via the version metadata).
// Findings never break the platform: scanning is one async job stage.
import { connect as netConnect, Socket } from 'net'

export interface ScanReport {
  status: 'CLEAN' | 'INFECTED' | 'SUSPECT'
  engine: string
  findings: string[]
  scannedAt: string
  clamAv: 'enabled' | 'skipped' | 'unavailable'
}

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'

const ACTIVE_CONTENT_MARKERS: Array<{ finding: string; needle: Buffer }> = [
  { finding: 'PHP_EMBED', needle: Buffer.from('<?php', 'latin1') },
  { finding: 'SCRIPT_EMBED', needle: Buffer.from('<script', 'latin1') },
  { finding: 'EVAL_CALL', needle: Buffer.from('eval(', 'latin1') },
  { finding: 'BASE64_DECODE', needle: Buffer.from('base64_decode', 'latin1') },
  { finding: 'POWERSHELL_EMBED', needle: Buffer.from('powershell', 'latin1') },
]

function indexOfAll(buf: Buffer, needle: Buffer): number {
  return buf.indexOf(needle)
}

/** L1: signature scan over the raw buffer. */
function scanSignatures(buf: Buffer): string[] {
  const findings: string[] = []
  if (buf.includes(Buffer.from(EICAR, 'latin1'))) findings.push('EICAR_TEST_SIGNATURE')
  for (const m of ACTIVE_CONTENT_MARKERS) {
    if (indexOfAll(buf, m.needle) !== -1) findings.push(m.finding)
  }
  return findings
}

/** L2: structural checks per container format. */
function scanStructure(buf: Buffer, mime: string): string[] {
  const findings: string[] = []
  if (buf.length >= 2 && buf[0] === 0x4d && buf[1] === 0x5a) findings.push('EXE_HEADER_MZ')
  if (buf.length >= 4 && buf.slice(0, 4).toString('latin1') === '\x7fELF') findings.push('EXE_HEADER_ELF')

  if (mime === 'image/jpeg') {
    const eoi = buf.lastIndexOf(Buffer.from([0xff, 0xd9]))
    if (eoi === -1) findings.push('JPEG_TRUNCATED_NO_EOI')
    else if (eoi < buf.length - 2) findings.push('TRAILING_DATA_AFTER_JPEG_EOI')
  }
  if (mime === 'image/png') {
    const iend = buf.lastIndexOf(Buffer.from('IEND', 'latin1'))
    if (iend === -1) findings.push('PNG_TRUNCATED_NO_IEND')
    else if (iend < buf.length - 8) findings.push('TRAILING_DATA_AFTER_PNG_IEND') // IEND + CRC(4)
  }
  if (mime === 'image/webp') {
    // RIFF<header:4><size:4>WEBP — size covers everything after byte 8
    if (buf.length >= 12 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') {
      const declared = buf.readUInt32LE(4) + 8
      if (declared !== buf.length) findings.push('WEBP_RIFF_SIZE_MISMATCH')
    }
  }
  if (mime === 'application/pdf') {
    const head = buf.slice(0, 1024).toString('latin1')
    if (head.includes('/JavaScript') || head.includes('/JS')) findings.push('PDF_EMBEDDED_JS')
    if (/\/(?:Open)?Action/.test(head)) findings.push('PDF_AUTO_ACTION')
  }
  return findings
}

/** L4: ClamAV clamd INSTREAM (session protocol, 30s budget). */
async function scanClamAv(buf: Buffer): Promise<{ verdict: 'CLEAN' | 'INFECTED' | 'unavailable'; detail?: string }> {
  const host = process.env.MEDIA_CLAMAV_HOST
  const port = process.env.MEDIA_CLAMAV_PORT ? Number(process.env.MEDIA_CLAMAV_PORT) : 3310
  if (!host) return { verdict: 'unavailable' }
  return new Promise((resolve) => {
    const socket: Socket = netConnect({ host, port, timeout: 30_000 })
    let response = ''
    const finish = (v: { verdict: 'CLEAN' | 'INFECTED' | 'unavailable'; detail?: string }) => {
      socket.destroy()
      resolve(v)
    }
    socket.on('timeout', () => finish({ verdict: 'unavailable', detail: 'clamd timeout' }))
    socket.on('error', (e) => finish({ verdict: 'unavailable', detail: e.message }))
    socket.on('data', (d) => {
      response += d.toString('latin1')
      if (response.includes('\n')) {
        const line = response.trim()
        if (line === 'stream: OK') finish({ verdict: 'CLEAN' })
        else if (line.startsWith('stream: ')) finish({ verdict: 'INFECTED', detail: line.slice(8) })
        else finish({ verdict: 'unavailable', detail: line })
      }
    })
    socket.on('connect', () => {
      const size = Buffer.alloc(4)
      size.writeUInt32BE(buf.length, 0)
      socket.write(Buffer.concat([Buffer.from('zINSTREAM\0', 'latin1'), size, buf, Buffer.alloc(4)]))
    })
  })
}

/**
 * Full async scan. `mime` is the *detected* (magic-byte) MIME from the route
 * edge, so structural checks run against the real container format.
 */
export async function scanBuffer(buf: Buffer, mime: string): Promise<ScanReport> {
  const findings: string[] = [...scanSignatures(buf), ...scanStructure(buf, mime)]
  const clam = await scanClamAv(buf)
  if (clam.verdict === 'INFECTED') findings.push(`CLAMAV:${clam.detail || 'UNKNOWN'}`)

  const hasVirus = findings.includes('EICAR_TEST_SIGNATURE') || findings.some((f) => f.startsWith('CLAMAV:'))
  const status: ScanReport['status'] = hasVirus ? 'INFECTED' : findings.length > 0 ? 'SUSPECT' : 'CLEAN'

  return {
    status,
    engine: clam.verdict === 'CLEAN' || clam.verdict === 'INFECTED' ? 'heuristic+clamav' : 'heuristic',
    findings,
    scannedAt: new Date().toISOString(),
    clamAv: clam.verdict === 'unavailable' ? (process.env.MEDIA_CLAMAV_HOST ? 'skipped' : 'unavailable') : 'enabled',
  }
}
