'use client'
// ── BabaHakim Client API Layer (PHASE 09, ED-108) ──────────────────────────
// Single typed HTTP client for the whole SPA:
//  - parses the ED-94 error envelope ({error, code, details?, requestId})
//    into a typed ApiError (no more generic Error with a lost code)
//  - attaches the double-submit CSRF header on mutations (PHASE 05)
//  - retries ONCE through /auth/refresh on 401 (token rotation family)
//  - logout lives here too — no duplicated fetch/CSRF logic (F08)
import { ApiError } from './api-error'

export { ApiError }

export function csrfToken(): string {
  try {
    const m = document.cookie.match(/(?:^|;\s*)ta_csrf=([^;]+)/)
    return m ? m[1] : ''
  } catch {
    return ''
  }
}

type ApiInit = RequestInit & { json?: unknown }

async function parseEnvelope(res: Response): Promise<{ ok: boolean; status: number; data: unknown; requestId?: string }> {
  const requestId = res.headers.get('X-Request-Id') || undefined
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data, requestId }
}

function toApiError(status: number, data: unknown, requestId?: string): ApiError {
  const body = (data || {}) as {
    error?: string; code?: string; details?: { issues?: { path: string; message: string }[] }
  }
  // zod 422 → field errors for form display
  const fields: Record<string, string> = {}
  const issues = body.details?.issues
  if (Array.isArray(issues)) {
    for (const i of issues) if (i?.path) fields[i.path] = i.message
  }
  return new ApiError(body.error || `HTTP ${status}`, { status, code: body.code, requestId, fields })
}

/**
 * Fetch a BabaHakim API path (relative paths only — gateway constraint).
 * Throws ApiError on non-2xx. Retries once via /auth/refresh on 401.
 */
export async function apiFetch<T = unknown>(path: string, init?: ApiInit): Promise<T> {
  const doFetch = () =>
    fetch(path, {
      ...init,
      headers: {
        ...(init?.json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        // PHASE 05: double-submit CSRF (middleware enforces equality with cookie)
        ...((init?.method || 'GET').toUpperCase() !== 'GET' ? { 'x-csrf-token': csrfToken() } : {}),
        ...(init?.headers || {}),
      },
      body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
      credentials: 'same-origin',
    })

  let res = await doFetch()
  // 401 → one refresh attempt (rotating refresh family, PHASE 05)
  if (res.status === 401 && path !== '/api/v1/auth/me' && path !== '/api/v1/auth/refresh') {
    const refreshed = await fetch('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'x-csrf-token': csrfToken() },
    })
    if (refreshed.ok) res = await doFetch()
  }

  const { ok, status, data, requestId } = await parseEnvelope(res)
  if (!ok) throw toApiError(status, data, requestId)
  return data as T
}

/** Session logout via the API client (F08 — was a duplicated fetch). */
export async function apiLogout(): Promise<void> {
  await fetch('/api/v1/auth/logout', {
    method: 'POST',
    headers: { 'x-csrf-token': csrfToken() },
  }).catch(() => {})
}

/**
 * PHASE 14 (ED-156): binary file download through the same session pipeline.
 * Handles the ED-94 error envelope (binary endpoints still error in JSON)
 * and retries once via /auth/refresh on 401. Returns a Blob for
 * URL.createObjectURL — callers trigger the save themselves.
 */
export async function apiDownload(path: string): Promise<{ blob: Blob; filename: string }> {
  const doFetch = () => fetch(path, { credentials: 'same-origin' })
  let res = await doFetch()
  if (res.status === 401) {
    const refreshed = await fetch('/api/v1/auth/refresh', { method: 'POST', headers: { 'x-csrf-token': csrfToken() } })
    if (refreshed.ok) res = await doFetch()
  }
  if (!res.ok) {
    let data: Record<string, unknown> = {}
    try { data = await res.json() } catch { /* binary error */ }
    throw new ApiError(String(data.error || `HTTP ${res.status}`), { status: res.status, code: data.code as string | undefined, requestId: data.requestId as string | undefined })
  }
  const cd = res.headers.get('content-disposition') || ''
  const m = cd.match(/filename\*=UTF-8''([^;]+)/) || cd.match(/filename="([^"]+)"/)
  return { blob: await res.blob(), filename: m ? decodeURIComponent(m[1]) : 'export' }
}
