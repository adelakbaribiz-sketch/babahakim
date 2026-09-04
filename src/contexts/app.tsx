'use client'
// App context: auth + language + view navigation + API client (auto refresh on 401)
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { Lang, t as translate } from '@/lib/i18n'

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
  setUser: (u: SessionUser | null) => void
  view: View
  navigate: (page: string, params?: Record<string, string>) => void
  api: <T = unknown>(path: string, init?: RequestInit & { json?: unknown }) => Promise<T>
  refreshNotifCount: () => void
  notifCount: number
}

const Ctx = createContext<AppState | null>(null)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('fa')
  const [user, setUser] = useState<SessionUser | null>(null)
  const [permissions, setPermissions] = useState<string[]>([])
  const [view, setView] = useState<View>({ page: 'landing' })
  const [notifCount, setNotifCount] = useState(0)

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? (localStorage.getItem('bh_lang') as Lang | null) : null
    if (saved === 'fa' || saved === 'en') queueMicrotask(() => setLangState(saved))
    fetch('/api/v1/auth/me').then(async (r) => {
      if (r.ok) {
        const data = await r.json()
        setUser(data.user)
        setPermissions(data.permissions || [])
        setView({ page: 'dashboard' })
      }
    }).catch(() => {})
  }, [])

  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr'
    if (typeof window !== 'undefined') localStorage.setItem('bh_lang', lang)
  }, [lang])

  const setLang = useCallback((l: Lang) => setLangState(l), [])

  const api = useCallback(async <T,>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> => {
    const csrf = () => {
      try {
        const m = document.cookie.match(/(?:^|;\s*)ta_csrf=([^;]+)/)
        return m ? m[1] : ''
      } catch {
        return ''
      }
    }
    const doFetch = () =>
      fetch(path, {
        ...init,
        headers: {
          ...(init?.json !== undefined ? { 'Content-Type': 'application/json' } : {}),
          // PHASE 05: double-submit CSRF (middleware enforces equality with cookie)
          ...((init?.method || 'GET').toUpperCase() !== 'GET' ? { 'x-csrf-token': csrf() } : {}),
          ...(init?.headers || {}),
        },
        body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
        credentials: 'same-origin',
      })
    let res = await doFetch()
    if (res.status === 401 && path !== '/api/v1/auth/me') {
      const refreshed = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'x-csrf-token': csrf() },
      })
      if (refreshed.ok) res = await doFetch()
    }
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
    return data as T
  }, [])

  const refreshNotifCount = useCallback(() => {
    if (!user) return
    api<{ unread: number }>('/api/v1/notifications').then((d) => setNotifCount(d.unread || 0)).catch(() => {})
  }, [user, api])

  useEffect(() => { refreshNotifCount() }, [refreshNotifCount, user?.id])

  const navigate = useCallback((page: string, params?: Record<string, string>) => {
    setView({ page, params })
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 })
  }, [])

  const t = useCallback((k: string) => translate(k, lang), [lang])

  const value = useMemo<AppState>(() => ({
    lang, setLang, t, dir: lang === 'fa' ? 'rtl' : 'ltr', user, setUser, permissions,
    view, navigate, api, refreshNotifCount, notifCount,
  }), [lang, setLang, t, user, permissions, view, navigate, api, refreshNotifCount, notifCount])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppState {
  const c = useContext(Ctx)
  if (!c) throw new Error('useApp outside provider')
  return c
}

export function logoutUser(setUser: (u: SessionUser | null) => void, navigate: (p: string) => void) {
  const csrf = (() => {
    try {
      const m = document.cookie.match(/(?:^|;\s*)ta_csrf=([^;]+)/)
      return m ? m[1] : ''
    } catch {
      return ''
    }
  })()
  fetch('/api/v1/auth/logout', { method: 'POST', headers: { 'x-csrf-token': csrf } }).finally(() => {
    setUser(null)
    navigate('landing')
  })
}
