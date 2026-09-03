// API helpers: JSON responses, auth guard, audit logging, Persian normalization
import { NextRequest, NextResponse } from 'next/server'
import { getAuth, AuthContext } from '@/lib/auth'
import { db } from '@/lib/db'

export function ok(data: unknown = { ok: true }) {
  return NextResponse.json(data)
}

export function fail(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status })
}

export async function requireAuth(req?: NextRequest): Promise<AuthContext | null> {
  return getAuth()
}

export async function requirePermission(permission: string): Promise<{ auth: AuthContext } | { error: NextResponse }> {
  const auth = await getAuth()
  if (!auth) return { error: fail('احراز هویت لازم است | Authentication required', 401) }
  if (auth.user.role === 'ADMIN') return { auth }
  if (!auth.permissions.includes(permission)) {
    return { error: fail('دسترسی غیرمجاز | Permission denied: ' + permission, 403) }
  }
  return { auth }
}

export async function getIP(req: NextRequest): Promise<string> {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
}

export function getDevice(req: NextRequest): string {
  const ua = req.headers.get('user-agent') || ''
  if (/mobile/i.test(ua)) return 'Mobile'
  if (/tablet|ipad/i.test(ua)) return 'Tablet'
  return 'Desktop'
}

// ── Audit log (never store sensitive payloads in plain logs) ───────────
const SENSITIVE_ACTIONS = ['VIEW_MEDICAL_FILE', 'DOWNLOAD_IMAGE', 'VIEW_PATIENT_NATIONAL_ID', 'EDIT_PRESCRIPTION', 'APPROVE_PRESCRIPTION', 'VERIFY_PAYMENT', 'PRICE_CHANGE', 'LOGIN', 'LOGIN_FAILED']

export async function audit(
  req: NextRequest,
  userId: string | null,
  action: string,
  entity: string,
  entityId?: string,
  oldValues?: unknown,
  newValues?: unknown,
) {
  try {
    await db.auditLog.create({
      data: {
        userId, action, entity, entityId: entityId || null,
        oldValues: oldValues !== undefined ? JSON.stringify(oldValues) : null,
        newValues: newValues !== undefined ? JSON.stringify(newValues) : null,
        ip: await getIP(req), device: getDevice(req),
        sensitive: SENSITIVE_ACTIONS.includes(action),
      },
    })
  } catch (e) {
    console.error('audit failed', e)
  }
}

// ── Persian text normalization (search) ────────────────────────────────
export function normalizeFa(s: string): string {
  if (!s) return ''
  return s
    .replace(/[\u064A\u0649]/g, 'ی') // ي ی → ی
    .replace(/\u0643/g, 'ک') // ك → ک
    .replace(/[\u200c\u200f\u200e]/g, ' ') // نیم‌فاصله → فاصله
    .replace(/[\u0640]/g, '') // کشیده
    .replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) & 0xf)) // ارقام فارسی/عربی → لاتین
    .replace(/[إأآؤ]/g, (m) => ({ 'إ': 'ا', 'أ': 'ا', 'آ': 'ا', 'ؤ': 'و' } as Record<string, string>)[m] || m)
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim()
}

export function textMatches(query: string, ...fields: (string | null | undefined)[]): boolean {
  const q = normalizeFa(query)
  if (!q) return true
  const tokens = q.split(' ').filter(Boolean)
  const haystack = normalizeFa(fields.filter(Boolean).join(' '))
  return tokens.every((t) => haystack.includes(t))
}

// ── Misc ───────────────────────────────────────────────────────────────
export function genCode(prefix: string): string {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 900 + 100)}`
}

export function parseJSON<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}
