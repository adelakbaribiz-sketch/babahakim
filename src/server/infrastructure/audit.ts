// ── BabaHakim Backend · Audit writer (moved from lib/api, ED-93) ───────────
// Audit entries are append-only system facts: failures are logged but never
// break the business flow. Sensitive actions (PHASE 05 list) are flagged.
import { db } from '@/lib/db'
import { logger } from '@/server/core/logger'
import type { RequestContext } from '@/server/core/context'

export const SENSITIVE_ACTIONS = [
  'VIEW_MEDICAL_FILE', 'DOWNLOAD_IMAGE', 'VIEW_PATIENT_NATIONAL_ID', 'EDIT_PRESCRIPTION',
  'APPROVE_PRESCRIPTION', 'VERIFY_PAYMENT', 'PRICE_CHANGE', 'LOGIN', 'LOGIN_FAILED',
  'MEDICAL_FILE_ACCESS_DENIED', 'UPLOAD_MAGIC_REJECT', 'DATA_EXPORT',
]

export interface AuditInput {
  userId: string | null
  action: string
  entity: string
  entityId?: string | null
  oldValues?: unknown
  newValues?: unknown
}

export async function writeAudit(ctx: RequestContext, input: AuditInput): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        userId: input.userId, action: input.action, entity: input.entity,
        entityId: input.entityId || null,
        oldValues: input.oldValues !== undefined ? JSON.stringify(input.oldValues) : null,
        newValues: input.newValues !== undefined ? JSON.stringify(input.newValues) : null,
        ip: ctx.ip, device: ctx.device,
        sensitive: SENSITIVE_ACTIONS.includes(input.action),
      },
    })
  } catch (e) {
    logger.error('audit write failed', { reqId: ctx.reqId, action: input.action, error: e instanceof Error ? e.message : String(e) })
  }
}

/**
 * Transport-neutral shim for the Phase-02 workflow engine (executeTransition
 * captures IP/device via `req.headers.get`). Application services pass this
 * instead of a NextRequest — the transport object never crosses layers.
 */
export function toAuditReq(ctx: RequestContext) {
  return {
    headers: {
      get(k: string): string | null {
        if (k === 'x-forwarded-for' || k === 'x-real-ip') return ctx.ip
        if (k === 'user-agent') return ctx.device
        return null
      },
    },
  }
}
