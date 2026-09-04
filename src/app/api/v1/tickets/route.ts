// API layer (thin controller) — business logic in @/server/application (ED-93).
import { apiRoute, parseBody } from '@/server/api/handler'
import { requireAuth, requireRole } from '@/server/api/guards'
import { parseListQuery } from '@/server/api/query'
import { ticketCreateSchema } from '@/server/application/dto'
import { listTickets, createTicket } from '@/server/application/services/supportService'

// GET /api/v1/tickets
export const GET = apiRoute(async (req) => {
  const auth = await requireAuth()
  const query = parseListQuery(req.url, { defaultLimit: 100, sortable: ['createdAt', 'updatedAt'] })
  return listTickets(auth, query)
})

// POST /api/v1/tickets — patient creates ticket {subject, category, priority, message, caseId?}
export const POST = apiRoute(async (req, _route, env) => {
  const auth = await requireRole('PATIENT')
  const input = await parseBody(req, ticketCreateSchema)
  return createTicket(auth, env.ctx, input)
})
