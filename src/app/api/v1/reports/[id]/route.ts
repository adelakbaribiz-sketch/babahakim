// API layer (thin controller) — business logic in @/server/application (ED-93).
// GET /api/v1/reports/[id]?from=&to=&groupBy=&dataset=&filters={json}
// Runs a registered report: permission-aware + window-clamped + row-capped.
// The zod boundary (ED-96) strips unknown keys; invalid `filters` JSON is
// dropped, not fatal — the engine's own schema decides what is meaningful.
import { apiRoute } from '@/server/api/handler'
import { requireAuth } from '@/server/api/guards'
import { runReportFor } from '@/server/application/services/reportingService'

type P = { id: string }

export const GET = apiRoute<P>(async (req, route, env) => {
  const auth = await requireAuth()
  const { id } = await route.params
  const url = new URL(req.url)

  const params: Record<string, unknown> = {}
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  const groupBy = url.searchParams.get('groupBy')
  const dataset = url.searchParams.get('dataset')
  if (from) params.from = from
  if (to) params.to = to
  if (groupBy) params.groupBy = groupBy
  if (dataset) params.dataset = dataset
  const filtersRaw = url.searchParams.get('filters')
  if (filtersRaw) {
    try {
      const parsed = JSON.parse(filtersRaw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) params.filters = parsed
    } catch {
      // invalid JSON filters are stripped, not fatal
    }
  }
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined))
  return runReportFor(auth, env.ctx, id, clean)
})
