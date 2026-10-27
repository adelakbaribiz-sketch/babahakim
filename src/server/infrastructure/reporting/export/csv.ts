// ── Report Export · CSV (PHASE 14, ED-156) ─────────────────────────────────
// RFC 4180 with UTF-8 BOM (Excel opens Persian correctly) + CRLF.
// Pure functions, no deps, fully unit-testable.

export interface ExportTable {
  titleFa: string
  titleEn: string
  columns: { key: string; fa: string; en: string }[]
  rows: Record<string, unknown>[]
  totals?: Record<string, number>
  metaLines?: string[] // extra header comment lines (window, generatedAt…)
}

/** Spreadsheet formula-injection guard (CSV/XLSX): user-controlled text that
 *  starts with = + - @ TAB or CR is executed by Excel/LibreOffice as a
 *  formula. Such strings get a leading apostrophe; real numbers are untouched. */
export function neutralizeFormula(s: string): string {
  return /^[=+\-@\t\r]/.test(s) && !/^[+-]?\d+(\.\d+)?$/.test(s) ? `'${s}` : s
}

function escapeCsv(v: unknown): string {
  if (v === null || v === undefined) return ''
  let s: string
  if (v instanceof Date) s = v.toISOString()
  else if (typeof v === 'boolean') s = v ? 'TRUE' : 'FALSE'
  else if (typeof v === 'number') s = String(v)
  else s = neutralizeFormula(String(v))
  // Persian digits stay as typed (faithful data); escaping only structural chars
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"'
  return s
}

/**
 * Build a CSV document from an ExportTable. `lang` picks the header row.
 * Trailing empty line per RFC; BOM first — Excel detects UTF-8 via BOM.
 */
export function toCsv(table: ExportTable, lang: 'fa' | 'en' = 'fa'): string {
  const cols = table.columns.map((c) => (lang === 'fa' ? c.fa : c.en))
  const lines: string[] = []
  for (const m of table.metaLines ?? []) lines.push(`# ${m}`)
  lines.push(cols.map(escapeCsv).join(','))
  for (const row of table.rows) {
    lines.push(table.columns.map((c) => escapeCsv(row[c.key])).join(','))
  }
  const totals = table.totals
  if (totals && Object.keys(totals).length > 0) {
    lines.push(table.columns.map((c) => (c.key in totals ? escapeCsv(totals[c.key]) : '')).join(','))
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n'
}
