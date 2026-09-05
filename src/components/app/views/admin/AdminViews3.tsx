'use client'
// ── Admin views 3: External Integrations console (PHASE 13) ────────────────
// Monitoring surface for the Adapter/Provider Layer: 9 integration kinds ×
// (mode live/mock, credential PRESENCE, circuit state, 24h stats, p50/p95)
// + recent calls/failures + per-kind smoke test. Read-only telemetry + the
// single INTEGRATION_SMOKE_TEST action — every adapter write path stays in
// the backend services (Backend-SoT, BR-INT-08).
import React, { useState } from 'react'
import { useApp } from '@/contexts/app'
import { useApiQuery } from '@/hooks/use-api'
import { ApiError } from '@/lib/api-error'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { SectionCard, LoadingRows, EmptyState, ErrorState } from '../../shared/atoms'
import { Plug, Play, Activity, Timer, ShieldCheck, ShieldAlert, KeyRound, RotateCw } from 'lucide-react'

const CALL_STATUS_COLOR: Record<string, string> = {
  SUCCESS: 'bg-status-success text-status-success-fg',
  REPLAYED: 'bg-status-info text-status-info-fg',
  PARTIAL: 'bg-status-warning text-status-warning-fg',
  FAILED: 'bg-status-danger text-status-danger-fg',
  SKIPPED_CIRCUIT: 'bg-status-warning text-status-warning-fg',
  FALLBACK: 'bg-status-warning text-status-warning-fg',
}

function CallStatusBadge({ status }: { status: string }) {
  return <Badge className={`text-[10px] font-mono ${CALL_STATUS_COLOR[status] ?? 'bg-muted text-muted-foreground'}`}>{status}</Badge>
}

interface KindRow {
  kind: string
  label: string
  descFa: string
  mode: 'live' | 'mock'
  requestedMode: string
  provider: string
  credentials: { env: string; label: string; present: boolean }[]
  circuit: { state: string; consecutiveFailures: number; lastFailureCode?: string }
  stats: { total: number; successRate: number; p50: number; p95: number; lastError: { code: string; message: string; at: number } | null }
  durable24h: { total: number; success: number; failed: number; avgLatency: number }
}

interface Overview {
  kinds: KindRow[]
  recentFailures: { at: string; kind: string; provider: string; operation: string; errorCode?: string; errorMessage?: string; latencyMs: number }[]
  recentCalls: { kind: string; provider: string; operation: string; status: string; attempts: number; latencyMs?: number; errorCode?: string; errorMessage?: string; createdAt: string; relatedType?: string; relatedId?: string }[]
}

export function AdminIntegrationsPage() {
  const { t, lang, api } = useApp()
  const [testing, setTesting] = useState<string | null>(null)
  const { data, error, loading, refetch } = useApiQuery<Overview>('/api/v1/admin/integrations')
  const rows = data?.kinds ?? []

  async function smokeTest(kind: string) {
    setTesting(kind)
    try {
      const r = await api('/api/v1/admin/integrations/test', { method: 'POST', json: { kind } }) as { ok: boolean; provider: string; mode: string; latencyMs: number; detail: string; hintFa: string }
      if (r.ok) toast.success(r.hintFa)
      else toast.error(r.hintFa)
      refetch()
    } catch (e) {
      toast.error((e as ApiError).message || String(e))
    } finally {
      setTesting(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="page-title"><Plug size={22} />{lang === 'fa' ? 'Integrations خارجی' : 'External Integrations'}</h1>
        <Button size="sm" variant="outline" className="ms-auto gap-1.5" onClick={refetch}><RotateCw size={14} />{t('refresh') || (lang === 'fa' ? 'بازخوانی' : 'Refresh')}</Button>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        {lang === 'fa'
          ? 'لایه Adapter/Provider: هر ۹ سرویس خارجی با Timeout، Retry، Idempotency، Error Handling، Logging، Monitoring، Fallback و Circuit Breaker. حالت Live فقط با Credential کامل فعال می‌شود (fail-safe).'
          : 'Adapter/Provider layer: all 9 external services with Timeout, Retry, Idempotency, Error Handling, Logging, Monitoring, Fallback and Circuit Breaker. Live mode requires complete credentials (fail-safe).'}
      </p>

      {loading ? <LoadingRows /> : error ? <ErrorState message={error.supportRef} onRetry={refetch} /> : rows.length === 0 ? <EmptyState /> : (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => (
            <Card key={r.kind} data-testid={`integration-${r.kind.toLowerCase()}`}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-sm">{r.label}</span>
                  <Badge variant="outline" className="font-mono text-[10px]" dir="ltr">{r.provider}</Badge>
                  <Badge className={`text-[10px] ${r.mode === 'live' ? 'bg-status-success text-status-success-fg' : 'bg-muted text-muted-foreground'}`} dir="ltr">
                    {r.mode === 'live' ? 'LIVE' : 'MOCK'}
                  </Badge>
                  <Button
                    size="sm" variant="outline" className="h-7 ms-auto gap-1 text-xs"
                    disabled={testing === r.kind}
                    onClick={() => smokeTest(r.kind)}
                    aria-label={`${lang === 'fa' ? 'تست' : 'Test'} ${r.label}`}
                  >
                    <Play size={12} />{testing === r.kind ? '…' : lang === 'fa' ? 'تست' : 'Test'}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{r.descFa}</p>

                <div className="flex items-center gap-3 flex-wrap text-xs">
                  <span className="flex items-center gap-1">
                    {r.circuit.state === 'CLOSED'
                      ? <><ShieldCheck size={13} className="text-status-success" /><span className="text-muted-foreground">circuit: CLOSED</span></>
                      : <><ShieldAlert size={13} className="text-status-warning" /><span className="text-muted-foreground font-mono" dir="ltr">circuit: {r.circuit.state}{r.circuit.consecutiveFailures ? ` (${r.circuit.consecutiveFailures})` : ''}</span></>}
                  </span>
                  {r.stats.p95 > 0 && (
                    <span className="flex items-center gap-1 text-muted-foreground"><Timer size={13} />p50 {r.stats.p50}ms · p95 {r.stats.p95}ms</span>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <span className="text-muted-foreground flex items-center gap-1"><Activity size={13} />{lang === 'fa' ? '۲۴ ساعت' : '24h'}:</span>
                  <CallStatusBadge status={
                    r.durable24h.total === 0 ? 'IDLE'
                      : r.durable24h.failed === 0 ? 'SUCCESS'
                        : r.durable24h.failed < r.durable24h.success ? 'PARTIAL'
                          : 'FAILED'
                  } />
                  <span className="text-muted-foreground tabular-nums" dir="ltr">
                    {r.durable24h.success}/{r.durable24h.total} · {r.durable24h.avgLatency}ms avg
                  </span>
                </div>

                {r.credentials.length > 0 && (
                  <div className="space-y-1">
                    {r.credentials.map((c) => (
                      <div key={c.env} className="flex items-center gap-1.5 text-[11px]" dir="ltr">
                        <KeyRound size={11} className={c.present ? 'text-status-success' : 'text-muted-foreground/50'} />
                        <span className="font-mono text-muted-foreground">{c.env}</span>
                        <span className={c.present ? 'text-status-success' : 'text-muted-foreground/60'}>{c.present ? '●' : '○'}</span>
                      </div>
                    ))}
                  </div>
                )}
                {r.credentials.length === 0 && (
                  <div className="text-[11px] text-muted-foreground/70" dir="ltr">no credentials required</div>
                )}

                {r.stats.lastError && (
                  <div className="text-[11px] text-destructive/90 leading-relaxed border-s-2 border-destructive/40 ps-2">
                    <span className="font-mono" dir="ltr">{r.stats.lastError.code}</span> — {r.stats.lastError.message.slice(0, 120)}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {data && (
        <SectionCard title={lang === 'fa' ? 'آخرین فراخوانی‌ها (IntegrationCallLog)' : 'Recent calls (IntegrationCallLog)'}>
          {data.recentCalls.length === 0 ? <EmptyState /> : (
            <div className="overflow-x-auto text-xs">
              <table className="w-full min-w-[640px]">
                <thead>
                  <tr className="border-b">
                    <th className="text-start p-2">{lang === 'fa' ? 'زمان' : 'Time'}</th>
                    <th className="text-start p-2">Kind</th>
                    <th className="text-start p-2">Operation</th>
                    <th className="text-start p-2">{lang === 'fa' ? 'وضعیت' : 'Status'}</th>
                    <th className="text-start p-2">{lang === 'fa' ? 'تلاش' : 'Try'}</th>
                    <th className="text-start p-2">{lang === 'fa' ? 'تأخیر' : 'Latency'}</th>
                    <th className="text-start p-2">{lang === 'fa' ? 'خطا' : 'Error'}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentCalls.map((c, i) => (
                    <tr key={i} className="border-b border-border/40">
                      <td className="p-2 text-muted-foreground tabular-nums" dir="ltr">{new Date(c.createdAt).toLocaleString(lang === 'fa' ? 'fa-IR' : 'en-US')}</td>
                      <td className="p-2"><Badge variant="outline" className="font-mono text-[10px]">{c.kind}</Badge></td>
                      <td className="p-2 font-mono text-[10px]" dir="ltr">{c.provider}.{c.operation}</td>
                      <td className="p-2"><CallStatusBadge status={c.status} /></td>
                      <td className="p-2 tabular-nums text-center">{c.attempts}</td>
                      <td className="p-2 tabular-nums" dir="ltr">{c.latencyMs ?? '—'}ms</td>
                      <td className="p-2 text-destructive/80 max-w-40 truncate" dir="ltr">{c.errorCode ? `${c.errorCode}: ${c.errorMessage ?? ''}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {data && data.recentFailures.length > 0 && (
        <SectionCard title={lang === 'fa' ? 'خطاهای اخیر' : 'Recent failures'}>
          <div className="space-y-1.5">
            {data.recentFailures.map((f, i) => (
              <div key={i} className="flex items-start gap-2 text-xs flex-wrap">
                <Badge variant="outline" className="font-mono text-[10px]">{f.kind}</Badge>
                <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">{f.operation}</span>
                <span className="text-destructive/80" dir="ltr">{f.errorCode}</span>
                <span className="text-muted-foreground truncate max-w-64" dir="ltr">{f.errorMessage?.slice(0, 100)}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  )
}
