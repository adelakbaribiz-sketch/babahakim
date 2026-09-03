'use client'
// BabaHakim Logo — swappable brand mark (§25 Master Branding).
// All pages must use <Logo /> instead of hardcoding the mark.
import React from 'react'
import { useApp } from '@/contexts/app'

interface LogoProps {
  /** pixel size of the square mark */
  size?: number
  /** 'light' = for dark/navy backgrounds, 'dark' = for white surfaces */
  variant?: 'light' | 'dark'
  /** show wordmark next to the mark */
  showText?: boolean
  /** extra classes for the wordmark */
  textClassName?: string
}

/**
 * Brand mark: rounded square in Primary Dark (#173F76, or Sky #57AFE2 on the
 * light variant) containing a stylized tongue + AI scan-line.
 * To swap the logo project-wide, replace ONLY this component (§25).
 */
export function Logo({ size = 36, variant = 'dark', showText = false, textClassName = '' }: LogoProps) {
  const { t } = useApp()
  const box = variant === 'light' ? '#57AFE2' : '#173F76'
  const tongue = variant === 'light' ? '#173F76' : '#57AFE2'
  const groove = variant === 'light' ? '#57AFE2' : '#173F76'
  const scan = '#FFFFFF'

  return (
    <span className="inline-flex items-center gap-2 select-none" role="img" aria-label="BabaHakim">
      <span
        className="flex items-center justify-center shrink-0 rounded-[28%]"
        style={{ width: size, height: size, backgroundColor: box, boxShadow: '0 2px 8px rgba(23, 63, 118, 0.18)' }}
      >
        <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 100 100" fill="none" aria-hidden="true">
          {/* stylized tongue */}
          <path
            d="M50 14 C68 14 78 28 78 46 C78 70 65 86 50 86 C35 86 22 70 22 46 C22 28 32 14 50 14 Z"
            fill={tongue}
          />
          {/* center groove */}
          <path d="M50 30 C53 42 53 58 50 72" stroke={groove} strokeWidth="4" strokeLinecap="round" opacity="0.5" />
          {/* AI scan line */}
          <line x1="14" y1="40" x2="86" y2="40" stroke={scan} strokeWidth="6" strokeLinecap="round" opacity="0.92" />
        </svg>
      </span>
      {showText && (
        <span className={`font-extrabold leading-none tracking-tight ${textClassName}`} style={{ fontSize: size * 0.42 }}>
          {t('appName')}
        </span>
      )}
    </span>
  )
}
