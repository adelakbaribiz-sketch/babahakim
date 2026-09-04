'use client'
// PHASE 07 — direction-aware Sonner toaster (ED-89: sonner = canonical toast).
// Rendered INSIDE AppProvider so it follows lang/dir + theme tokens.
import { useTheme } from 'next-themes'
import { Toaster as Sonner } from 'sonner'
import { useApp } from '@/contexts/app'

export function AppToaster() {
  const { lang, dir } = useApp()
  const { resolvedTheme } = useTheme()
  const theme = (resolvedTheme === 'dark' ? 'dark' : 'light') as 'dark' | 'light'

  return (
    <Sonner
      theme={theme}
      dir={dir}
      position={lang === 'fa' ? 'bottom-center' : 'bottom-center'}
      closeButton
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          fontFamily: 'var(--font-sans)',
        } as React.CSSProperties
      }
      toastOptions={{
        style: {
          background: 'var(--popover)',
          color: 'var(--popover-foreground)',
          border: '1px solid var(--border)',
          direction: dir,
        },
      }}
    />
  )
}
