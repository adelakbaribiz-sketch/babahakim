'use client'
// ── BabaHakim searchable combobox (2026-10 overhaul) ──────────────────────
// One component for every "type to find" field: provinces/cities (static
// list), prescription products (server search — never loads the whole
// catalogue), vocabulary presets (dose/frequency/duration) with an optional
// controlled custom value. Built on cmdk + Radix Popover (shadcn primitives);
// labeled through FieldShell so a11y wiring matches the other form atoms.
import React, { useEffect, useRef, useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Button } from '@/components/ui/button'
import { FieldShell } from './form'
import { cn } from '@/lib/utils'
import { Check, ChevronsUpDown, Loader2, Plus } from 'lucide-react'

export interface ComboOption {
  value: string
  label: string
  /** secondary line (code, stock, warning…) */
  hint?: string
  disabled?: boolean
  /** rendered as a red badge — e.g. inactive / out of stock / contraindicated */
  danger?: string
}

export interface SearchComboboxProps {
  label: string
  value: string
  onChange: (value: string, option?: ComboOption) => void
  /** static options (filtered client-side) */
  options?: ComboOption[]
  /** async server search — called debounced with the typed text */
  onSearch?: (q: string) => Promise<ComboOption[]>
  /** allow a typed value that is not in the list */
  allowCustom?: boolean
  placeholder?: string
  emptyText?: string
  error?: string
  hint?: string
  required?: boolean
  disabled?: boolean
  className?: string
  /** label to show when `value` is not among the loaded options (async mode) */
  displayValue?: string
}

export function SearchCombobox(props: SearchComboboxProps) {
  const {
    label, value, onChange, options, onSearch, allowCustom, placeholder, emptyText,
    error, hint, required, disabled, className, displayValue,
  } = props
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [remote, setRemote] = useState<ComboOption[]>([])
  const [loading, setLoading] = useState(false)
  const seq = useRef(0)

  useEffect(() => {
    if (!onSearch || !open) return
    const my = ++seq.current
    const handle = setTimeout(() => {
      setLoading(true)
      onSearch(q).then((rows) => { if (my === seq.current) setRemote(rows) })
        .catch(() => { if (my === seq.current) setRemote([]) })
        .finally(() => { if (my === seq.current) setLoading(false) })
    }, 250)
    return () => clearTimeout(handle)
  }, [q, open, onSearch])

  const list = onSearch ? remote : (options || [])
  const selected = list.find((o) => o.value === value) || (options || []).find((o) => o.value === value)
  const shown = selected?.label || displayValue || value
  const typed = q.trim()
  const canAddCustom = allowCustom && typed.length > 0 && !list.some((o) => o.label === typed)

  return (
    <FieldShell label={label} error={error} hint={hint} required={required} className={className}>
      {(id, aria) => (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open} disabled={disabled}
              {...aria} className={cn('w-full justify-between font-normal', !shown && 'text-muted-foreground')}>
              <span className="truncate">{shown || placeholder || '—'}</span>
              <ChevronsUpDown size={14} className="opacity-50 shrink-0" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="p-0 w-[--radix-popover-trigger-width] min-w-64" align="start">
            {/* async mode filters on the server; static mode lets cmdk filter */}
            <Command shouldFilter={!onSearch}>
              <CommandInput value={q} onValueChange={setQ} placeholder={placeholder || 'جست‌وجو…'} />
              <CommandList>
                {loading && <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground"><Loader2 size={13} className="animate-spin" /> …</div>}
                {!loading && <CommandEmpty>{emptyText || 'موردی یافت نشد'}</CommandEmpty>}
                <CommandGroup>
                  {list.map((o) => (
                    <CommandItem key={o.value} value={`${o.label} ${o.hint || ''} ${o.value}`} disabled={o.disabled}
                      onSelect={() => { onChange(o.value, o); setOpen(false); setQ('') }}>
                      <Check size={14} className={cn('me-1', value === o.value ? 'opacity-100' : 'opacity-0')} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate">{o.label}</div>
                        {o.hint && <div className="text-[10px] text-muted-foreground truncate">{o.hint}</div>}
                      </div>
                      {o.danger && <span className="ms-2 rounded bg-destructive/10 text-destructive text-[10px] px-1.5 py-0.5 shrink-0">{o.danger}</span>}
                    </CommandItem>
                  ))}
                  {canAddCustom && (
                    <CommandItem value={`__custom__${typed}`} onSelect={() => { onChange(typed); setOpen(false); setQ('') }}>
                      <Plus size={14} className="me-1" /> «{typed}»
                    </CommandItem>
                  )}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
    </FieldShell>
  )
}
