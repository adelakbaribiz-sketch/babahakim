// BabaHakim Workflow — PURE, CLIENT-SAFE resolver layer (PHASE 09, F03 → ED-107).
//
// Why this module exists: the browser bundle used to reach `@/lib/db` (Prisma)
// via AppShell → constants → engine → db. Extracting the pure functions here
// lets the client (route guards, CaseWorkspace action availability, tests)
// resolve transitions WITHOUT importing any server-only module.
//
// RULES (enforced by scripts/frontend-audit.mjs E3):
//  - NEVER import from '@/lib/db', '@/server/**', 'next/server' here.
//  - Everything must stay a pure function over machine data.
import { ROLE_PERMISSIONS } from '@/lib/constants'
import {
  MachineDef, TransitionDef, WorkflowActor, WorkflowRole,
  WorkflowError, EntityRow,
} from './types'

/**
 * Find the legal transition for (status, action, role).
 * ADMIN passes any role guard (BR-RBAC-02); SYSTEM passes only
 * transitions explicitly marked `system`.
 */
export function resolveTransition(
  machine: MachineDef,
  status: string,
  action: string,
  role: WorkflowRole,
): TransitionDef | null {
  for (const t of machine.transitions) {
    if (t.action !== action) continue
    if (!t.from.includes(status)) continue
    if (role === 'ADMIN') return t
    if (role === 'SYSTEM') {
      if (t.system) return t
      continue
    }
    if (t.roles.includes(role)) return t
  }
  return null
}

/** Does the actor hold the permission required by this transition? */
export function hasPermission(role: WorkflowRole, permission?: string): boolean {
  if (!permission) return true
  if (role === 'ADMIN') return true
  if (role === 'SYSTEM') return true // system transitions are pre-authorized
  const perms = ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS] || []
  return (perms as readonly string[]).includes(permission)
}

/** Ownership guard for patient-facing transitions (BR-RBAC-03). */
export function ownsEntity(
  machine: MachineDef,
  row: EntityRow,
  actor: WorkflowActor,
): boolean {
  if (actor.role !== 'PATIENT') return true
  if (!machine.ownerField) return false // patient + no owner field → deny
  return row[machine.ownerField] === actor.id
}

/** All guard checks — throws WorkflowError on rejection. */
export function assertGuards(
  machine: MachineDef,
  row: EntityRow,
  action: string,
  actor: WorkflowActor,
): TransitionDef {
  const t = resolveTransition(machine, row.status, action, actor.role)
  if (!t) {
    const known = machine.transitions.some((x) => x.action === action)
    throw new WorkflowError(
      'INVALID_TRANSITION',
      known
        ? `اقدام «${action}» از وضعیت «${row.status}» یا نقش «${actor.role}» مجاز نیست | Invalid transition`
        : `اقدام «${action}» در این گردش کار تعریف نشده است | Unknown action`,
      409,
      { status: row.status },
    )
  }
  if (!hasPermission(actor.role, t.permission)) {
    throw new WorkflowError(
      'FORBIDDEN_PERMISSION',
      'دسترسی لازم را ندارید | Permission denied',
      403,
      { required: t.permission },
    )
  }
  if (t.requireOwnership || actor.role === 'PATIENT') {
    if (!ownsEntity(machine, row, actor)) {
      throw new WorkflowError(
        'NOT_OWNER',
        'شما فقط به رکوردهای خودتان دسترسی دارید | Not your record',
        403,
      )
    }
  }
  return t
}

/** Statuses reachable from a given status (graph helper for tests/docs). */
export function reachableFrom(machine: MachineDef, status: string): string[] {
  const out = new Set<string>()
  for (const t of machine.transitions) {
    if (t.from.includes(status)) out.add(t.to)
  }
  return [...out]
}

/** Statuses with no outgoing transitions (terminal states). */
export function terminalStatuses(machine: MachineDef): string[] {
  return machine.statuses.filter((s) => reachableFrom(machine, s).length === 0)
}
