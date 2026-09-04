// ── BabaHakim Route Registry (PHASE 09, ED-112) ────────────────────────────
// Single source of truth for VIEW-level authorization in the SPA:
//  - the router gates rendering (page.tsx) → 403 view instead of admin UI
//  - the sidebar filters nav items (AppShell) → hidden when not allowed
//  - permission checks mirror the server RBAC matrix (constants.ts) — the
//    server /api guard remains authoritative; this is UX + defense-in-depth.
//
// ED-77: patient pages are ownership-based (server scopes data per user);
// staff pages map 1:1 to the 31-permission catalogue.
import { Role } from '@/lib/constants'

export interface RouteDef {
  /** required permission (ADMIN always passes — BR-RBAC-02 semantics) */
  permission?: string
  /** restrict to specific roles (e.g. patient-only pages) */
  roles?: Role[]
  /** allowed if ANY of these roles/permissions match (patient-or-staff pages) */
  anyOf?: { roles?: Role[]; permissions?: string[] }
  /** viewable without a session */
  public?: boolean
}

export const ROUTES: Record<string, RouteDef> = {
  // public
  landing: { public: true },
  login: { public: true },
  register: { public: true },
  designSystem: { public: true },
  // patient area (ownership-scoped server-side, ED-77)
  dashboard: {},
  profile: { roles: ['PATIENT'] },
  questionnaire: { roles: ['PATIENT'] },
  newCase: { roles: ['PATIENT'] },
  cases: { roles: ['PATIENT'] },
  caseDetail: {}, // patient sees own case (server ownership), staff via view_all_cases
  shop: { roles: ['PATIENT'] },
  cart: { roles: ['PATIENT'] },
  orders: { anyOf: { roles: ['PATIENT'], permissions: ['manage_orders'] } },
  tickets: {}, // patient own tickets / staff manage_tickets
  followups: { anyOf: { roles: ['PATIENT'], permissions: ['manage_followups'] } },
  notifications: {},
  // staff area — mirrors the permission catalogue
  queue: { permission: 'view_queue' },
  payments: { permission: 'verify_payment' },
  shipments: { permission: 'manage_shipments' },
  // admin area
  users: { permission: 'manage_users' },
  diseases: { permission: 'manage_diseases' },
  products: { permission: 'manage_products' },
  prices: { permission: 'manage_prices' },
  reports: { permission: 'view_reports' },
  auditLogs: { permission: 'view_audit_logs' },
  questionnaireEditor: { permission: 'manage_questionnaire' },
  aiModels: { permission: 'manage_ai_models' },
  smsLog: { permission: 'view_sms_log' },
  // PHASE 13: integration health console (ADMIN-area view; route gate maps
  // to manage_users-equivalent admin surface, ADMIN passes via BR-RBAC-02)
  integrations: { permission: 'view_audit_logs' },
}

/** Landing view per role (role defaults, single source — fixes F01/F24). */
export function roleHome(role: string): string {
  return 'dashboard' // all roles land on their (role-aware) dashboard
}

/** Can this user open this view? (router gate + nav filter — one function) */
export function canViewRoute(page: string, user: { role: string } | null, permissions: string[]): boolean {
  const def = ROUTES[page]
  if (!def) return false // unknown page → router shows 404
  if (def.public) return true
  if (!user) return false
  const role = user.role
  if (role === 'ADMIN') return true // BR-RBAC-02
  const hasPerm = (p?: string) => !p || permissions.includes(p)
  if (def.permission && !hasPerm(def.permission)) return false
  if (def.roles && !def.roles.includes(role as Role)) return false
  if (def.anyOf) {
    const okRole = def.anyOf.roles?.includes(role as Role) ?? false
    const okPerm = def.anyOf.permissions?.some((p) => permissions.includes(p)) ?? false
    if (!okRole && !okPerm) return false
  }
  return true
}
