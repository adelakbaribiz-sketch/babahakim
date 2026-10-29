'use client'
// BabaHakim Design System — shared atoms (PHASE 07)
// States per §31-32 (empty/loading/error/success) + UX.md SP-1..SP-8 patterns.
// All colors via design tokens (§27/§39) — no hardcoded palette classes.
import React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { useApp } from '@/contexts/app'
import { fmtNum, fmtMoney } from '@/lib/i18n'
import { formatJalali } from '@/lib/jalali'
import { STATUS_META, ORDER_STATUS_META, PAYMENT_STATUS_META, TICKET_STATUS_META } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { Inbox, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'

// ─── StatusBadge (§9) ─────────────────────────────────────────────────────
export function StatusBadge({ status, kind = 'case' }: { status: string; kind?: 'case' | 'order' | 'payment' | 'ticket' }) {
  const { lang } = useApp()
  const meta =
    kind === 'order' ? ORDER_STATUS_META[status] :
    kind === 'payment' ? PAYMENT_STATUS_META[status] :
    kind === 'ticket' ? TICKET_STATUS_META[status] : STATUS_META[status as keyof typeof STATUS_META]
  if (!meta) return <Badge variant="secondary">{status}</Badge>
  // meta.color = status token classes (§9) — bg-status-* / text-status-*-fg
  return (
    <Badge className={cn(meta.color, 'border-none font-normal')}>
      {lang === 'fa' ? meta.fa : meta.en}
    </Badge>
  )
}

// ─── Jalali / Gregorian date (render-only i18n) ────────────────────────────
export function JalaliDate({ date, withTime }: { date: string | Date; withTime?: boolean }) {
  const { lang } = useApp()
  const d = typeof date === 'string' ? new Date(date) : date
  if (lang === 'en') {
    return <span suppressHydrationWarning>{d.toLocaleDateString('en-GB')}{withTime ? ` ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
  }
  return <span suppressHydrationWarning className="font-[inherit] tabular-nums">{formatJalali(d, { withTime })}</span>
}

// ─── StatCard (§18 admin stats) ────────────────────────────────────────────
export function StatCard({ title, value, icon, tone, sub }: { title: string; value: string | number; icon?: React.ReactNode; tone?: string; sub?: string }) {
  const { lang } = useApp() // digits follow the UI language (was hard-coded Persian)
  return (
    <Card className="border-border/60 shadow-card">
      <CardContent className="p-4 flex items-center gap-4">
        {icon && <div className={cn('size-10 rounded-lg flex items-center justify-center shrink-0', tone || 'bg-primary/10 text-primary')}>{icon}</div>}
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground truncate">{title}</div>
          <div className="text-2xl font-bold tabular-nums">{typeof value === 'number' ? fmtNum(value, lang) : value}</div>
          {sub && <div className="text-[11px] text-muted-foreground truncate">{sub}</div>}
        </div>
      </CardContent>
    </Card>
  )
}

// ─── SectionCard (§21) ─────────────────────────────────────────────────────
export function SectionCard({ title, desc, children, action, className }: { title?: string; desc?: string; children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <Card className={cn('shadow-card', className)}>
      {title && (
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <CardTitle className="text-base">{title}</CardTitle>
              {desc && <div className="text-xs text-muted-foreground leading-relaxed mt-1">{desc}</div>}
            </div>
            {action}
          </div>
        </CardHeader>
      )}
      <CardContent className={title ? 'pt-0' : 'p-6'}>{children}</CardContent>
    </Card>
  )
}

// ─── §31 Empty / §32 Loading / Error / Success states (SP-1..SP-8) ────────

/** §31 — professional empty state: icon + title + hint + optional action. */
export function EmptyState({ text, title, hint, action, icon }: {
  text?: string // backward-compatible simple mode
  title?: string; hint?: string; action?: React.ReactNode; icon?: React.ReactNode
}) {
  const { t } = useApp()
  if (!title && !hint && !action && !icon) {
    return <div className="text-center text-muted-foreground py-10 text-sm">{text || t('empty')}</div>
  }
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 px-4 gap-2" data-state="empty">
      <div className="size-12 rounded-full bg-muted flex items-center justify-center text-muted-foreground" aria-hidden>
        {icon || <Inbox size={22} />}
      </div>
      <div className="text-sm font-medium text-foreground">{title ?? t('emptyTitle')}</div>
      {hint && <div className="text-xs text-muted-foreground max-w-sm leading-relaxed">{hint}</div>}
      {action && <div className="pt-2">{action}</div>}
    </div>
  )
}

/** §32 — loading states: rows (tables/lists), card, or inline spinner. */
export function LoadingRows({ rows = 3 }: { rows?: number }) {
  return <div className="space-y-3" data-state="loading" aria-busy="true" aria-live="polite">{Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
}

export function LoadingCard({ lines = 3 }: { lines?: number }) {
  return (
    <Card className="shadow-card" data-state="loading" aria-busy="true" aria-live="polite">
      <CardContent className="p-4 space-y-3">
        <Skeleton className="h-5 w-2/5" />
        {Array.from({ length: lines }).map((_, i) => <Skeleton key={i} className="h-4 w-full last:w-3/5" />)}
      </CardContent>
    </Card>
  )
}

export function LoadingSpinner({ label, className }: { label?: string; className?: string }) {
  const { t } = useApp()
  return (
    <div className={cn('flex items-center justify-center gap-2 py-8 text-muted-foreground text-sm', className)} data-state="loading" role="status" aria-live="polite">
      <Spinner className="size-4" />
      {label || t('loading')}
    </div>
  )
}

/** Error state (SP-5) — actionable retry. */
export function ErrorState({ title, message, error, onRetry, retryLabel }: {
  title?: string; message?: string; error?: unknown; onRetry?: () => void; retryLabel?: string
}) {
  const { t } = useApp()
  const text = message ?? (error instanceof Error ? error.message : error != null ? String(error) : undefined)
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 px-4 gap-2" data-state="error" role="alert">
      <div className="size-12 rounded-full bg-destructive/10 flex items-center justify-center text-destructive" aria-hidden>
        <AlertTriangle size={22} />
      </div>
      <div className="text-sm font-medium text-foreground">{title ?? t('errorTitle')}</div>
      {text && <div className="text-xs text-muted-foreground max-w-sm leading-relaxed">{text}</div>}
      {onRetry && <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>{retryLabel || t('retry')}</Button>}
    </div>
  )
}

/** Success state — confirmation moment (§33 subtle, no heavy animation). */
export function SuccessState({ title, message, action }: { title?: string; message?: string; action?: React.ReactNode }) {
  const { t } = useApp()
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 px-4 gap-2" data-state="success">
      <div className="size-12 rounded-full bg-status-success/15 flex items-center justify-center text-status-success" aria-hidden>
        <CheckCircle2 size={22} />
      </div>
      <div className="text-sm font-medium text-foreground">{title ?? t('successTitle')}</div>
      {message && <div className="text-xs text-muted-foreground max-w-sm leading-relaxed">{message}</div>}
      {action && <div className="pt-2">{action}</div>}
    </div>
  )
}

/** SP-7 page-state orchestrator: loading → error → empty → content. */
export function PageState({ loading, error, empty, onRetry, emptyTitle, emptyHint, emptyAction, children, skeleton }: {
  loading?: boolean; error?: string | null; empty?: boolean
  onRetry?: () => void; emptyTitle?: string; emptyHint?: string; emptyAction?: React.ReactNode
  children: React.ReactNode; skeleton?: 'rows' | 'card'
}) {
  if (loading) return skeleton === 'card' ? <LoadingCard /> : <LoadingRows />
  if (error) return <ErrorState message={error} onRetry={onRetry} />
  if (empty) return <EmptyState title={emptyTitle} hint={emptyHint} action={emptyAction} />
  return <>{children}</>
}

// ─── ConfirmDialog — destructive/confirmation pattern (§26 Modal) ──────────
export function ConfirmDialog({ trigger, title, description, confirmLabel, cancelLabel, onConfirm, destructive = false }: {
  trigger: React.ReactNode; title: string; description?: string
  confirmLabel?: string; cancelLabel?: string; onConfirm: () => void | Promise<void>; destructive?: boolean
}) {
  const { t } = useApp()
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel || t('cancel')}</AlertDialogCancel>
          <AlertDialogAction
            className={destructive ? 'bg-destructive text-white hover:bg-destructive/90' : undefined}
            onClick={(e) => { e.preventDefault(); void onConfirm() }}
          >
            {confirmLabel || t('confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ─── ConfidenceBar (§14 — AI confidence, status-token tones) ──────────────
export function ConfidenceBar({ value }: { value: number }) {
  const { lang } = useApp()
  const pct = Math.round(value * 100)
  const tone = pct >= 75 ? 'bg-status-success' : pct >= 50 ? 'bg-status-warning' : 'bg-status-danger'
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 rounded-full bg-muted overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className={cn('h-full transition-[width]', tone)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{fmtNum(pct, lang)}{lang === 'fa' ? '٪' : '%'}</span>
    </div>
  )
}

// ─── Money (tabular, locale-aware) ─────────────────────────────────────────
export function Money({ amount }: { amount: number }) {
  const { lang } = useApp()
  return <span className="tabular-nums">{fmtMoney(amount, lang)}</span>
}

/** Inline button spinner for async actions (SP-3 idempotent-feel buttons). */
export function ButtonSpinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-4 animate-spin', className)} aria-hidden />
}
