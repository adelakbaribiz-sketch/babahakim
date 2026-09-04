// API layer (thin controller) — business logic in @/server/application (ED-93).
import { apiRoute } from '@/server/api/handler'
import { serveImageFile } from '@/server/application/services/imageService'

// GET /api/v1/images/[id]/file?variant=thumb|compressed|original|ai&exp=&sig=
// Signed URL (short-lived HMAC) OR session with explicit view permission (ED-66).
export const GET = apiRoute<{ id: string }>(async (req, route, env) => {
  const { id } = await route.params
  const url = new URL(req.url)
  return serveImageFile(
    env.ctx, id,
    url.searchParams.get('variant') || 'compressed',
    url.searchParams.get('exp') || '',
    url.searchParams.get('sig') || '',
  )
})
