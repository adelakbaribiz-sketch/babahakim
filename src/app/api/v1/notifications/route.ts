// API layer (thin controller) — business logic in @/server/application (ED-93).
import { apiRoute, parseBody } from '@/server/api/handler'
import { requireAuth } from '@/server/api/guards'
import { parseListQuery } from '@/server/api/query'
import { markReadSchema } from '@/server/application/dto'
import { listNotifications, markNotificationsRead } from '@/server/application/services/supportService'

// GET /api/v1/notifications
export const GET = apiRoute(async (req) => {
  const auth = await requireAuth()
  const query = parseListQuery(req.url, { defaultLimit: 50 })
  return listNotifications(auth, query)
})

// PATCH /api/v1/notifications {id?} — mark one/all read
export const PATCH = apiRoute(async (req) => {
  const auth = await requireAuth()
  const input = await parseBody(req, markReadSchema)
  return markNotificationsRead(auth, input)
})
