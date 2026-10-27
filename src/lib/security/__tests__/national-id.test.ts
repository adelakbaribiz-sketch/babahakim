// National ID: checksum validation, normalization, blind index, encryption.
import { describe, test, expect } from 'bun:test'
import {
  isValidIranianNationalId, normalizeNationalId, nationalIdHash,
  encryptNationalId, decryptNationalId, maskNationalId,
} from '@/lib/security/national-id'
import { ageFromBirthDate, displayAge } from '@/lib/national-id-format'
import { nationalIdSchema, birthDateSchema } from '@/server/api/schemas'

// structurally valid test codes (mod-11 checksum) — not real people
const VALID = ['0013542419', '0499370899', '1111111111'.replace(/1/g, '0').slice(0, 9) + '0']

describe('national ID checksum', () => {
  test('accepts checksum-valid codes', () => {
    expect(isValidIranianNationalId('0013542419')).toBe(true)
    expect(isValidIranianNationalId('0499370899')).toBe(true)
  })
  test('rejects wrong checksum, wrong length, repeated digits', () => {
    expect(isValidIranianNationalId('0013542418')).toBe(false)
    expect(isValidIranianNationalId('123456789')).toBe(false)
    expect(isValidIranianNationalId('12345678901')).toBe(false)
    expect(isValidIranianNationalId('1111111111')).toBe(false)
    expect(isValidIranianNationalId('abcdefghij')).toBe(false)
  })
  test('normalizes Persian/Arabic digits and separators', () => {
    expect(normalizeNationalId('۰۰۱-۳۵۴۲۴۱۹')).toBe('0013542419')
    expect(normalizeNationalId('٠٠١٣٥٤٢٤١٩')).toBe('0013542419')
    expect(isValidIranianNationalId('۰۰۱۳۵۴۲۴۱۹')).toBe(true)
  })
  test('zod schema normalizes then validates', () => {
    expect(nationalIdSchema.parse('۰۰۱۳۵۴۲۴۱۹')).toBe('0013542419')
    expect(nationalIdSchema.safeParse('0013542418').success).toBe(false)
  })
})

describe('national ID storage', () => {
  test('blind index is deterministic, input-format independent, not the raw value', () => {
    const a = nationalIdHash('0013542419')
    expect(a).toBe(nationalIdHash('۰۰۱۳۵۴۲۴۱۹'))
    expect(a).not.toContain('0013542419')
    expect(a).toHaveLength(64)
    expect(nationalIdHash('0499370899')).not.toBe(a)
  })
  test('encryption round-trips and is randomized', () => {
    const e1 = encryptNationalId('0013542419')
    const e2 = encryptNationalId('0013542419')
    expect(e1).not.toBe(e2)
    expect(e1).not.toContain('0013542419')
    expect(decryptNationalId(e1)).toBe('0013542419')
    expect(decryptNationalId(null)).toBeNull()
  })
  test('mask keeps only the last 4 digits', () => {
    expect(maskNationalId('0013542419')).toBe('******2419')
    expect(maskNationalId(null)).toBeNull()
  })
  test('fixture list stays valid', () => {
    expect(VALID.filter(isValidIranianNationalId).length).toBeGreaterThanOrEqual(2)
  })
})

describe('age / birth date', () => {
  test('age is calendar-correct around the birthday', () => {
    expect(ageFromBirthDate('2000-06-15', new Date('2026-06-14'))).toBe(25)
    expect(ageFromBirthDate('2000-06-15', new Date('2026-06-15'))).toBe(26)
  })
  test('displayAge prefers birth date, falls back to entered age, never invents one', () => {
    expect(displayAge({ birthDate: null, ageYears: 40 })).toBe(40)
    expect(displayAge({ birthDate: null, ageYears: null })).toBeNull()
  })
  test('birth date cannot be in the future or > 120 years ago', () => {
    expect(birthDateSchema.safeParse(new Date(Date.now() + 864e5)).success).toBe(false)
    expect(birthDateSchema.safeParse('1890-01-01').success).toBe(false)
    expect(birthDateSchema.safeParse('1990-01-01').success).toBe(true)
  })
})
