'use client'
// App context: auth + language + view navigation + API client (auto refresh on 401)
//
// PHASE 09 (ED-108): api() delegates to the typed api-client (ApiError with
// ED-94 envelope fields); sessions carry the server-issued permission set
// (login/register now return it — S1); logout goes through the same client.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { Lang, t as translate } from '@/lib/i18n'
import { apiFetch, apiLogout, ApiError } from '@/lib/api-client'

export interface SessionUser {
  id: string; phone: string; role: string; firstName: string; lastName: string
  referralCode?: string; profileComplete?: boolean
}

export interface View { page: string; params?: Record<string, string> }

interface AppState {
  lang: Lang
  setLang: (l: Lang) => void
  t: (k: string) => string
  dir: 'rtl' | 'ltr'
  user: SessionUser | null
  permissions: string[]
  /** Set the whole session at once (login/register/refresh paths). */
  setSession: (u: SessionUser | null, permissions?: string[]) => void
  /** Back-compat single-user setter (clears permissions when null). */
  setUser: (u: SessionUser | null) => void
  /** Permission check mirroring server semantics (ADMIN bypass, BR-RBAC-02). */
  can: (permission: string) => boolean
  view: View
  navigate: (page: string, params?: Record<string, string>) => void
  api: <T = unknown>(path: string, init?: RequestInit & { json?: unknown }) => Promise<T>
  refreshNotifCount: () => void
  notifCount: number
  /** session boot: done after the first /auth/me attempt (no flash of login) */
  booted: boolean
}

const Ctx = createContext<AppState | null>(null)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('fa')
  const [user, setUserState] = useState<SessionUser | null>(null)
  const [permissions, setPermissions] = useState<string[]>([])
  const [view, setView] = useState<View>({ page: 'landing' })
  const [notifCount, setNotifCount] = useState(0)
  const [booted, setBooted] = useState(false)

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? (localStorage.getItem('bh_lang') as Lang | null) : null
    if (saved === 'fa' || saved === 'en') queueMicrotask(() => setLangState(saved))
    apiFetch<{ user: SessionUser; permissions?: string[] }>('/api/v1/auth/me')
      .then((data) => {
        setUserState(data.user)
        setPermissions(data.permissions || [])
        setView({ page: 'dashboard' })
      })
      .catch(() => {})
      .finally(() => setBooted(true))
  }, [])

  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr'
    if (typeof window !== 'undefined') localStorage.setItem('bh_lang', lang)
  }, [lang])

  const setLang = useCallback((l: Lang) => setLangState(l), [])

  const setSession = useCallback((u: SessionUser | null, perms?: string[]) => {
    setUserState(u)
    setPermissions(u ? (perms || []) : [])
  }, [])

  const setUser = useCallback((u: SessionUser | null) => {
    setUserState(u)
    if (!u) setPermissions([])
  }, [])

  const can = useCallback((permission: string) => {
    if (!user) return false
    if (user.role === 'ADMIN') return true // BR-RBAC-02 — mirror of requirePermission
    return permissions.includes(permission)
  }, [user, permissions])

  const api = useCallback(async <T,>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> => {
    return apiFetch<T>(path, init)
  }, [])

  const refreshNotifCount = useCallback(() => {
    if (!user) return
    apiFetch<{ unread: number }>('/api/v1/notifications').then((d) => setNotifCount(d.unread || 0)).catch(() => {})
  }, [user])

  useEffect(() => { refreshNotifCount() }, [refreshNotifCount, user?.id])

  const navigate = useCallback((page: string, params?: Record<string, string>) => {
    setView({ page, params })
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 })
  }, [])

  const t = useCallback((k: string) => translate(k, lang), [lang])

  const value = useMemo<AppState>(() => ({
    lang, setLang, t, dir: lang === 'fa' ? 'rtl' : 'ltr', user, setUser, setSession, permissions, can,
    view, navigate, api, refreshNotifCount, notifCount, booted,
  }), [lang, setLang, t, user, setUser, setSession, permissions, can, view, navigate, api, refreshNotifCount, notifCount, booted])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppState {
  const c = useContext(Ctx)
  if (!c) throw new Error('useApp outside provider')
  return c
}

export function logoutUser(setSession: (u: SessionUser | null, p?: string[]) => void, navigate: (p: string) => void) {
  // PHASE 09 (F08): goes through the API client — one fetch/CSRF implementation.
  apiLogout().finally(() => {
    setSession(null)
    navigate('landing')
  })
}

export { ApiError }
