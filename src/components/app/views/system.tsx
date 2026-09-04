'use client'
// ── System views: 403 Forbidden (SH-06) + 404 Not Found (SH-07) ───────────
// PHASE 09 (F01/F24): the router renders these instead of silently falling
// back to a dashboard or rendering an admin component without permission.
import React from 'react'
import { useApp } from '@/contexts/app'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ShieldOff, SearchX } from 'lucide-react'

export function ForbiddenView() {
  const { t, navigate, user } = useApp()
  return (
    <div className="max-w-md mx-auto py-16" data-state="forbidden" role="alert">
      <Card className="border-status-warning/40">
        <CardContent className="p-8 text-center space-y-4">
          <div className="mx-auto size-14 rounded-2xl bg-status-warning/10 text-status-warning flex items-center justify-center"><ShieldOff size={28} /></div>
          <div className="text-lg font-bold">{t('forbiddenTitle')}</div>
          <p className="text-sm text-muted-foreground leading-relaxed">{t('forbiddenHint')}</p>
          <Button variant="outline" onClick={() => navigate('dashboard')}>{t('backHome')}</Button>
          <div className="text-[11px] text-muted-foreground">{user?.role}</div>
        </CardContent>
      </Card>
    </div>
  )
}

export function NotFoundView() {
  const { t, navigate } = useApp()
  return (
    <div className="max-w-md mx-auto py-16" data-state="notfound">
      <Card>
        <CardContent className="p-8 text-center space-y-4">
          <div className="mx-auto size-14 rounded-2xl bg-muted text-muted-foreground flex items-center justify-center"><SearchX size={28} /></div>
          <div className="text-lg font-bold">{t('notFoundTitle')}</div>
          <p className="text-sm text-muted-foreground leading-relaxed">{t('notFoundHint')}</p>
          <Button onClick={() => navigate('dashboard')}>{t('backHome')}</Button>
        </CardContent>
      </Card>
    </div>
  )
}
