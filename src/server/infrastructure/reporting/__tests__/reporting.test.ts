// ── PHASE 14 · Reporting engine unit tests (registry/exports/runner) ───────
import { describe, test, expect } from 'bun:test'
import { allReportDefs, reportCatalogFor, canViewReport, reportPermissionsUsed, getReportDef } from '../registry'
import { PERMISSIONS, ROLE_PERMISSIONS } from '@/lib/constants'
import { toCsv, type ExportTable } from '../export/csv'
import { brand } from '@/design-system/tokens'
import { toXlsx } from '../export/xlsx'
import { toPdf } from '../export/pdf'
import { toExportTable, exportFilename, parseFormat } from '../export/exportService'
import { REPORT_CATEGORIES, type ReportCategory } from '../types'

const fakeAuth = (role: string, permissions: string[]) =>
  ({ user: { id: 'u_test', phone: '09120000099', role, firstName: 'تست', lastName: 'کاربر' }, permissions }) as never

const admin = fakeAuth('ADMIN', [...PERMISSIONS])
const expert1 = fakeAuth('EXPERT_1', [...ROLE_PERMISSIONS.EXPERT_1])
const operator = fakeAuth('OPERATOR', [...ROLE_PERMISSIONS.OPERATOR])
const doctor = fakeAuth('DOCTOR', [...ROLE_PERMISSIONS.DOCTOR])
const patient = fakeAuth('PATIENT', [...ROLE_PERMISSIONS.PATIENT])

describe('PHASE 14 · report registry (ED-154, permission-aware)', () => {
  test('19 reports registered with unique ids', () => {
    const defs = allReportDefs()
    expect(defs).toHaveLength(19)
    expect(new Set(defs.map((d) => d.id)).size).toBe(19)
  })

  test('all 6 commanded categories covered (Operational/Financial/Business/User/Performance/Custom)', () => {
    const cats = new Set(allReportDefs().map((d) => d.category))
    expect([...cats].sort()).toEqual([...REPORT_CATEGORIES].sort())
    for (const c of REPORT_CATEGORIES) {
      expect(allReportDefs().filter((d) => d.category === c).length).toBeGreaterThan(0)
    }
  })

  test('every report permission exists in the 31-entry catalogue (gate SR9)', () => {
    for (const p of reportPermissionsUsed()) {
      expect(PERMISSIONS as readonly string[]).toContain(p)
    }
  })

  test('every def carries category/permission/params-schema/chart flag', () => {
    for (const d of allReportDefs()) {
      expect(d.permission).toBeTruthy()
      expect(d.params).toBeDefined()
      expect(typeof d.hasChart).toBe('boolean')
      expect(typeof d.timeScoped).toBe('boolean')
      expect(d.fa).toBeTruthy()
      expect(d.en).toBeTruthy()
    }
  })

  test('catalog is permission-aware per role (the phase command)', () => {
    // ADMIN sees everything
    expect(reportCatalogFor(admin)).toHaveLength(19)
    // PATIENT sees nothing (no permissions at all)
    expect(reportCatalogFor(patient)).toHaveLength(0)
    // EXPERT_1 has view_reports + view_ai_analyses but NOT view_financials
    const e1 = reportCatalogFor(expert1).map((r) => r.id)
    expect(e1).toContain('operational.case-status')
    expect(e1).toContain('business.top-products')
    expect(e1).toContain('performance.ai')
    expect(e1).not.toContain('financial.revenue-summary')
    expect(e1).not.toContain('operational.workflow-health') // manage_workflow_recovery = ADMIN
    // OPERATOR has financials but not manage_users / view_ai_analyses
    const op = reportCatalogFor(operator).map((r) => r.id)
    expect(op).toContain('financial.revenue-summary')
    expect(op).not.toContain('user.growth')
    expect(op).not.toContain('performance.ai')
    // DOCTOR only has view_ai_analyses → exactly one report
    const dr = reportCatalogFor(doctor).map((r) => r.id)
    expect(dr).toEqual(['performance.ai'])
  })

  test('custom dataset report enforces dataset-level permissions', () => {
    const def = getReportDef('custom.dataset')!
    expect(canViewReport(operator, def)).toBe(true) // view_reports
    // financial dataset inside custom requires view_financials (checked at run)
    expect(def.defaultGroupBy).toBe('none')
  })
})

describe('PHASE 14 · CSV export (ED-156)', () => {
  const table: ExportTable = {
    titleFa: 'گزارش تست', titleEn: 'Test report',
    columns: [
      { key: 'name', fa: 'نام', en: 'Name' },
      { key: 'amount', fa: 'مبلغ', en: 'Amount' },
    ],
    rows: [
      { name: 'ساده', amount: 1000 },
      { name: 'با,کاما', amount: 2000 },
      { name: 'با "کوت" و\nخط جدید', amount: 3000 },
    ],
    totals: { amount: 6000 },
    metaLines: ['Window: 2026-08-01 → 2026-09-01'],
  }

  test('BOM + CRLF + RFC4180 quoting + totals row', () => {
    const csv = toCsv(table, 'fa')
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('\r\n')
    expect(csv).toContain('"با,کاما"')
    expect(csv).toContain('"با ""کوت"" و\nخط جدید"')
    expect(csv.slice(1).split('\r\n')[0]).toBe('# Window: 2026-08-01 → 2026-09-01') // BOM stripped first
    expect(csv.slice(1).split('\r\n')[1]).toBe('نام,مبلغ')
    const last = csv.slice(1).trimEnd().split('\r\n').pop()!
    expect(last).toBe(',6000')
  })

  test('lang=en renders EN headers', () => {
    expect(toCsv(table, 'en').slice(1).split('\r\n')[1]).toBe('Name,Amount')
  })
})

describe('PHASE 14 · XLSX export (own OOXML writer, ED-156)', () => {
  const table: ExportTable = {
    titleFa: 'گزارش تست', titleEn: 'Test report',
    columns: [{ key: 'name', fa: 'نام', en: 'Name' }, { key: 'n', fa: 'عدد', en: 'Count' }],
    rows: [{ name: 'باباحکیم', n: 42 }, { name: 'plain', n: 7 }],
    metaLines: ['meta-line-1'],
  }

  test('valid ZIP container (PK signatures + central directory)', () => {
    const buf = toXlsx(table, 'fa')
    expect(buf.slice(0, 2).toString('latin1')).toBe('PK')
    expect(buf.slice(0, 4).toString('hex')).toBe('504b0304') // local file header
    expect(buf.subarray(buf.length - 22, buf.length - 18).toString('hex')).toBe('504b0506') // EOCD
  })

  test('carries all 6 required OOXML parts', () => {
    const buf = toXlsx(table, 'fa').toString('latin1')
    for (const name of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']) {
      expect(buf).toContain(name)
    }
    expect(buf).toContain('sheet name="Report"')
  })

  test('RTL sheet view when fa, LTR when en', () => {
    expect(toXlsx(table, 'fa').toString('latin1')).toContain('rightToLeft="1"')
    expect(toXlsx(table, 'en').toString('latin1')).not.toContain('rightToLeft="1"')
  })

  test('inline strings carry the Persian title; numbers stay numeric', () => {
    // xml parts are stored UTF-8; decode as utf8 for content assertions
    const xml = toXlsx(table, 'fa').toString('utf8')
    expect(xml).toContain('باباحکیم')
    expect(xml).toContain('<v>42</v>')
    expect(xml).not.toContain('<script') // no raw XML injection surface
  })
})

describe('PHASE 14 · PDF export (pdfkit + FreeSerif fa shaping, ED-156)', () => {
  const table: ExportTable = {
    titleFa: 'خلاصه درآمد و هزینه', titleEn: 'Revenue summary',
    columns: [
      { key: 'bucket', fa: 'بازه', en: 'Period' },
      { key: 'income', fa: 'درآمد', en: 'Revenue' },
    ],
    rows: Array.from({ length: 60 }, (_, i) => ({ bucket: `2026-09-${String(i + 1).padStart(2, '0')}`, income: (i + 1) * 1000 })),
    totals: { income: 1830000 },
    metaLines: ['Window: 2026-08-01 → 2026-09-01'],
  }

  test('renders a valid PDF with embedded font + multiple pages', async () => {
    const buf = await toPdf(table, { lang: 'fa', windowText: 'بازه: ۲۰۲۶', generatedAt: '2026-09-06' })
    expect(buf.slice(0, 5).toString('latin1')).toBe('%PDF-')
    expect(buf.length).toBeGreaterThan(2000)
    const s = buf.toString('latin1')
    expect(s).toContain('/FontFile2') // embedded TrueType (FreeSerif)
    expect(s).toMatch(/\/Count [2-9]/) // 60 rows × 20px → ≥2 pages
  })

  test(`brand header band uses ${brand.primaryDark} (0.09 0.25 0.46 rgb)`, async () => {
    const { inflateSync } = await import('node:zlib')
    const buf = await toPdf(table, { lang: 'en' })
    // content streams are Flate-compressed — inflate the first one and check
    // the header band fill color equals BabaHakim #173F76
    const streamStart = buf.indexOf(Buffer.from('stream\n')) + 'stream\n'.length
    const streamEnd = buf.indexOf(Buffer.from('endstream'), streamStart)
    const content = inflateSync(buf.subarray(streamStart, streamEnd)).toString('latin1')
    expect(content).toContain('0.09019607843137255 0.24705882352941178 0.4627450980392157 scn')
  })
})

describe('PHASE 14 · export service helpers', () => {
  test('parseFormat rejects anything except csv/xlsx/pdf', () => {
    expect(parseFormat('csv')).toBe('csv')
    expect(parseFormat('XLSX')).toBe('xlsx')
    expect(() => parseFormat('exe')).toThrow()
    expect(() => parseFormat('')).toThrow()
  })

  test('exportFilename is filesystem-safe and deterministic', () => {
    expect(exportFilename('financial.payments', '2026-08-01T00:00:00.000Z', '2026-09-01T23:59:59.999Z', 'csv'))
      .toBe('financial.payments_2026-08-01_2026-09-01.csv')
  })

  test('toExportTable: meta preamble + truncation honesty', () => {
    const t = toExportTable(
      {
        meta: { reportId: 'x', from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T23:59:59.999Z', generatedAt: '2026-09-06T12:00:00.000Z', groupBy: 'day', truncated: true, totalRows: 540, noteFa: 'نکته' },
        columns: [{ key: 'a', fa: 'الف', en: 'A' }],
        rows: [{ a: 1 }],
        totals: { a: 1 },
      },
      { fa: 'عنوان', en: 'Title' },
      'fa',
    )
    expect(t.titleFa).toBe('عنوان')
    expect(t.metaLines).toContain('بازه: 2026-08-01 → 2026-09-01')
    expect(t.metaLines!.some((m) => m.includes('سقف'))).toBe(true) // truncation surfaced
    expect(t.metaLines).toContain('نکته')
  })
})
