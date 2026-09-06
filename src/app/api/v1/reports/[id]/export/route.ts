// API layer (thin controller) — business logic in @/server/application (ED-93).
// GET  /api/v1/reports/[id]/export?format=csv|xlsx|pdf&from=&to=&... (sync, ≤ cap)
// POST /api/v1/reports/[id]/export { format, params, lang } (async job → file)
// Both paths: permission-aware, bounded, rate-limited, audited (ED-156).
import { apiRoute, parseBody } from '@/server/api/handler'
import { requireAuth } from '@/server/api/guards'
import { exportReport, parseFormat } from '@/server/application/services/reportingService'
import { z } from 'zod'

type P = { id: string }

export const GET = apiRoute<P>(async (req, route, env) => {
  const auth = await requireAuth()
  const { id } = await route.params
  const url = new URL(req.url)
  const format = parseFormat(url.searchParams.get('format'))
  const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'fa'

  const params: Record<string, unknown> = {}
  for (const key of ['from', 'to', 'groupBy', 'dataset']) {
    const v = url.searchParams.get(key)
    if (v) params[key] = v
  }
  const filtersRaw = url.searchParams.get('filters')
  if (filtersRaw) {
    try {
      const parsed = JSON.parse(filtersRaw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) params.filters = parsed
    } catch { /* stripped */ }
  }
  return exportReport(auth, env.ctx, id, params, format, lang, 'sync')
})

const postSchema = z.object({
  format: z.enum(['csv', 'xlsx', 'pdf']),
  lang: z.enum(['fa', 'en']).optional().default('fa'),
  params: z.record(z.string(), z.unknown()).optional().default({}),
})

export const POST = apiRoute<P>(async (req, route, env) => {
  const auth = await requireAuth()
  const { id } = await route.params
  const input = await parseBody(req, postSchema)
  return exportReport(auth, env.ctx, id, input.params, input.format, input.lang, 'async')
})
