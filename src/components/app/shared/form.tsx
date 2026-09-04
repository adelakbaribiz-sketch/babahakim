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
