// API layer (thin controller) — business logic in @/server/application (ED-93).
// POST /api/v1/admin/workflow/recover — ADMIN force-recovery of a stuck
// workflow instance (engine escape hatch, BR-WF-07). All guards live in the
// ENGINE (role check, reason validation, status legality, audit, notify);
// this route only authenticates, validates input shape (zod) and delegates.
// Rate limiting lives in the service (ED-105 import discipline).
import { apiRoute, parseBody } from '@/server/api/handler'
import { requirePermission } from '@/server/api/guards'
import { workflowRecoverSchema } from '@/server/application/dto'
import { adminWorkflowRecover } from '@/server/application/services/workflowOpsService'

// POST /api/v1/admin/workflow/recover {entityType, entityId, targetStatus, reason}
export const POST = apiRoute(async (req, _route, env) => {
  const auth = await requirePermission('manage_workflow_recovery')
  const input = await parseBody(req, workflowRecoverSchema)
  return adminWorkflowRecover(auth, env.ctx, input)
})
