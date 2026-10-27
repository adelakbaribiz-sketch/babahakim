// API layer (thin controller) — business logic in @/server/application (ED-93).
import { apiRoute, parseBody } from '@/server/api/handler'
import { requireRole } from '@/server/api/guards'
import { caseArchiveSchema } from '@/server/application/dto'
import { archiveCase } from '@/server/application/services/caseService'

// POST /api/v1/cases/[id]/archive {action: ARCHIVE|RESTORE, reason} — ADMIN only;
// archive hides the case from active lists, never deletes data
export const POST = apiRoute<{ id: string }>(async (req, route, env) => {
  const auth = await requireRole('ADMIN')
  const { id } = await route.params
  return archiveCase(auth, env.ctx, id, await parseBody(req, caseArchiveSchema))
})
