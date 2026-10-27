// Iranian national ID (کد ملی) — pure, client-safe format helpers.
// Shared by the server DTOs and the SPA form mirrors (no crypto, no db).

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹'
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩'

/** Persian/Arabic digits → ASCII, strip separators. */
export function normalizeNationalId(raw: string): string {
  return String(raw ?? '')
    .replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)))
    .replace(/[\s\-_.]/g, '')
}

/** Official checksum (mod 11) for the 10-digit Iranian national code. */
export function isValidIranianNationalId(raw: string): boolean {
  const id = normalizeNationalId(raw)
  if (!/^\d{10}$/.test(id)) return false
  if (/^(\d)\1{9}$/.test(id)) return false // 0000000000, 1111111111, … are invalid
  const digits = id.split('').map(Number)
  const check = digits[9]
  const sum = digits.slice(0, 9).reduce((s, d, i) => s + d * (10 - i), 0)
  const r = sum % 11
  return r < 2 ? check === r : check === 11 - r
}

/** Display mask for lists: ******1234 */
export function maskNationalId(id: string | null | undefined): string | null {
  if (!id) return null
  return '******' + id.slice(-4)
}

/** Whole years between a birth date and `at` (calendar-correct). */
export function ageFromBirthDate(birthDate: Date | string, at: Date = new Date()): number {
  const b = new Date(birthDate)
  let age = at.getFullYear() - b.getFullYear()
  const m = at.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && at.getDate() < b.getDate())) age--
  return age
}

/** Display age: from birth date when known, else the entered age. */
export function displayAge(u: { birthDate?: Date | string | null; ageYears?: number | null }): number | null {
  if (u.birthDate) return ageFromBirthDate(u.birthDate)
  return u.ageYears ?? null
}
