// API layer (thin controller) — business logic in @/server/application (ED-93).
import { apiRoute, parseBody } from '@/server/api/handler'
import { requireAuth, requireRole } from '@/server/api/guards'
import { ticketMessageSchema, ticketPatchSchema } from '@/server/application/dto'
import { addTicketMessage, patchTicket } from '@/server/application/services/supportService'

// POST /api/v1/tickets/[id] — add message {message, isInternal}
export const POST = apiRoute<{ id: string }>(async (req, route, env) => {
  const auth = await requireAuth()
  const { id } = await route.params
  const input = await parseBody(req, ticketMessageSchema)
  return addTicketMessage(auth, env.ctx, id, input)
})

// PATCH /api/v1/tickets/[id] — staff: assign / status / priority (TICKET machine)
export const PATCH = apiRoute<{ id: string }>(async (req, route, env) => {
  const auth = await requireRole('ADMIN', 'OPERATOR', 'EXPERT_1', 'EXPERT_2', 'DOCTOR')
  const { id } = await route.params
  const input = await parseBody(req, ticketPatchSchema)
  return patchTicket(auth, env.ctx, id, input)
})
