'use client'
// ── PHASE 14: Global Search dialog (ED-157) ────────────────────────────────
// One search bar in the AppShell header: debounced, permission-aware results
// grouped by entity kind (server scopes rows by role/permissions). Selecting
// a hit navigates to the matching workspace view.
import React, { useEffect, useRef, useState } from 'react'
import { useApp } from '@/contexts/app'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Search as SearchIcon, LoaderCircle, FileText, Package, User, ShoppingCart, LifeBuoy, Stethoscope } from 'lucide-react'
import { ApiError } from '@/lib/api-error'

interface Hit { id: string; title: string; subtitle?: string; kind: 'case' | 'product' | 'user' | 'order' | 'ticket' | 'disease'; extra?: Record<string, unknown> }
interface Result { q: string; tokensDropped: number; groups: { kind: Hit['kind']; hits: Hit[] }[]; ms: number }

const KIND_ICON: Record<Hit['kind'], React.ReactNode> = {
  case: <FileText size={14} />,
  product: <Package size={14} />,
  user: <User size={14} />,
  order: <ShoppingCart size={14} />,
  ticket: <LifeBuoy size={14} />,
  disease: <Stethoscope size={14} />,
}

export function GlobalSearchDialog() {
  const { t, lang, api, navigate, can, user } = useApp()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // debounce 300ms — the server is also rate-limited (60/min)
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    if (!open || q.trim().length < 2) { setResult(null); setLoading(false); setError(null); return }
    setLoading(true)
    timer.current = setTimeout(async () => {
      try {
        const d = (await api(`/api/v1/search?q=${encodeURIComponent(q.trim())}`)) as Result
        setResult(d); setError(null)
      } catch (e) {
        setError((e as ApiError).message)
        setResult(null)
      } finally { setLoading(false) }
    }, 300)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [q, open, api])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 80)
  }, [open])

  const go = (hit: Hit) => {
    setOpen(false)
    if (hit.kind === 'case') navigate('caseDetail', { id: hit.id })
    else if (hit.kind === 'product') navigate(user?.role === 'PATIENT' ? 'shop' : 'products')
    else if (hit.kind === 'user') navigate('users')
    else if (hit.kind === 'order') navigate('orders')
    else if (hit.kind === 'ticket') navigate('tickets')
    else if (hit.kind === 'disease') navigate('diseases')
  }

  const kindLabel = (k: Hit['kind']) => t('searchKind' + k[0].toUpperCase() + k.slice(1))
  const groups = result?.groups ?? []

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-full border border-border hover:bg-muted transition-colors px-3 h-8 text-xs text-muted-foreground"
        aria-label={t('search')}
      >
        <SearchIcon size={14} />
        <span className="hidden sm:inline">{t('searchPlaceholder')}</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg top-[12%] translate-y-0 p-0 gap-0 overflow-hidden" dir={lang === 'fa' ? 'rtl' : 'ltr'}>
          <DialogHeader className="sr-only"><DialogTitle>{t('search')}</DialogTitle></DialogHeader>
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            {loading ? <LoaderCircle size={16} className="animate-spin text-primary" /> : <SearchIcon size={16} className="text-muted-foreground" />}
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className="flex-1 bg-transparent outline-none text-sm"
              maxLength={120}
            />
            {result && <span className="text-[10px] text-muted-foreground tabular-nums" dir="ltr">{result.ms}ms</span>}
          </div>
          <div className="max-h-[55vh] overflow-y-auto p-2">
            {error && <p className="text-xs text-destructive p-3">{error}</p>}
            {!error && q.trim().length < 2 && <p className="text-xs text-muted-foreground p-3">{t('searchHint')}</p>}
            {!error && q.trim().length >= 2 && !loading && groups.length === 0 && <p className="text-xs text-muted-foreground p-3">{t('searchNoResults')}</p>}
            {groups.map((g) => (
              <div key={g.kind} className="mb-1">
                <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] text-muted-foreground uppercase tracking-wide">
                  {KIND_ICON[g.kind]}
                  {kindLabel(g.kind)}
                  <Badge variant="secondary" className="text-[8px]">{g.hits.length}</Badge>
                </div>
                {g.hits.map((h) => (
                  <button
                    key={h.id}
                    onClick={() => go(h)}
                    className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-start hover:bg-muted transition-colors text-sm"
                  >
                    <span className="font-medium truncate">{h.title}</span>
                    {h.subtitle && <span className="text-xs text-muted-foreground truncate">{h.subtitle}</span>}
                    {h.extra?.status ? <Badge variant="outline" className="text-[8px] ms-auto shrink-0">{String(h.extra.status)}</Badge> : null}
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
            {t('searchHint')}
            {result && result.tokensDropped > 0 && (
              <span className="ms-2 text-status-warning-text">{lang === 'fa' ? `${result.tokensDropped} توکن اضافه نادیده گرفته شد` : `${result.tokensDropped} extra token(s) ignored`}</span>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
