// ── BabaHakim Search Engine · Text Normalization (PHASE 14, ED-151) ────────
// Pure, dependency-free (client-safe superset of the legacy normalizeFa in
// lib/api.ts — which is server-bound and only used the in-memory matcher).
// Persian search must behave correctly (Master Prompt §25):
//   ی/ي/ى · ک/ك · اعداد فارسی/عربی/لاتین · نیم‌فاصله · توکن‌سازی
//   diacritics/tatweel/presentation-forms must never break a match.
// The SAME module is used by the SQL-side needle builder AND the JS fallback
// matcher so both sides agree on one canonical form (single source).
//
// i18n (§69): every helper is script-aware, not language-aware — a Persian
// query matches English rows where digits/codes overlap and vice-versa.

// ── character classes ──────────────────────────────────────────────────────

const ARABIC_YE_RE = /[\u064A\u0649\u0626]/g // ي ى ئ → ی
const ARABIC_KAF_RE = /\u0643/g // ك → ک
const ALEF_VARIANTS_RE = /[\u0623\u0625\u0671]/g // أ إ ٱ → ا
const HEH_TA_MARBUTA_RE = /\u0629/g // ة → ه (Arabic tā marbūṭa)
const WAW_HAMZA_RE = /\u0624/g // ؤ → و
const TATWEEL_RE = /\u0640/g // ـ (kashida/tatweel) → removed
const DIACRITICS_RE = /[\u064B-\u065F\u0670\u06D6-\u06ED]/g // fatha/damma/…/superscripts
const PRESENTATION_FORMS_RE = /[\uFB50-\uFDFF\uFE70-\uFEFF]/g // Arabic presentation forms
const ZWNJ_RE = /\u200C/g // نیم‌فاصله
const ZWJ_RE = /\u200D/g
const BIDI_MARKS_RE = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g
const PERSIAN_DIGITS_RE = /[\u06F0-\u06F9]/g
const ARABIC_DIGITS_RE = /[\u0660-\u0669]/g
const CONTROL_RE = /[\u0000-\u0008\u000B-\u001F\u007F]/g

/** Presentation-form → base letter (subset that appears in real data). */
const PRESENTATION_MAP: Record<string, string> = {
  '\uFB8E': '\u06A9', '\uFB92': '\u06AF', '\uFBFC': '\u06CC', '\uFBFD': '\u06CC',
  '\uFB8A': '\u06CC', '\uFB8B': '\u06CC',
  '\uFEF5': '\u0627', '\uFEF6': '\u0627', '\uFEF7': '\u0623', '\uFEF8': '\u0623',
  '\uFEF9': '\u0649', '\uFEFA': '\u0649', '\uFEFB': '\u0627', '\uFEFC': '\u0627',
}

function digitsToLatin(s: string): string {
  return s
    .replace(PERSIAN_DIGITS_RE, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(ARABIC_DIGITS_RE, (d) => String(d.charCodeAt(0) - 0x0660))
}

function digitsToPersian(s: string): string {
  return s.replace(/[0-9]/g, (d) => String.fromCharCode(0x06f0 + Number(d)))
}

/** Base normalization shared by every variant: fold letters, strip marks. */
function foldBase(s: string): string {
  // NOTE: ZWNJ is intentionally preserved here — each key variant decides:
  // compact keys remove it ("می‌خوام" ≡ "میخوام"), spaced keys turn it into a
  // real space ("می‌خوام" ≡ "می خوام"). Stripping it here would collapse both.
  return s
    .replace(CONTROL_RE, '')
    .replace(PRESENTATION_FORMS_RE, (ch) => PRESENTATION_MAP[ch] ?? '')
    .replace(ARABIC_YE_RE, 'ی')
    .replace(ARABIC_KAF_RE, 'ک')
    .replace(ALEF_VARIANTS_RE, 'ا')
    .replace(WAW_HAMZA_RE, 'و')
    .replace(HEH_TA_MARBUTA_RE, 'ه')
    .replace(TATWEEL_RE, '')
    .replace(DIACRITICS_RE, '')
    .replace(BIDI_MARKS_RE, '')
    .replace(ZWJ_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Canonical search key: letters folded, marks stripped, digits LATIN,
 * ZWNJ removed ("می‌خوام" ≡ "میخوام"), case-folded.
 */
export function searchKey(s: string): string {
  if (!s) return ''
  return digitsToLatin(foldBase(s)).replace(ZWNJ_RE, '').toLowerCase()
}

/**
 * Space-tolerant key: ZWNJ → real space ("می‌خوام" ≡ "می خوام").
 * Used to widen recall when the stored text kept half-spaces.
 */
export function searchKeySpaced(s: string): string {
  if (!s) return ''
  return digitsToLatin(foldBase(s)).replace(ZWNJ_RE, ' ').replace(/\s+/g, ' ').toLowerCase()
}

/**
 * Persian-digit key for matching rows whose text embeds ۰-۹.
 */
export function searchKeyPersianDigits(s: string): string {
  if (!s) return ''
  return digitsToPersian(foldBase(s))
}

/** Tokenize a canonical key: alphanumerics run (fa letters count as word chars). */
export function tokenize(s: string): string[] {
  return searchKey(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0)
}

export const SEARCH_LIMITS = {
  /** max characters of a raw query (matches ED-100 contract) */
  maxQ: 120,
  /** max tokens actually searched — extra tokens are dropped (bounded queries) */
  maxTokens: 5,
} as const

/**
 * Token × variant matrix for SQL LIKE needles (ED-151).
 * For every token we search up to 4 needle variants so stored text written
 * with a different digit script or half-space style still matches:
 *   v0 as-typed (raw)
 *   v1 latin-digit compact   (canonical)
 *   v2 latin-digit spaced    (ZWNJ-as-space)
 *   v3 persian-digit         (rows embedding ۰-۹)
 */
export interface SearchNeedle { token: string; variants: string[] }

export function buildNeedles(q: string): SearchNeedle[] {
  const raw = (q || '').trim().slice(0, SEARCH_LIMITS.maxQ)
  if (!raw) return []
  // tokens from BOTH the raw string and the folded key (keeps typed-form hits)
  // ZWNJ joins a word ("می‌خوام" is ONE token, not two) — it only splits
  // on real separators. The compact/spaced variants handle half-space recall.
  const rawTokens = raw
    .split(/[^\p{L}\p{N}\u200C]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t !== '\u200C')
  const keyTokens = tokenize(raw)
  const merged: string[] = []
  for (const t of rawTokens) {
    if (!merged.includes(t)) merged.push(t)
  }
  // key tokens are folded duplicates of raw tokens — add one only when its
  // compact form is NOT already covered ("می‌خوام" raw + "میخوام" key → one)
  for (const t of keyTokens) {
    if (merged.some((m) => searchKey(m) === t)) continue
    if (!merged.includes(t)) merged.push(t)
  }
  return merged.slice(0, SEARCH_LIMITS.maxTokens).map((token) => {
    const v: string[] = [token]
    const compact = searchKey(token)
    if (compact && !v.includes(compact)) v.push(compact)
    const spaced = searchKeySpaced(token)
    if (spaced && !v.includes(spaced)) v.push(spaced)
    const faDigits = searchKeyPersianDigits(token)
    if (faDigits && !v.includes(faDigits)) v.push(faDigits)
    return { token, variants: v }
  })
}

/**
 * In-memory matcher kept ONLY for tiny already-loaded lists (≤ a page) where
 * SQL filtering is not applicable. Never use it to post-filter a paginated
 * DB query — that is the S-1 anti-pattern this phase removes.
 */
export function matchesNeedles(haystack: string, needles: SearchNeedle[]): boolean {
  if (needles.length === 0) return true
  const keys = [searchKey(haystack), searchKeySpaced(haystack), searchKeyPersianDigits(haystack), haystack.toLowerCase()]
  return needles.every((n) =>
    n.variants.some((v) => keys.some((k) => k.includes(v.toLowerCase()))),
  )
}
