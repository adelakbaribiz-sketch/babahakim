// ── Report Export · PDF (PHASE 14, ED-156) ─────────────────────────────────
// pdfkit + FreeSerif (Arabic-capable TTF present in the runtime image).
// Verified: fontkit shapes Persian correctly (contextual forms + lam-alef
// ligature) and pdfkit emits glyphs in visual order — pure-RTL lines render
// correctly; mixed bidi rows put numbers inside the RTL line (acceptable for
// tabular reports; documented as D-14-4 for a full bidi engine).
// Layout: A4, BabaHakim brand header band, meta block, zebra table, totals
// row, footer pagination. Numbers render LTR via mono font (§39 / §69 i18n).
import PDFDocument from 'pdfkit'
import { existsSync } from 'node:fs'
import { brand, docPalette } from '@/design-system/tokens'
import type { ExportTable } from './csv'

// Font resolution: env override → Linux runtime image → Windows system fonts.
// The Linux-only literals made every PDF export throw ENOENT on Windows hosts.
function pickFont(envKey: string, candidates: string[]): string {
  const fromEnv = process.env[envKey]
  if (fromEnv && existsSync(fromEnv)) return fromEnv
  return candidates.find((p) => existsSync(p)) ?? candidates[0]
}
const WIN_FONTS = (process.env.WINDIR || 'C:\\Windows') + '\\Fonts\\'
const FA_FONT = pickFont('BH_PDF_FONT', ['/usr/share/fonts/truetype/freefont/FreeSerif.ttf', WIN_FONTS + 'tahoma.ttf', WIN_FONTS + 'arial.ttf'])
const FA_FONT_BOLD = pickFont('BH_PDF_FONT_BOLD', ['/usr/share/fonts/truetype/freefont/FreeSerifBold.ttf', WIN_FONTS + 'tahomabd.ttf', WIN_FONTS + 'arialbd.ttf', FA_FONT])
const MONO_FONT = pickFont('BH_PDF_FONT_MONO', ['/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', WIN_FONTS + 'consola.ttf', WIN_FONTS + 'cour.ttf', FA_FONT])

// BabaHakim official palette (§3) — imported from the token source; the PDF
// renderer cannot use CSS vars, so literals come from design-system/tokens
const BRAND_DARK = brand.primaryDark
const BRAND = brand.primary
const BRAND_LIGHT = brand.primaryLight
const NEUTRAL = brand.neutral

const MONEY_HINT = /amount|total|revenue|income|expenses|profit|value|paid|commission|price/i

export interface PdfOptions {
  lang: 'fa' | 'en'
  windowText?: string
  generatedAt?: string
}

function fmtCell(v: unknown, key: string): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? '✓' : '—'
  if (typeof v === 'number') {
    if (MONEY_HINT.test(key)) return v.toLocaleString('en-US')
    return String(v)
  }
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v)
}

/** Build a PDF buffer for an ExportTable. */
export async function toPdf(table: ExportTable, opts: PdfOptions): Promise<Buffer> {
  const lang = opts.lang
  const rtl = lang === 'fa'
  const doc = new PDFDocument({ size: 'A4', margin: 36, bufferPages: true })
  doc.font(FA_FONT, 10)

  const pageW = doc.page.width
  const pageH = doc.page.height
  const margin = 36
  let y = margin

  // ── header band ──
  doc.rect(0, 0, pageW, 56).fill(BRAND_DARK)
  doc.font(FA_FONT_BOLD, 16).fillColor('#FFFFFF')
  const title = rtl ? table.titleFa : table.titleEn
  if (rtl) {
    doc.text(title, margin, 18, { width: pageW - margin * 2, align: 'right' })
  } else {
    doc.text(title, margin, 18, { width: pageW - margin * 2, align: 'left' })
  }
  doc.font(FA_FONT, 8).fillColor(BRAND_LIGHT)
  const brandLine = rtl
    ? 'باباحکیم — پلتفرم تحلیل تصویر زبان'
    : 'BabaHakim — AI tongue analysis platform'
  if (rtl) doc.text(brandLine, margin, 40, { width: pageW - margin * 2, align: 'right' })
  else doc.text(brandLine, margin, 40, { width: pageW - margin * 2, align: 'left' })
  y = 68

  // ── meta block ──
  doc.font(FA_FONT, 8).fillColor(docPalette.textMeta)
  const meta: string[] = []
  if (opts.windowText) meta.push(opts.windowText)
  if (opts.generatedAt) meta.push(`${rtl ? 'تولید' : 'Generated'}: ${opts.generatedAt}`)
  meta.push(`${rtl ? 'تعداد ردیف' : 'Rows'}: ${table.rows.length}`)
  const metaText = meta.join('  ·  ')
  if (rtl) doc.text(metaText, margin, y, { width: pageW - margin * 2, align: 'right' })
  else doc.text(metaText, margin, y, { width: pageW - margin * 2, align: 'left' })
  y += 26

  // ── table geometry ──
  const cols = table.columns.map((c) => (rtl ? c.fa : c.en))
  const colW = Math.floor((pageW - margin * 2) / Math.max(1, cols.length))
  const rowH = 20

  const headerRow = () => {
    doc.rect(margin, y, pageW - margin * 2, rowH).fill(BRAND)
    doc.font(FA_FONT_BOLD, 8.5).fillColor('#FFFFFF')
    let x = rtl ? pageW - margin - colW : margin
    cols.forEach((c) => {
      const cellText = String(c).slice(0, 22)
      doc.text(cellText, x + 4, y + 6, { width: colW - 8, align: rtl ? 'right' : 'left' })
      x += rtl ? -colW : colW
    })
    y += rowH
  }
  headerRow()

  // ── rows ──
  doc.font(FA_FONT, 8)
  let zebra = false
  for (const row of table.rows) {
    if (y + rowH > pageH - 48) {
      doc.addPage()
      y = margin
      headerRow()
      doc.font(FA_FONT, 8)
    }
    if (zebra) doc.rect(margin, y, pageW - margin * 2, rowH).fill(docPalette.zebraRow)
    zebra = !zebra
    let x = rtl ? pageW - margin - colW : margin
    for (const c of table.columns) {
      const v = row[c.key]
      const isNumeric = typeof v === 'number'
      const text = fmtCell(v, c.key).slice(0, 30)
      if (text) {
        if (isNumeric) {
          doc.font(MONO_FONT, 7.5).fillColor(BRAND_DARK)
          doc.text(text, x + 4, y + 6, { width: colW - 8, align: rtl ? 'right' : 'left' })
          doc.font(FA_FONT, 8)
        } else {
          doc.fillColor(docPalette.textStrong)
          doc.text(text, x + 4, y + 6, { width: colW - 8, align: rtl ? 'right' : 'left' })
        }
      }
      x += rtl ? -colW : colW
    }
    y += rowH
  }

  // ── totals row ──
  if (table.totals && Object.keys(table.totals).length > 0) {
    if (y + rowH > pageH - 48) { doc.addPage(); y = margin }
    doc.rect(margin, y, pageW - margin * 2, rowH).fill(NEUTRAL)
    doc.font(FA_FONT_BOLD, 8.5).fillColor(BRAND_DARK)
    let x = rtl ? pageW - margin - colW : margin
    for (const c of table.columns) {
      const v = c.key in table.totals ? fmtCell(table.totals[c.key], c.key) : ''
      if (v) doc.text(v, x + 4, y + 6, { width: colW - 8, align: rtl ? 'right' : 'left' })
      x += rtl ? -colW : colW
    }
    y += rowH
  }

  // ── footer (page numbers) ──
  const range = doc.bufferedPageRange()
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i)
    doc.font(FA_FONT, 7).fillColor(docPalette.textFaint)
    const footer = `${rtl ? 'صفحه' : 'Page'} ${i - range.start + 1} / ${range.count}  ·  BabaHakim`
    doc.text(footer, margin, pageH - 28, { width: pageW - margin * 2, align: 'center', lineBreak: false })
  }

  doc.end()
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  await new Promise<void>((resolve) => doc.on('end', () => resolve()))
  return Buffer.concat(chunks)
}
