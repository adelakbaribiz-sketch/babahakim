// API layer (thin controller) — business logic in @/server/application (ED-93).
import { apiRoute } from '@/server/api/handler'
import { requireAuth } from '@/server/api/guards'
import { getProductWithHistory } from '@/server/application/services/catalogService'

// GET /api/v1/products/[id] — detail + price history (10 latest, never destroyed)
export const GET = apiRoute<{ id: string }>(async (req, route) => {
  await requireAuth()
  const { id } = await route.params
  return getProductWithHistory(id)
})
