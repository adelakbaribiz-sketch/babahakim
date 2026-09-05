// ── PHASE 14 · Search engine unit tests (pure, no server deps) ─────────────
import { describe, test, expect } from 'bun:test'
import {
  searchKey, searchKeySpaced, searchKeyPersianDigits, tokenize, buildNeedles, matchesNeedles,
} from '../normalize'
import { applyQ, applyFilters, resolveSort } from '../query-build'
import { clampWindow, assertOffsetBounded, withReportTimeout, SEARCH_BOUNDS, REPORT_BOUNDS } from '../bounds'

describe('PHASE 14 · normalization (Master Prompt §25)', () => {
  test('folds Arabic letters to Persian (ي ى ئ → ی, ك → ک, ة → ه, أ إ ٱ → ا, ؤ → و)', () => {
    expect(searchKey('شيرازي')).toBe(searchKey('شیرازی'))
    expect(searchKey('كپسول')).toBe(searchKey('کپسول'))
    expect(searchKey('حبة')).toBe(searchKey('حبه'))
    expect(searchKey('أ إ ٱ')).toBe(searchKey('ا ا ا'))
    expect(searchKey('ؤ')).toBe(searchKey('و'))
  })

  test('ZWNJ removed in canonical key, kept as space in spaced key', () => {
    expect(searchKey('می‌خوام')).toBe('میخوام')
    expect(searchKeySpaced('می‌خوام')).toBe('می خوام')
    expect(searchKey('نیم‌فاصله')).toBe(searchKey('نیمفاصله'))
  })

  test('Persian + Arabic digits fold to Latin', () => {
    expect(searchKey('۰۹۱۲')).toBe('0912')
    expect(searchKey('٠٩١٢')).toBe('0912')
    expect(searchKeyPersianDigits('0912')).toBe('۰۹۱۲')
  })

  test('strips diacritics, tatweel and bidi marks', () => {
    expect(searchKey('بَابَا‌حکــیم')).toBe(searchKey('باباحکیم'))
    expect(searchKey('سلام\u200F')).toBe('سلام')
  })

  test('tokenizes on non-alphanumerics, Persian letters are word chars', () => {
    expect(tokenize('روغن ۲۰ - میلی!')).toEqual(['روغن', '20', 'میلی'])
    expect(tokenize('می‌خوام')).toEqual(['میخوام']) // ZWNJ is a word joiner
    expect(tokenize('ORD-123')).toEqual(['ord', '123'])
  })

  test('needle variants: typed + canonical + spaced + persian-digit', () => {
    const n = buildNeedles('می‌خوام')
    expect(n).toHaveLength(1)
    expect(n[0].variants).toContain('می‌خوام')
    expect(n[0].variants).toContain('میخوام')
    expect(n[0].variants).toContain('می خوام')
    expect(buildNeedles('0912')[0].variants).toContain('۰۹۱۲')
  })

  test('caps tokens at 5 (bounded queries)', () => {
    expect(buildNeedles('a b c d e f g h')).toHaveLength(5)
  })

  test('matchesNeedles: cross-script and cross-half-space recall', () => {
    expect(matchesNeedles('می‌خوام', buildNeedles('میخوام'))).toBe(true)
    expect(matchesNeedles('کپسول ۲۰ عدد', buildNeedles('کپسول 20'))).toBe(true)
    expect(matchesNeedles('کپسول', buildNeedles('قرص'))).toBe(false)
  })
})

describe('PHASE 14 · SQL-side q builder (ED-151, fixes S-1)', () => {
  test('empty q → no where', () => {
    expect(applyQ('', ['nameFa']).where).toBeUndefined()
    expect(applyQ('   ', ['nameFa']).where).toBeUndefined()
  })

  test('single token → AND[ OR[ contains × fields × variants ] ]', () => {
    const { where } = applyQ('شربت', ['nameFa', 'brand'])
    const and = (where as { AND: unknown[] }).AND
    expect(and).toHaveLength(1)
    const or = (and[0] as { OR: unknown[] }).OR
    expect(or.length).toBeGreaterThanOrEqual(2)
  })

  test('two tokens → AND of two OR groups', () => {
    const { where } = applyQ('شربت گلاب', ['nameFa'])
    expect((where as { AND: unknown[] }).AND).toHaveLength(2)
  })

  test('relation hop renders { patient: { is: { field } } }', () => {
    const { where } = applyQ('سارا', ['patient.firstName'])
    const or = ((where as { AND: unknown[] }).AND[0] as { OR: Record<string, unknown>[] }).OR
    expect(or[0]).toEqual({ patient: { is: { firstName: { contains: 'سارا' } } } })
  })

  test('token count overflow reported honestly', () => {
    const { tokensDropped } = applyQ('a b c d e f g', ['x'])
    expect(tokensDropped).toBe(2)
  })
})

describe('PHASE 14 · whitelisted filter DSL (ED-152)', () => {
  const params = (s: string) => new URLSearchParams(s)

  test('enum filter applied; unknown value rejected', () => {
    const ok = applyFilters(params('f_status=PAID'), [{ field: 'status', enum: ['PAID', 'FAILED'] }])
    expect(ok.where).toEqual({ status: 'PAID' })
    expect(ok.applied).toEqual(['f_status'])
    const bad = applyFilters(params('f_status=DROP TABLE'), [{ field: 'status', enum: ['PAID', 'FAILED'] }])
    expect(bad.where).toEqual({})
    expect(bad.rejected).toHaveLength(1)
  })

  test('unknown FIELD never reaches the where (injection-safe)', () => {
    const r = applyFilters(params('f_role=ADMIN&f_phone=0912'), [{ field: 'role', enum: ['ADMIN', 'PATIENT'] }])
    expect(r.where).toEqual({ role: 'ADMIN' })
    expect(Object.keys(r.where)).not.toContain('phone')
  })

  test('in-operator with enum + cardinality cap', () => {
    const r = applyFilters(params('f_status_in=PAID,FAILED'), [{ field: 'status', ops: ['eq', 'in'], enum: ['PAID', 'FAILED'], maxIn: 2 }])
    expect(r.where).toEqual({ status: { in: ['PAID', 'FAILED'] } })
    const tooMany = applyFilters(params('f_status_in=PAID,FAILED,PENDING,OTHER'), [{ field: 'status', ops: ['in'], enum: ['PAID', 'FAILED', 'PENDING', 'OTHER'], maxIn: 3 }])
    expect(tooMany.where).toEqual({})
  })

  test('numeric range clamps', () => {
    const ok = applyFilters(params('f_amount_gte=1000&f_amount_lte=5000'), [{ field: 'amount', ops: ['gte', 'lte'], intMin: 0, intMax: 100000 }])
    expect(ok.where).toEqual({ amount: { gte: 1000, lte: 5000 } })
    const bad = applyFilters(params('f_amount_gte=999999999'), [{ field: 'amount', ops: ['gte'], intMin: 0, intMax: 100000 }])
    expect(bad.where).toEqual({})
    const nan = applyFilters(params('f_amount_gte=abc'), [{ field: 'amount', ops: ['gte'], intMin: 0, intMax: 100000 }])
    expect(nan.where).toEqual({})
  })

  test('resolveSort whitelists and falls back', () => {
    expect(resolveSort('nameFa', ['createdAt', 'nameFa'], 'createdAt')).toEqual({ field: 'nameFa', ok: true })
    expect(resolveSort('password', ['createdAt'], 'createdAt')).toEqual({ field: 'createdAt', ok: false })
    expect(resolveSort(null, ['createdAt'], 'createdAt')).toEqual({ field: 'createdAt', ok: true })
  })
})

describe('PHASE 14 · unbounded-query guards (ED-153/160)', () => {
  test('clampWindow: defaults to last 30 days', () => {
    const w = clampWindow(null, null, { now: new Date('2026-09-06T12:00:00Z') })
    expect(w.defaulted).toBe(true)
    expect(w.from.toISOString().slice(0, 10)).toBe('2026-08-08')
    expect(w.to.toISOString().slice(0, 10)).toBe('2026-09-06')
  })

  test('clampWindow: open "from" end defaults to now', () => {
    const w = clampWindow('2026-09-01', null, { now: new Date('2026-09-06T12:00:00Z') })
    expect(w.to.toISOString().slice(0, 10)).toBe('2026-09-06')
    expect(w.from.toISOString().slice(0, 10)).toBe('2026-09-01')
  })

  test('clampWindow: rejects > 400 days (WINDOW_TOO_WIDE)', () => {
    expect(() => clampWindow('2024-01-01', '2026-09-06')).toThrow()
  })

  test('clampWindow: rejects future windows', () => {
    expect(() => clampWindow('2026-09-01', '2027-01-01', { now: new Date('2026-09-06T00:00:00Z') })).toThrow()
  })

  test('clampWindow: rejects from ≥ to', () => {
    expect(() => clampWindow('2026-09-06', '2026-08-01')).toThrow()
  })

  test('assertOffsetBounded: 422 beyond 10k rows', () => {
    expect(() => assertOffsetBounded(10_001, 20)).toThrow()
    expect(() => assertOffsetBounded(9_000, 100)).not.toThrow()
  })

  test('withReportTimeout: rejects slow loaders (REPORT_TIMEOUT)', async () => {
    const slow = new Promise((r) => setTimeout(r, 300))
    await expect(withReportTimeout(slow, 20)).rejects.toThrow('گزارش')
    await expect(withReportTimeout(Promise.resolve(42), 100)).resolves.toBe(42)
  })

  test('bounds constants are sane (single source)', () => {
    expect(SEARCH_BOUNDS.maxLimit).toBe(100)
    expect(SEARCH_BOUNDS.maxOffset).toBe(10_000)
    expect(REPORT_BOUNDS.maxViewRows).toBe(200)
    expect(REPORT_BOUNDS.maxWindowDays).toBe(400)
    expect(REPORT_BOUNDS.syncExportRows()).toBe(2_000)
    expect(REPORT_BOUNDS.asyncExportRows).toBe(20_000)
  })
})
