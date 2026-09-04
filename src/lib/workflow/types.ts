// BabaHakim Workflow Engine — Type System
// Generic, data-driven state machines for all workflow entities.
// Design (ED-31): machines are declarative data + injectable hooks.
// Adding a new machine = adding a definition file + registry entry —
// the engine itself never changes. See docs/WORKFLOW.md.
import type { Role, Permission } from '@/lib/constants'

/** Workflow entity identifiers (one per state machine). */
export type EntityType =
  | 'CASE'
  | 'PRESCRIPTION'
  | 'ORDER'
  | 'PAYMENT'
  | 'SHIPMENT'
  | 'TICKET'
  | 'FOLLOWUP'
  | 'AI_REVIEW'

/** Actors may be a platform role or the SYSTEM (gateway / scheduler). */
export type WorkflowRole = Role | 'SYSTEM'

export interface WorkflowActor {
  id: string
  role: WorkflowRole
}

/** Error codes surfaced to API routes with a matching HTTP status. */
export type WorkflowErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_TRANSITION'
  | 'FORBIDDEN_ROLE'
  | 'FORBIDDEN_PERMISSION'
  | 'NOT_OWNER'
  | 'VALIDATION'
  | 'SIDE_EFFECT'

export class WorkflowError extends Error {
  constructor(
    public code: WorkflowErrorCode,
    message: string,
    public httpStatus: number,
    public details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'WorkflowError'
  }
}

/** Row-agnostic entity representation (loaded via per-entity adapter). */
export type EntityRow = Record<string, unknown> & { id: string; status: string }

/* ── Hook contexts ──────────────────────────────────────────────────── */

/** Shared hook context — intentionally DB-free so unit tests stay pure. */
export interface BaseHookCtx {
  entity: EntityRow
  actor: WorkflowActor
  payload: Record<string, unknown>
  transition: TransitionDef
  machine: MachineDef
  now: Date
}

/** validate(): runs BEFORE any write; throw WorkflowError('VALIDATION') to reject. */
export type ValidateHook = (ctx: BaseHookCtx) => void | Promise<void>

/** dataEffects(): pure field updates merged into the single status update. */
export type DataEffectsHook = (ctx: BaseHookCtx) => Record<string, unknown>

/**
 * txEffects(): additional DB writes executed INSIDE the same transaction
 * (cross-entity cascades, financial records, event rows).
 * Receives the Prisma transaction client.
 */
export type TxEffectsHook = (ctx: BaseHookCtx & { tx: TxClient }) => Promise<void> | void

/**
 * postCommit(): non-critical work AFTER commit (notifications, SMS).
 * Failures are captured and logged — never surfaced to the caller (ED-17).
 */
export type PostCommitHook = (ctx: BaseHookCtx & { db: DbClient }) => Promise<void> | void

/* ── Transition definition (declarative) ─────────────────────────────── */

export interface TransitionDef {
  /** Action name as called from API routes. */
  action: string
  /** Source statuses this action is legal from. */
  from: readonly string[]
  /** Target status. */
  to: string
  /** Roles allowed to fire (ADMIN always passes — BR-RBAC-02). */
  roles: readonly WorkflowRole[]
  /** Required permission (ADMIN exempt — BR-RBAC-01). */
  permission?: Permission
  /** Patient may fire only on their own records (BR-RBAC-03). */
  requireOwnership?: boolean
  /** Callable by SYSTEM actor (gateway callback / scheduler). */
  system?: boolean
  /** Persian description recorded in the event log. */
  descFa: string
  /** Human-readable validation summary. */
  validate?: ValidateHook
  /** Pure field updates applied with the status change. */
  dataEffects?: DataEffectsHook
  /** Transactional side-effects (cascades). */
  txEffects?: TxEffectsHook
  /** Post-commit side-effects (notifications). */
  postCommit?: PostCommitHook
  /** Audit action name; defaults to `WORKFLOW_<ENTITY>_<ACTION>`. */
  auditAction?: string
}

export interface MachineDef {
  entity: EntityType
  /** Prisma delegate key (e.g. 'medicalCase', 'aIAnalysis'). */
  prismaKey: string
  /** Field holding the owner id for the ownership guard, if any. */
  ownerField?: string
  /** Canonical status catalog (documentation + tests). */
  statuses: readonly string[]
  /** Initial status for newly created rows. */
  initial: string
  transitions: readonly TransitionDef[]
}

/* ── Prisma structural types (engine + hooks) ───────────────────────── */

export type TxClient = any
export type DbClient = any

/* ── Execution result (discriminated union for routes) ──────────────── */

export type ExecResult =
  | {
      ok: true
      entity: { id: string; status: string }
      transition: { action: string; from: string; to: string }
      /** Extra data hooks may stash for the route response. */
      extra?: Record<string, unknown>
    }
  | {
      ok: false
      code: WorkflowErrorCode
      error: string
      httpStatus: number
      details?: Record<string, unknown>
    }

/** Prisma event row shape shared by CaseEvent writers. */
export interface EventLogInput {
  entityId: string
  actorId: string | null
  action: string
  fromStatus: string
  toStatus: string
  comment?: string | null
  reason?: string | null
  payload?: Record<string, unknown>
}
