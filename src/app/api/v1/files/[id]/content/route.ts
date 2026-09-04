// API layer (thin controller) — business logic in @/server/application (ED-93).
// GET /api/v1/files/[id]/content?v={version}&variant={original|compressed|ai|thumb}
//    &exp=&sig=            — signed URL (variant+version-bound, ED-112)
//    [&download=1]         — attachment disposition
//    [Range header]        — single-range 206 support
// Authorization: signed URL OR session (classification-aware) OR anonymous
// for PUBLIC renditions (product images) — see mediaFileService (ED-118).
import { apiRoute } from '@/server/api/handler'
import { serveFile } from '@/server/application/services/mediaFileService'

type P = { id: string }

export const GET = apiRoute<P>(async (req, route, env) => {
  const { id } = await route.params
  const url = new URL(req.url)
  return serveFile(env.ctx, id, {
    variant: url.searchParams.get('variant') || 'compressed',
    version: url.searchParams.get('v') || url.searchParams.get('version'),
    exp: url.searchParams.get('exp'),
    sig: url.searchParams.get('sig'),
    download: url.searchParams.get('download') === '1',
    range: req.headers.get('range'),
  })
})
