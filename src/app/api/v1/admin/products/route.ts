// API layer (thin controller) — business logic in @/server/application (ED-93).
import { apiRoute, parseBody } from '@/server/api/handler'
import { requireRole } from '@/server/api/guards'
import { productSchema, looseIdSchema } from '@/server/application/dto'
import { listAdminProducts, createProduct, patchProduct } from '@/server/application/services/adminService'

// GET /api/v1/admin/products — management list w/ price history
export const GET = apiRoute(async () => {
  await requireRole('ADMIN', 'OPERATOR', 'EXPERT_2')
  return listAdminProducts()
})

// POST /api/v1/admin/products — create product (+ initial price history row)
export const POST = apiRoute(async (req, _route, env) => {
  const auth = await requireRole('ADMIN', 'OPERATOR')
  const input = await parseBody(req, productSchema)
  return createProduct(auth, env.ctx, input)
})

// PATCH /api/v1/admin/products — update stock/active/price (price → history)
export const PATCH = apiRoute(async (req, _route, env) => {
  const auth = await requireRole('ADMIN', 'OPERATOR')
  const input = await parseBody(req, looseIdSchema)
  return patchProduct(auth, env.ctx, input as Record<string, unknown>)
})
