// ── BabaHakim Backend · Authorization Guards (PHASE 08, ED-97) ────────────
// Guards throw typed AppErrors; apiRoute maps them to 401/403 envelopes.
// Semantics are identical to the Phase-05 hardened model:
//   - ADMIN bypasses every permission check (BR-RBAC-02)
//   - patients access only their own resources (ED-77 ownership model)
import { getAuth, AuthContext } from '@/lib/auth'
import { AuthRequiredError, ForbiddenError } from '@/server/core/errors'

/** Throws 401 when unauthenticated. */
export async function requireAuth(): Promise<AuthContext> {
  const auth = await getAuth()
  if (!auth) throw new AuthRequiredError()
  return auth
}

/** Throws 403 unless the caller holds one of the roles. */
export async function requireRole(...roles: string[]): Promise<AuthContext> {
  const auth = await requireAuth()
  if (roles.length && !roles.includes(auth.user.role)) {
    throw new ForbiddenError('دسترسی غیرمجاز | Permission denied')
  }
  return auth
}

/** Throws 403 unless ADMIN or the caller holds the permission (ADMIN bypass, BR-RBAC-02). */
export async function requirePermission(permission: string): Promise<AuthContext> {
  const auth = await requireAuth()
  if (auth.user.role === 'ADMIN') return auth
  if (!auth.permissions.includes(permission)) {
    throw new ForbiddenError('دسترسی غیرمجاز | Permission denied: ' + permission)
  }
  return auth
}

/** Throws 403 when a patient tries to touch another patient's resource. */
export function assertOwnership(auth: AuthContext, ownerId: string, message = 'دسترسی غیرمجاز'): void {
  if (auth.user.role === 'PATIENT' && auth.user.id !== ownerId) {
    throw new ForbiddenError(message)
  }
}
