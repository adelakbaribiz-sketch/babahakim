'use client'
// ── BabaHakim shared form atoms (PHASE 09, ED-111) ────────────────────────
// Field-level validation display with proper a11y wiring (F18):
//   Label[htmlFor] + input[id] + aria-invalid + aria-describedby → error text
// Used with src/lib/forms.ts zod mirrors; ApiError.fields feeds the same shape.
import React from 'react'
import { useId } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { AlertCircle } from 'lucide-react'
import { gregorianToJalali, jalaliToGregorian, toFaDigits, FA_MONTHS } from '@/lib/jalali'

export interface FieldShellProps {
  label: string
  error?: string
  hint?: string
  required?: boolean
  className?: string
  children: (id: string, aria: { 'aria-invalid': boolean; 'aria-describedby': string | undefined }) => React.ReactNode
}

/** Label + error + hint wrapper — the ONLY way form fields get labeled. */
export function FieldShell({ label, error, hint, required, className, children }: FieldShellProps) {
  const id = useId()
  const errId = `${id}-err`
  const hintId = `${id}-hint`
  const describedBy = [error ? errId : '', hint ? hintId : ''].filter(Boolean).join(' ') || undefined
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id} className="text-xs">
        {label}
        {required && <span className="text-destructive ms-1" aria-hidden>*</span>}
      </Label>
      {children(id, { 'aria-invalid': !!error, 'aria-describedby': describedBy })}
      {hint && !error && <p id={hintId} className="text-[11px] text-muted-foreground leading-relaxed">{hint}</p>}
      {error && (
        <p id={errId} role="alert" className="text-[11px] text-destructive flex items-center gap-1">
          <AlertCircle size={12} aria-hidden /> {error}
        </p>
      )}
    </div>
  )
}

/** Text input field with error display. */
export function TextField(props: Omit<React.ComponentProps<typeof Input>, 'id'> & { label: string; error?: string; hint?: string; required?: boolean }) {
  const { label, error, hint, required, className, ...input } = props
  return (
    <FieldShell label={label} error={error} hint={hint} required={required} className={className}>
      {(id, aria) => <Input id={id} {...input} {...aria} aria-describedby={aria['aria-describedby']} />}
    </FieldShell>
  )
}

/** Textarea field with error display. */
export function TextAreaField(props: Omit<React.ComponentProps<typeof Textarea>, 'id'> & { label: string; error?: string; hint?: string; required?: boolean }) {
  const { label, error, hint, required, className, ...input } = props
  return (
    <FieldShell label={label} error={error} hint={hint} required={required} className={className}>
      {(id, aria) => <Textarea id={id} {...input} {...aria} />}
    </FieldShell>
  )
}

/** Jalali (Shamsi) date picker — year/month/day selects, emits a Gregorian
 *  `YYYY-MM-DD` string (or '' when incomplete). Used for birth dates, where a
 *  calendar grid is slow to navigate decades back. */
export function JalaliDateField({ label, value, onChange, error, hint, required, className, maxYearsBack = 110 }: {
  label: string; value: string; onChange: (iso: string) => void
  error?: string; hint?: string; required?: boolean; className?: string; maxYearsBack?: number
}) {
  const now = gregorianToJalali(new Date())
  const init = value ? gregorianToJalali(new Date(value)) : null
  const [parts, setParts] = React.useState<{ jy: string; jm: string; jd: string }>({
    jy: init ? String(init.jy) : '', jm: init ? String(init.jm) : '', jd: init ? String(init.jd) : '',
  })
  const set = (k: 'jy' | 'jm' | 'jd', v: string) => {
    const next = { ...parts, [k]: v }
    setParts(next)
    if (next.jy && next.jm && next.jd) {
      const g = jalaliToGregorian(Number(next.jy), Number(next.jm), Number(next.jd))
      onChange(`${g.getFullYear()}-${String(g.getMonth() + 1).padStart(2, '0')}-${String(g.getDate()).padStart(2, '0')}`)
    } else onChange('')
  }
  const years = Array.from({ length: maxYearsBack + 1 }, (_, i) => now.jy - i)
  const days = Array.from({ length: Number(parts.jm) > 6 ? 30 : 31 }, (_, i) => i + 1)
  const sel = 'h-9 rounded-md border border-input bg-background px-2 text-sm'
  return (
    <FieldShell label={label} error={error} hint={hint} required={required} className={className}>
      {(id, aria) => (
        <div className="grid grid-cols-3 gap-2" role="group" aria-labelledby={id}>
          <select id={id} className={sel} value={parts.jd} onChange={(e) => set('jd', e.target.value)} aria-label="روز" {...aria}>
            <option value="">روز</option>
            {days.map((d) => <option key={d} value={d}>{toFaDigits(d)}</option>)}
          </select>
          <select className={sel} value={parts.jm} onChange={(e) => set('jm', e.target.value)} aria-label="ماه">
            <option value="">ماه</option>
            {FA_MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select className={sel} value={parts.jy} onChange={(e) => set('jy', e.target.value)} aria-label="سال">
            <option value="">سال</option>
            {years.map((y) => <option key={y} value={y}>{toFaDigits(y)}</option>)}
          </select>
        </div>
      )}
    </FieldShell>
  )
}
