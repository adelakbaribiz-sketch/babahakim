// API layer (thin controller) — business logic in @/server/application (ED-93).
// GET /api/v1/reports/exports/[fileId] — download an async export artifact.
// Owner-only (or ADMIN); TEMPORARY files expire after 24h (ED-156/157).
import { apiRoute } from '@/server/api/handler'
import { requireAuth } from '@/server/api/guards'
import { downloadExport } from '@/server/application/services/reportingService'

type P = { fileId: string }

export const GET = apiRoute<P>(async (_req, route, env) => {
  const auth = await requireAuth()
  const { fileId } = await route.params
  return downloadExport(auth, env.ctx, fileId)
})
