// API layer (thin controller) — business logic in @/server/application (ED-93).
import { z } from 'zod'
import { apiRoute, parseBody } from '@/server/api/handler'
import { requireAuth } from '@/server/api/guards'
import { revokeConsentFor } from '@/server/application/services/imageService'

const revokeSchema = z.object({ consentType: z.string().min(1).max(40) })

// POST /api/v1/privacy/consents/revoke {consentType} — MARKETING only (ED-67)
export const POST = apiRoute(async (req, _route, env) => {
  const auth = await requireAuth()
  const input = await parseBody(req, revokeSchema)
  return revokeConsentFor(auth, env.ctx, input.consentType)
})
