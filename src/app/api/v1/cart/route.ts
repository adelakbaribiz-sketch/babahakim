// API layer (thin controller) — business logic in @/server/application (ED-93).
import { apiRoute, parseBody } from '@/server/api/handler'
import { requireAuth } from '@/server/api/guards'
import { cartAddSchema, cartPatchSchema } from '@/server/application/dto'
import { getCart, addToCart, updateCartItem, removeCartItem } from '@/server/application/services/catalogService'

// GET /api/v1/cart
export const GET = apiRoute(async () => {
  const auth = await requireAuth()
  return getCart(auth.user.id)
})

// POST /api/v1/cart {productId, quantity}
export const POST = apiRoute(async (req) => {
  const auth = await requireAuth()
  const input = await parseBody(req, cartAddSchema)
  return addToCart(auth.user.id, input)
})

// PATCH /api/v1/cart {itemId, quantity}
export const PATCH = apiRoute(async (req) => {
  const auth = await requireAuth()
  const input = await parseBody(req, cartPatchSchema)
  return updateCartItem(auth.user.id, input)
})

// DELETE /api/v1/cart?itemId=
export const DELETE = apiRoute(async (req) => {
  const auth = await requireAuth()
  const itemId = new URL(req.url).searchParams.get('itemId') || ''
  return removeCartItem(auth.user.id, itemId)
})
