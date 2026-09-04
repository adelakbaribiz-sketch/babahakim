/**
 * BabaHakim Design Tokens — TypeScript mirror of the CSS runtime tokens
 * ---------------------------------------------------------------------------
 * Single source of truth layout (ED-81):
 *   - RUNTIME  : src/app/globals.css  (--bh-*, --status-*, shadcn semantic vars)
 *   - JS/TS    : src/design-system/tokens.ts (this file — charts, canvas, JS)
 *
 * SYNC RULE (enforced by scripts/ui-audit.mjs → `bun run audit:ui`):
 *   Every hex in `brand`, `brandDerived`, `status`, `semanticLight/Dark` and
 *   `chartPalette` MUST appear verbatim in globals.css. Never drift.
 *
 * Branding Master Prompt: §2-5 (palette), §3 (central tokens), §9 (status),
 * §22 (charts), §23 (typography), §27 (no scattered hardcoding), §39.
 */

// ─── §2 Brand palette (NON-NEGOTIABLE, §39) ────────────────────────────────
export const brand = {
  primaryDark: '#173F76',
  primary: '#225BBE',
  primaryLight: '#57AFE2',
  neutral: '#DEDBDB',
  white: '#FFFFFF',
} as const

export type BrandColor = keyof typeof brand

// ─── §3 Derived shades (ONLY derived from the 4 brand colors) ─────────────
export const brandDerived = {
  primaryHover: '#1D4FA6',
  primaryActive: '#18418A',
  primaryDark90: '#15386A',
  sky15: '#E7F1FA',
  sky25: '#CFE4F5',
  navy08: '#EDF1F7',
  navy15: '#DCE4EF',
  navy30: '#B6C4D8',
  navy60: '#64799A',
  ink: '#0F2A50',
  neutral40: '#F4F3F3',
  neutral60: '#EAE9E9',
  surfaceDark1: '#0D1B30',
  surfaceDark2: '#12233C',
  surfaceDark3: '#1A2E4D',
  surfaceDark4: '#233757',
} as const

// ─── §9 Semantic status palette (solid chips, mode-invariant) ─────────────
export const status = {
  info:     { bg: '#57AFE2', fg: '#122F5C' }, // Pending (§9)
  progress: { bg: '#225BBE', fg: '#FFFFFF' }, // In Progress (§9)
  success:  { bg: '#157347', fg: '#FFFFFF' }, // Completed — derived (§9)
  warning:  { bg: '#B45309', fg: '#FFFFFF' }, // Overdue / awaiting user
  danger:   { bg: '#B91C1C', fg: '#FFFFFF' }, // Error / cancelled (§9)
  neutral:  { bg: '#3F5070', fg: '#FFFFFF' }, // inactive / closed
  navy:     { bg: '#173F76', fg: '#FFFFFF' }, // doctor / proforma / shipped
  revision: { bg: '#6D28D9', fg: '#FFFFFF' }, // revision / re-refer / follow-up
} as const

export type StatusToken = keyof typeof status

/** Status as standalone text on page background (mode-aware, AA both modes). */
export const statusText = {
  info: { light: '#1D6BB5', dark: '#57AFE2' },
  success: { light: '#157347', dark: '#4ADE80' },
  warning: { light: '#B45309', dark: '#E8A94D' },
  danger: { light: '#B91C1C', dark: '#F87171' },
} as const

/** Ready-made Tailwind classes per status token — used by STATUS_META maps. */
export const statusClass: Record<StatusToken, string> = {
  info: 'bg-status-info text-status-info-fg',
  progress: 'bg-status-progress text-status-progress-fg',
  success: 'bg-status-success text-status-success-fg',
  warning: 'bg-status-warning text-status-warning-fg',
  danger: 'bg-status-danger text-status-danger-fg',
  neutral: 'bg-status-neutral text-status-neutral-fg',
  navy: 'bg-status-navy text-status-navy-fg',
  revision: 'bg-status-revision text-status-revision-fg',
}

// ─── shadcn semantic tokens (light / dark) — for docs & JS consumers ──────
export const semanticLight = {
  background: '#FFFFFF',
  foreground: '#0F2A50',
  card: '#FFFFFF',
  primary: '#225BBE',
  primaryForeground: '#FFFFFF',
  secondary: '#E7F1FA',
  secondaryForeground: '#173F76',
  muted: '#F4F3F3',
  mutedForeground: '#5B6F91', // AA 5.09:1 (ED-86)
  accent: '#E7F1FA',
  accentForeground: '#173F76',
  destructive: '#DC2626',
  border: '#DEDBDB',
  input: '#DEDBDB',
  ring: '#225BBE',
} as const

export const semanticDark = {
  background: '#0D1B30',
  foreground: '#E7EEF8',
  card: '#12233C',
  primary: '#57AFE2',
  primaryForeground: '#0F2A50',
  secondary: '#1A2E4D',
  secondaryForeground: '#CFE4F5',
  muted: '#1A2E4D',
  mutedForeground: '#8FA5C2',
  accent: '#233757',
  accentForeground: '#CFE4F5',
  destructive: '#F87171',
  border: 'rgba(222, 219, 219, 0.18)',
  input: 'rgba(222, 219, 219, 0.3)',
  ring: '#57AFE2',
} as const

// ─── §22 Charts ────────────────────────────────────────────────────────────
/** CSS-var references for recharts/SVG (auto theme-aware, preferred). */
export const chartVars = {
  1: 'var(--chart-1)',
  2: 'var(--chart-2)',
  3: 'var(--chart-3)',
  4: 'var(--chart-4)',
  5: 'var(--chart-5)',
  grid: 'var(--border)',
  axis: 'var(--muted-foreground)',
  tooltipBg: 'var(--popover)',
  tooltipFg: 'var(--popover-foreground)',
} as const

/** Light-mode hex fallbacks — ONLY for canvas contexts that cannot use CSS vars. */
export const chartPalette = {
  1: '#225BBE',
  2: '#57AFE2',
  3: '#173F76',
  4: '#9CCBEF',
  5: '#DEDBDB',
} as const

/** §22 recharts defaults — brand palette, minimal, readable. */
export const chartTheme = {
  colors: [chartVars[1], chartVars[2], chartVars[3], chartVars[4], chartVars[5]],
  grid: { stroke: chartVars.grid, strokeDasharray: '4 4', vertical: false },
  axis: { stroke: chartVars.axis, fontSize: 12, tickLine: false, axisLine: false },
  tooltip: { backgroundColor: chartVars.tooltipBg, border: '1px solid ' + chartVars.grid, borderRadius: 8, color: chartVars.tooltipFg, fontSize: 12 },
  fontFamily: 'inherit',
} as const

// ─── §23 Typography (Vazirmatn ramp) ───────────────────────────────────────
export const typography = {
  fontFamily: 'var(--font-sans)',
  monoFamily: 'var(--font-mono)',
  ramp: {
    display: { size: '28px', lineHeight: '36px', weight: 700 }, // text-display
    h1: { size: '24px', lineHeight: '32px', weight: 700 },      // text-2xl font-bold
    h2: { size: '20px', lineHeight: '28px', weight: 700 },      // text-xl font-bold
    h3: { size: '18px', lineHeight: '28px', weight: 600 },      // text-lg font-semibold
    title: { size: '18px', lineHeight: '26px', weight: 600 },   // text-title
    body: { size: '14px', lineHeight: '20px', weight: 400 },    // text-sm
    bodyLg: { size: '16px', lineHeight: '24px', weight: 400 },  // text-base
    caption: { size: '12px', lineHeight: '16px', weight: 400 }, // text-xs
    micro: { size: '11px', lineHeight: '16px', weight: 400 },   // text-caption
  },
} as const

// ─── Spacing (4px base grid — Tailwind scale is the system) ────────────────
export const spacing = {
  unit: 4,
  scale: [0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80] as const,
  card: 16,        // p-4 — compact cards (§21)
  cardLg: 24,      // p-6 — primary content cards
  cardGap: 16,     // gap-4 between cards
  sectionGap: 24,  // gap-6 between page sections
  page: 24,        // main padding (md:p-6)
} as const

// ─── Grid & breakpoints (mobile-first, §29) ────────────────────────────────
export const breakpoints = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const

export const grid = {
  columns: 12,
  gutter: 16,      // gap-4
  contentMax: 1400, // main max-w-[1400px]
  sidebar: 288,     // w-72
  header: 64,       // h-16
} as const

// ─── Radius / shadow / z-index ─────────────────────────────────────────────
export const radius = { sm: 6, md: 8, lg: 10, xl: 14 } as const // px (--radius 0.625rem)
export const shadow = {
  card: 'var(--shadow-card)',
  cardHover: 'var(--shadow-card-hover)',
} as const
export const zIndex = { base: 0, stickyHeader: 40, dropdown: 50, overlay: 50, toast: 60 } as const

// ─── Icon system (lucide-react) ────────────────────────────────────────────
export const iconSize = { xs: 14, sm: 16, md: 18, lg: 24 } as const

// ─── Focus ring (§20/§34) ──────────────────────────────────────────────────
export const focusRing = 'outline-ring/50' // base layer applies globally
