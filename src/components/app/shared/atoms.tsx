'use client'
// Shared UI atoms: StatusBadge, Jalali date, SectionCard, EmptyState, StatCard, ConfidenceBar
import React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useApp } from '@/contexts/app'
import { fmtNum, fmtMoney } from '@/lib/i18n'
import { formatJalali } from '@/lib/jalali'
import { STATUS_META, ORDER_STATUS_META, PAYMENT_STATUS_META, TICKET_STATUS_META } from '@/lib/constants'

export function StatusBadge({ status, kind = 'case' }: { status: string; kind?: 'case' | 'order' | 'payment' | 'ticket' }) {
  const { lang } = useApp()
  const meta =
    kind === 'order' ? ORDER_STATUS_META[status] :
    kind === 'payment' ? PAYMENT_STATUS_META[status] :
    kind === 'ticket' ? TICKET_STATUS_META[status] : STATUS_META[status as keyof typeof STATUS_META]
  if (!meta) return <Badge variant="secondary">{status}</Badge>
  return (
    <Badge className={`${meta.color} text-white border-none font-normal`}>
      {lang === 'fa' ? meta.fa : meta.en}
    </Badge>
  )
}

export function JalaliDate({ date, withTime }: { date: string | Date; withTime?: boolean }) {
  const { lang } = useApp()
  const d = typeof date === 'string' ? new Date(date) : date
  if (lang === 'en') {
    return <span suppressHydrationWarning>{d.toLocaleDateString('en-GB')}{withTime ? ` ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
  }
  return <span suppressHydrationWarning className="font-[inherit] tabular-nums">{formatJalali(d, { withTime })}</span>
}

export function StatCard({ title, value, icon, tone, sub }: { title: string; value: string | number; icon?: React.ReactNode; tone?: string; sub?: string }) {
  return (
    <Card className="border-border/60">
      <CardContent className="p-4 flex items-center gap-4">
        {icon && <div className={`size-10 rounded-lg flex items-center justify-center shrink-0 ${tone || 'bg-primary/10 text-primary'}`}>{icon}</div>}
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground truncate">{title}</div>
          <div className="text-2xl font-bold tabular-nums">{typeof value === 'number' ? fmtNum(value, 'fa') : value}</div>
          {sub && <div className="text-[11px] text-muted-foreground truncate">{sub}</div>}
        </div>
      </CardContent>
    </Card>
  )
}

export function SectionCard({ title, children, action, className }: { title?: string; children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <Card className={className}>
      {title && (
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">{title}</CardTitle>
            {action}
          </div>
        </CardHeader>
      )}
      <CardContent className={title ? 'pt-0' : 'p-6'}>{children}</CardContent>
    </Card>
  )
}

export function EmptyState({ text }: { text?: string }) {
  const { t } = useApp()
  return <div className="text-center text-muted-foreground py-10 text-sm">{text || t('empty')}</div>
}

export function LoadingRows({ rows = 3 }: { rows?: number }) {
  return <div className="space-y-3">{Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
}

export function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const tone = pct >= 75 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-rose-500'
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 rounded-full bg-muted overflow-hidden">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{fmtNum(pct, 'fa')}٪</span>
    </div>
  )
}

export function Money({ amount }: { amount: number }) {
  const { lang } = useApp()
  return <span className="tabular-nums">{fmtMoney(amount, lang)}</span>
}
