// API layer (thin controller) — business logic in @/server/application (ED-93).
import { apiRoute, parseBody } from '@/server/api/handler'
import { requireRole } from '@/server/api/guards'
import { vocabularyCreateSchema, vocabularyPatchSchema } from '@/server/application/dto'
import { listVocabulary, createVocabulary, patchVocabulary } from '@/server/application/services/vocabularyService'

// GET /api/v1/admin/vocabulary?kind= — all presets incl. inactive (ADMIN)
export const GET = apiRoute(async (req) => {
  await requireRole('ADMIN')
  return listVocabulary(new URL(req.url).searchParams.get('kind'), true)
})

// POST /api/v1/admin/vocabulary {kind, valueFa, valueEn?, order?}
export const POST = apiRoute(async (req, _route, env) => {
  const auth = await requireRole('ADMIN')
  return createVocabulary(auth, env.ctx, await parseBody(req, vocabularyCreateSchema))
})

// PATCH /api/v1/admin/vocabulary {id, valueFa?, valueEn?, order?, active?} — deactivate instead of delete
export const PATCH = apiRoute(async (req, _route, env) => {
  const auth = await requireRole('ADMIN')
  return patchVocabulary(auth, env.ctx, await parseBody(req, vocabularyPatchSchema))
})
