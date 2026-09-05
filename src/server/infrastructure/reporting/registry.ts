// ── Reporting Engine · Registry (PHASE 14, ED-154) ─────────────────────────
// Single source of truth for every report. Routes NEVER aggregate inline —
// gate SR2 enforces it. The catalog is permission-aware per the phase
// command: «گزارش‌ها باید Permission-aware باشند».
import type { AuthContext } from '@/lib/auth'
import type { ReportDef, ReportCategory, ReportResult } from './types'
import { operationalReports } from './reports/operational'
import { financialReports } from './reports/financial'
import { businessReports } from './reports/business'
import { userReports } from './reports/user'
import { performanceReports } from './reports/performance'
import { customReports, DATASET_PERMISSIONS } from './reports/custom'

const ALL: ReportDef[] = [
  ...operationalReports, ...financialReports, ...businessReports,
  ...userReports, ...performanceReports, ...customReports,
]

const BY_ID = new Map(ALL.map((r) => [r.id, r]))

/** every registered permission must exist in the 31-entry catalogue (gate SR9) */
export function reportPermissionsUsed(): string[] {
  return [...new Set(ALL.flatMap((r) => [r.permission, ...Object.values(DATASET_PERMISSIONS)]))]
}

export function getReportDef(id: string): ReportDef | undefined {
  return BY_ID.get(id)
}

export function allReportDefs(): readonly ReportDef[] {
  return ALL
}

/** permission + role check (ADMIN bypass per BR-RBAC-02). */
export function canViewReport(auth: AuthContext, def: ReportDef): boolean {
  if (auth.user.role === 'ADMIN') return true
  if (def.roles && !def.roles.includes(auth.user.role)) return false
  return auth.permissions.includes(def.permission)
}

/** permission-aware catalog entry (no run functions cross the wire). */
export interface ReportCatalogEntry {
  id: string
  category: ReportCategory
  fa: string
  en: string
  descFa: string
  descEn: string
  permission: string
  timeScoped: boolean
  hasChart: boolean
  defaultGroupBy?: string
}

export function reportCatalogFor(auth: AuthContext): ReportCatalogEntry[] {
  return ALL.filter((r) => canViewReport(auth, r)).map((r) => ({
    id: r.id, category: r.category, fa: r.fa, en: r.en,
    descFa: r.descFa, descEn: r.descEn, permission: r.permission,
    timeScoped: r.timeScoped, hasChart: r.hasChart, defaultGroupBy: r.defaultGroupBy,
  }))
}

export type { ReportDef, ReportResult }
