'use client'
// ── BabaHakim client data layer (PHASE 09, ED-109) ─────────────────────────
// useApiQuery: the ONE standard for view data (SP-1..SP-7):
//   loading → error (actionable retry) → empty (view decides) → content
//  - errors are NEVER swallowed (fixes F04 — no .catch(() => {}))
//  - one in-flight request per key; late responses from a previous key are
//    dropped (fixes F09 out-of-order races)
//  - `manual: true` skips the initial fetch (actions trigger refetch)
import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '@/contexts/app'
import { ApiError } from '@/lib/api-error'

export interface ApiQueryState<T> {
  data: T | null
  error: ApiError | null
  loading: boolean
  refetch: () => void
}

export function useApiQuery<T>(path: string | null, opts?: { manual?: boolean }): ApiQueryState<T> {
  const { api } = useApp()
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState<boolean>(path != null && !opts?.manual)
  const [tick, setTick] = useState(0)
  const runId = useRef(0)

  // React-sanctioned "adjust state during render" when the key changes
  // (NOT setState-in-effect): flips back to skeleton for the new key.
  // In-flight responses from the PREVIOUS key are dropped by the runId
  // check in the fetch effect below.
  const [prevPath, setPrevPath] = useState(path)
  if (path !== prevPath) {
    setPrevPath(path)
    setLoading(path != null)
  }

  useEffect(() => {
    if (path == null) return
    if (opts?.manual && tick === 0) return
    const id = ++runId.current
    api<T>(path)
      .then((d) => { if (id === runId.current) { setData(d); setError(null) } })
      .catch((e) => { if (id === runId.current) setError(e instanceof ApiError ? e : new ApiError(String(e?.message || e), { status: 0 })) })
      .finally(() => { if (id === runId.current) setLoading(false) })
  }, [api, path, tick, opts?.manual])

  const refetch = useCallback(() => setTick((x) => x + 1), [])
  return { data, error, loading, refetch }
}

/** Debounce fast-changing values (search boxes) — fixes request storms (F09). */
export function useDebounced<T>(value: T, delayMs = 350): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(t)
  }, [value, delayMs])
  return debounced
}

/** True when the live value differs from the saved baseline (SP-5 dirty-guard). */
export function useDirty<T>(baseline: T, live: T): boolean {
  return JSON.stringify(baseline) !== JSON.stringify(live)
}
