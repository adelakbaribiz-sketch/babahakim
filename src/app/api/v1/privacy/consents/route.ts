// API layer (thin controller) — business logic in @/server/application (ED-93).
import { z } from 'zod'
import { apiRoute, parseBody } from '@/server/api/handler'
import { requireAuth } from '@/server/api/guards'
import { listConsents, grantConsent } from '@/server/application/services/imageService'

const consentSchema = z.object({ consentType: z.string().min(1).max(40) })

// GET /api/v1/privacy/consents — my consent ledger + current document versions
export const GET = apiRoute(async () => {
  const auth = await requireAuth()
  return listConsents(auth.user.id)
})

// POST /api/v1/privacy/consents {consentType} — accept terms/privacy/...
export const POST = apiRoute(async (req, _route, env) => {
  const auth = await requireAuth()
  const input = await parseBody(req, consentSchema)
  return grantConsent(auth, env.ctx, input.consentType)
})
