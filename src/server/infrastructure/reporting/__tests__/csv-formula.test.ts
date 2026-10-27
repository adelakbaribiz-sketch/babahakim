// CSV export: spreadsheet formula-injection guard (2026-10 overhaul, spec §52).
import { describe, test, expect } from 'bun:test'
import { neutralizeFormula, toCsv } from '../export/csv'

describe('CSV formula injection', () => {
  test('formula-leading text is neutralized', () => {
    for (const bad of ['=HYPERLINK("http://x")', '+cmd|calc', '-2+3', '@SUM(A1)', '\t=1']) {
      expect(neutralizeFormula(bad).startsWith("'")).toBe(true)
    }
  })
  test('plain text and signed numbers are untouched', () => {
    expect(neutralizeFormula('سارا مریدی')).toBe('سارا مریدی')
    expect(neutralizeFormula('-250')).toBe('-250')
    expect(neutralizeFormula('+98')).toBe('+98')
  })
  test('toCsv applies the guard to user strings but not to numbers', () => {
    const csv = toCsv({ titleFa: 't', titleEn: 't', columns: [{ key: 'n', fa: 'n', en: 'n' }, { key: 'v', fa: 'v', en: 'v' }], rows: [{ n: '=1+1', v: -5 }] })
    expect(csv).toContain("'=1+1,-5")
  })
})
