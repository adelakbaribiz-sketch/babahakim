// API layer (thin controller) — business logic in @/server/application (ED-93).
// GET /api/v1/admin/workflow/overview — machine catalog, SLA/stuck snapshot,
// last governance tick, job-queue health, recent admin recoveries.
import { apiRoute } from '@/server/api/handler'
import { requireRole } from '@/server/api/guards'
import { workflowOverview } from '@/server/application/services/workflowOpsService'

export const GET = apiRoute(async () => {
  await requireRole('ADMIN')
  return workflowOverview()
})
