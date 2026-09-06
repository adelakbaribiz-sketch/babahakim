// ── Report Export · XLSX (PHASE 14, ED-156) ────────────────────────────────
// Minimal, dependency-free Office Open XML workbook writer:
//   • ZIP container with STORED (uncompressed) entries + CRC-32 — a valid
//     archive by the PKWARE APPNOTE spec, openable by Excel/LibreOffice/
//     openpyxl without any external library.
//   • One worksheet, inline strings (<is><t>), a bold header row via a
//     minimal styles.xml, RTL sheet view when lang=fa (§39/§69 i18n).
// Numeric cells stay numbers (tabular analysis works); dates ISO strings.
//
// Why hand-rolled: SheetJS (npm `xlsx`) is unmaintained on the public
// registry; exceljs pulls a large dep tree for one bounded use case. The
// format subset here is ~150 lines and fully covered by tests.
import type { ExportTable } from './csv'

// ── CRC-32 (IEEE 802.3 polynomial, standard table) ─────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// ── ZIP writer (STORED entries only) ───────────────────────────────────────
interface ZipEntry { name: string; data: Uint8Array }

function makeZip(entries: ZipEntry[]): Buffer {
  const chunks: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8')
    const crc = crc32(e.data)
    // local file header (30 bytes + name)
    const local = Buffer.alloc(30 + nameBuf.length)
    local.writeUInt32LE(0x04034b50, 0) // signature
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0, 6) // flags
    local.writeUInt16LE(0, 8) // method: STORED
    local.writeUInt16LE(0, 10) // mod time
    local.writeUInt16LE(0x21, 12) // mod date (1996-02-01, DOS epoch fine)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(e.data.length, 18)
    local.writeUInt32LE(e.data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    nameBuf.copy(local, 30)
    chunks.push(local, Buffer.from(e.data))

    // central directory record (46 bytes + name)
    const c = Buffer.alloc(46 + nameBuf.length)
    c.writeUInt32LE(0x02014b50, 0)
    c.writeUInt16LE(20, 4) // version made by
    c.writeUInt16LE(20, 6) // version needed
    c.writeUInt16LE(0, 8)
    c.writeUInt16LE(0, 10) // stored
    c.writeUInt16LE(0, 12)
    c.writeUInt16LE(0x21, 14)
    c.writeUInt32LE(crc, 16)
    c.writeUInt32LE(e.data.length, 20)
    c.writeUInt32LE(e.data.length, 24)
    c.writeUInt16LE(nameBuf.length, 28)
    c.writeUInt16LE(0, 30) // extra len
    c.writeUInt16LE(0, 32) // comment len
    c.writeUInt16LE(0, 34) // disk number
    c.writeUInt16LE(0, 36) // internal attrs
    c.writeUInt32LE(0, 38) // external attrs
    c.writeUInt32LE(offset, 42)
    nameBuf.copy(c, 46)
    central.push(c)

    offset += local.length + e.data.length
  }

  const centralBuf = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([...chunks, centralBuf, end])
}

// ── XML helpers ────────────────────────────────────────────────────────────
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // strip control chars (XML 1.0 illegal)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
}

function colLetter(i: number): string {
  let s = ''
  let n = i
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  }
  return s
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets>
</workbook>`

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FF173F76"/><name val="Calibri"/></font>
</fonts>
<fills count="2">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

function cellXml(key: string, colIndex: number, rowIndex: number, value: unknown): string {
  const ref = `${colLetter(colIndex)}${rowIndex}`
  if (value === null || value === undefined) return ''
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}"${colIndex === 0 ? ' s="1"' : ''}><v>${value}</v></c>`
  }
  if (typeof value === 'boolean') {
    return `<c r="${ref}" t="b"${colIndex === 0 ? ' s="1"' : ''}><v>${value ? 1 : 0}</v></c>`
  }
  const s = value instanceof Date ? value.toISOString() : String(value)
  return `<c r="${ref}" t="inlineStr"${colIndex === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${xmlEscape(s)}</t></is></c>`
}

/**
 * Build an .xlsx workbook from an ExportTable.
 * `lang=fa` renders the sheet right-to-left (sheetView rightToLeft) per
 * §39 — the workbook stays byte-compatible otherwise.
 */
export function toXlsx(table: ExportTable, lang: 'fa' | 'en' = 'fa'): Buffer {
  const cols = table.columns.map((c) => (lang === 'fa' ? c.fa : c.en))
  const rowsXml: string[] = []

  // title row (merged look: bold text in A1)
  rowsXml.push(`<row r="1"><c r="A1" t="inlineStr" s="1"><is><t xml:space="preserve">${xmlEscape(lang === 'fa' ? table.titleFa : table.titleEn)}</t></is></c></row>`)

  // meta lines
  let r = 2
  for (const m of table.metaLines ?? []) {
    rowsXml.push(`<row r="${r}"><c r="A${r}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(m)}</t></is></c></row>`)
    r++
  }
  r++ // blank separator row

  // header row
  const headerRow = r
  rowsXml.push(`<row r="${r}">` + cols.map((c, i) => cellXml(c, i, r, c)).join('') + `</row>`)
  r++

  // data rows
  for (const row of table.rows) {
    const cells = table.columns.map((c, i) => cellXml(c.key, i, r, row[c.key])).join('')
    if (cells) rowsXml.push(`<row r="${r}">${cells}</row>`)
    r++
  }

  // totals row
  if (table.totals && Object.keys(table.totals).length > 0) {
    const cells = table.columns
      .map((c, i) => (c.key in table.totals! ? cellXml(c.key, i, r, table.totals![c.key]) : ''))
      .join('')
    if (cells) rowsXml.push(`<row r="${r}">${cells}</row>`)
  }

  const rtl = lang === 'fa' ? ' rightToLeft="1"' : ''
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"${rtl}><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${table.columns.map((_, i) => `<col min="${i + 1}" max="${i + 1}" width="${i === 0 ? 26 : 18}" customWidth="1"/>`).join('')}</cols>
<sheetData>${rowsXml.join('')}</sheetData>
</worksheet>`

  return makeZip([
    { name: '[Content_Types].xml', data: Buffer.from(CONTENT_TYPES, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(ROOT_RELS, 'utf8') },
    { name: 'xl/workbook.xml', data: Buffer.from(WORKBOOK, 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(WORKBOOK_RELS, 'utf8') },
    { name: 'xl/styles.xml', data: Buffer.from(STYLES, 'utf8') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet, 'utf8') },
  ])
}
