// API layer (thin controller) — business logic in @/server/application (ED-93).
// POST /api/v1/admin/workflow/scan — run one governance tick on demand
// (backfill + drift reconcile + SLA ladder). Bodyless by design: the
// recurring job already ticks every 2 minutes; manual scans are on-call
// triggers. Rate limiting lives in the service (ED-105 import discipline).
import { apiRoute } from '@/server/api/handler'
import { requirePermission } from '@/server/api/guards'
import { triggerGovernanceScan } from '@/server/application/services/workflowOpsService'

export const POST = apiRoute(async () => {
  const auth = await requirePermission('manage_workflow_recovery')
  return triggerGovernanceScan({ user: { id: auth.user.id } })
})
