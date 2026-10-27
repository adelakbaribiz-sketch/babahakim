'use client'
// ── Admin: prescription vocabulary (2026-10 overhaul) ─────────────────────
// Presets for dose / unit / frequency / duration / warning comboboxes in the
// expert prescription editor. Deactivate instead of delete: prescriptions
// store the chosen text, so history never depends on a preset row.
import React, { useState } from 'react'
import { useApp } from '@/contexts/app'
import { useApiQuery } from '@/hooks/use-api'
import { ApiError } from '@/lib/api-error'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { LoadingRows, EmptyState, ErrorState } from '../../shared/atoms'
import { BookOpenText, Plus } from 'lucide-react'

const KINDS = [
  ['DOSAGE', 'مقدار مصرف', 'Dose'], ['UNIT', 'واحد', 'Unit'], ['FREQUENCY', 'تناوب', 'Frequency'],
  ['DURATION', 'مدت', 'Duration'], ['WARNING', 'هشدار', 'Warning'],
] as const

interface VocabItem { id: string; kind: string; valueFa: string; valueEn?: string | null; order: number; active: boolean }

export function AdminVocabularyPage() {
  const { t, lang, api } = useApp()
  const [kind, setKind] = useState<string>('DOSAGE')
  const [draft, setDraft] = useState({ valueFa: '', valueEn: '' })
  const [busy, setBusy] = useState(false)
  const { data, error, loading, refetch } = useApiQuery<{ items: VocabItem[] }>(`/api/v1/admin/vocabulary?kind=${kind}`)
  const items = data?.items || []

  async function add() {
    setBusy(true)
    try {
      await api('/api/v1/admin/vocabulary', { method: 'POST', json: { kind, valueFa: draft.valueFa, valueEn: draft.valueEn || null, order: items.length + 1 } })
      setDraft({ valueFa: '', valueEn: '' }); toast.success(t('successTitle')); refetch()
    } catch (e) { toast.error(ApiError.message(e)) } finally { setBusy(false) }
  }

  async function patch(id: string, data2: Partial<VocabItem>) {
    try {
      await api('/api/v1/admin/vocabulary', { method: 'PATCH', json: { id, ...data2 } })
      refetch()
    } catch (e) { toast.error(ApiError.message(e)) }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="page-title"><BookOpenText size={22} />{t('vocabulary')}</h1>
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className="w-44 ms-auto" aria-label={lang === 'fa' ? 'نوع' : 'Kind'}><SelectValue /></SelectTrigger>
          <SelectContent>{KINDS.map(([k, fa, en]) => <SelectItem key={k} value={k}>{lang === 'fa' ? fa : en}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <p className="text-xs text-muted-foreground">{lang === 'fa' ? 'این گزینه‌ها فقط قالب ورود هستند و توصیه پزشکی محسوب نمی‌شوند؛ کارشناس می‌تواند مقدار دلخواه هم وارد کند.' : 'Presets are input formats only, not medical advice; experts may still type a custom value.'}</p>
      <Card>
        <CardContent className="p-3 flex gap-2 flex-wrap items-center">
          <Input value={draft.valueFa} onChange={(e) => setDraft({ ...draft, valueFa: e.target.value })} placeholder={lang === 'fa' ? 'مقدار (فارسی)' : 'Value (fa)'} className="w-56" aria-label={lang === 'fa' ? 'مقدار فارسی' : 'Persian value'} />
          <Input value={draft.valueEn} onChange={(e) => setDraft({ ...draft, valueEn: e.target.value })} placeholder="English (optional)" className="w-48" dir="ltr" aria-label="English value" />
          <Button size="sm" className="gap-1" disabled={busy || !draft.valueFa.trim()} onClick={add}><Plus size={14} />{lang === 'fa' ? 'افزودن' : 'Add'}</Button>
        </CardContent>
      </Card>
      {loading && !data ? <LoadingRows /> : error ? <ErrorState message={error.supportRef} onRetry={refetch} /> : items.length === 0 ? <EmptyState /> : (
        <div className="space-y-1.5">
          {items.map((it) => (
            <Card key={it.id} className={it.active ? '' : 'opacity-60'}>
              <CardContent className="p-2.5 flex items-center gap-2 text-sm">
                <Input defaultValue={it.valueFa} className="h-8 w-56" aria-label={lang === 'fa' ? 'مقدار فارسی' : 'Persian value'}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== it.valueFa) patch(it.id, { valueFa: v }) }} />
                <Input defaultValue={it.valueEn || ''} className="h-8 w-44" dir="ltr" aria-label="English value"
                  onBlur={(e) => { const v = e.target.value.trim(); if (v !== (it.valueEn || '')) patch(it.id, { valueEn: v || null }) }} />
                <Input type="number" defaultValue={it.order} className="h-8 w-20" dir="ltr" aria-label={lang === 'fa' ? 'ترتیب' : 'Order'}
                  onBlur={(e) => { const v = Number(e.target.value); if (Number.isInteger(v) && v >= 0 && v !== it.order) patch(it.id, { order: v }) }} />
                <label className="ms-auto flex items-center gap-1.5 text-xs">
                  <Switch checked={it.active} onCheckedChange={(v) => patch(it.id, { active: v })} />
                  {it.active ? (lang === 'fa' ? 'فعال' : 'Active') : (lang === 'fa' ? 'غیرفعال' : 'Inactive')}
                </label>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
