'use client'
// ── Prescription item editor (Expert 1 compose · Expert 2 revise) ─────────
// Product: server-side search combobox (name / SKU / brand / keywords — the
// catalogue is never loaded whole). Dose / frequency / duration / warning:
// admin vocabulary presets with a controlled custom value.
import React, { useCallback, useEffect, useState } from 'react'
import { useApp } from '@/contexts/app'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SearchCombobox, type ComboOption } from './combobox'

export interface RxItemDraft {
  productId?: string | null
  drugName: string
  dosage: string
  frequency: string
  duration: string
  instructions: string
  warnings: string
  quantity: number
  unitPrice?: number | null
}

export const emptyRxItem = (): RxItemDraft => ({ productId: null, drugName: '', dosage: '', frequency: '', duration: '', instructions: '', warnings: '', quantity: 1 })

type VocabKind = 'DOSAGE' | 'FREQUENCY' | 'DURATION' | 'WARNING'

/** Loads the active vocabulary once per editor mount. */
export function useVocabulary() {
  const { api } = useApp()
  const [vocab, setVocab] = useState<Record<VocabKind, ComboOption[]>>({ DOSAGE: [], FREQUENCY: [], DURATION: [], WARNING: [] })
  useEffect(() => {
    api<{ items: { kind: VocabKind; valueFa: string; valueEn?: string | null }[] }>('/api/v1/vocabulary')
      .then((r) => {
        const out: Record<VocabKind, ComboOption[]> = { DOSAGE: [], FREQUENCY: [], DURATION: [], WARNING: [] }
        for (const it of r.items) if (out[it.kind]) out[it.kind].push({ value: it.valueFa, label: it.valueFa, hint: it.valueEn || undefined })
        setVocab(out)
      })
      .catch(() => { /* presets are a convenience — free entry still works */ })
  }, [api])
  return vocab
}

export function RxItemsEditor({ items, onChange, showPrice }: { items: RxItemDraft[]; onChange: (items: RxItemDraft[]) => void; showPrice?: boolean }) {
  const { t, lang, api } = useApp()
  const vocab = useVocabulary()
  const set = (i: number, patch: Partial<RxItemDraft>) => onChange(items.map((it, idx) => idx === i ? { ...it, ...patch } : it))

  const searchProducts = useCallback(async (q: string): Promise<ComboOption[]> => {
    const r = await api<{ products: { id: string; sku: string; nameFa: string; brand?: string; price: number; stock: number; requiresPrescription: boolean }[] }>(
      `/api/v1/products?limit=20${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`)
    return r.products.map((p) => ({
      value: p.id, label: p.nameFa,
      hint: [p.sku, p.brand, `${lang === 'fa' ? 'موجودی' : 'stock'}: ${p.stock}`].filter(Boolean).join(' · '),
      danger: p.stock <= 0 ? (lang === 'fa' ? 'ناموجود' : 'out of stock') : undefined,
    }))
  }, [api, lang])

  return (
    <div className="space-y-3">
      {items.map((it, i) => (
        <div key={i} className="rounded-lg border p-3 space-y-2.5 relative">
          {items.length > 1 && (
            <Button variant="ghost" size="sm" className="absolute top-2 end-2 h-6 text-destructive" onClick={() => onChange(items.filter((_, x) => x !== i))} aria-label={lang === 'fa' ? 'حذف قلم' : 'Remove item'}>×</Button>
          )}
          <div className="grid sm:grid-cols-2 gap-2.5">
            <SearchCombobox label={`${lang === 'fa' ? 'محصول / دارو' : 'Product / drug'} *`} value={it.productId || ''} displayValue={it.drugName}
              onSearch={searchProducts} allowCustom placeholder={lang === 'fa' ? 'نام، کد یا کلیدواژه…' : 'Name, SKU or keyword…'}
              hint={it.productId ? undefined : (it.drugName ? (lang === 'fa' ? 'قلم خارج از فهرست فروشگاه' : 'Not a catalogue product') : undefined)}
              onChange={(v, o) => o ? set(i, { productId: o.value, drugName: o.label }) : set(i, { productId: null, drugName: v })} />
            <div className="space-y-1.5">
              <Label className="text-xs">{lang === 'fa' ? 'تعداد' : 'Quantity'}</Label>
              <Input type="number" min={1} max={999} value={it.quantity} onChange={(e) => set(i, { quantity: Math.max(1, Math.min(999, Number(e.target.value) || 1)) })} dir="ltr" />
            </div>
            <SearchCombobox label={t('dosage')} value={it.dosage} options={vocab.DOSAGE} allowCustom onChange={(v) => set(i, { dosage: v })} />
            <SearchCombobox label={t('frequency')} value={it.frequency} options={vocab.FREQUENCY} allowCustom onChange={(v) => set(i, { frequency: v })} />
            <SearchCombobox label={t('duration')} value={it.duration} options={vocab.DURATION} allowCustom onChange={(v) => set(i, { duration: v })} />
            <SearchCombobox label={`⚠ ${lang === 'fa' ? 'هشدار' : 'Warning'}`} value={it.warnings} options={vocab.WARNING} allowCustom onChange={(v) => set(i, { warnings: v })} />
          </div>
          <div className="grid sm:grid-cols-[1fr_auto] gap-2.5">
            <div className="space-y-1"><Label className="text-xs">{t('instructions')}</Label><Input value={it.instructions} onChange={(e) => set(i, { instructions: e.target.value })} /></div>
            {showPrice && (
              <div className="space-y-1"><Label className="text-xs">{lang === 'fa' ? 'قیمت واحد (تومان)' : 'Unit price'}</Label>
                <Input type="number" min={0} className="w-36" value={it.unitPrice ?? ''} onChange={(e) => set(i, { unitPrice: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })} dir="ltr" />
              </div>
            )}
          </div>
          {/* dangerous ambiguity guard: a dose without frequency (or vice versa) is flagged, not silently accepted */}
          {(!!it.dosage !== !!it.frequency) && (
            <p className="text-[11px] text-status-warning">{lang === 'fa' ? 'مقدار مصرف و تناوب را با هم مشخص کنید.' : 'Set dose and frequency together.'}</p>
          )}
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => onChange([...items, emptyRxItem()])} className="gap-1">+ {lang === 'fa' ? 'قلم جدید' : 'Add item'}</Button>
    </div>
  )
}

/** Items that are filled enough to submit. */
export function submittableRxItems(items: RxItemDraft[]): RxItemDraft[] {
  return items.filter((i) => i.drugName.trim())
}

/** Client-side guard matching the editor hint: dose ⇔ frequency. */
export function rxAmbiguity(items: RxItemDraft[]): boolean {
  return submittableRxItems(items).some((i) => !!i.dosage !== !!i.frequency)
}
