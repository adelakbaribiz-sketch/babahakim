import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { getAuth } from '@/lib/auth'

// GET /api/v1/cart
export async function GET(req: NextRequest) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  const items = await db.cartItem.findMany({ where: { userId: auth.user.id }, include: { product: true } })
  const subtotal = items.reduce((s, i) => s + i.product.currentPrice * i.quantity, 0)
  return ok({
    items: items.map((i) => ({
      id: i.id, productId: i.product.id, nameFa: i.product.nameFa, nameEn: i.product.nameEn,
      price: i.product.currentPrice, quantity: i.quantity, stock: i.product.stock,
      requiresPrescription: i.product.requiresPrescription,
      lineTotal: i.product.currentPrice * i.quantity,
    })),
    subtotal, count: items.reduce((s, i) => s + i.quantity, 0),
  })
}

// POST /api/v1/cart {productId, quantity}
export async function POST(req: NextRequest) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  const body = await req.json().catch(() => ({}))
  const productId = String(body.productId || '')
  const qty = Math.max(1, Number(body.quantity || 1))
  const product = await db.product.findUnique({ where: { id: productId } })
  if (!product || !product.active) return fail('محصول یافت نشد', 404)
  if (product.stock < qty) return fail('موجودی کافی نیست')
  const existing = await db.cartItem.findUnique({ where: { userId_productId: { userId: auth.user.id, productId } } })
  if (existing) {
    await db.cartItem.update({ where: { id: existing.id }, data: { quantity: existing.quantity + qty } })
  } else {
    await db.cartItem.create({ data: { userId: auth.user.id, productId, quantity: qty } })
  }
  return ok()
}

// PATCH /api/v1/cart {itemId, quantity}
export async function PATCH(req: NextRequest) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  const body = await req.json().catch(() => ({}))
  const item = await db.cartItem.findUnique({ where: { id: String(body.itemId || '') }, include: { product: true } })
  if (!item || item.userId !== auth.user.id) return fail('قلم سبد یافت نشد', 404)
  const qty = Number(body.quantity)
  if (qty <= 0) {
    await db.cartItem.delete({ where: { id: item.id } })
  } else {
    if (item.product.stock < qty) return fail('موجودی کافی نیست')
    await db.cartItem.update({ where: { id: item.id }, data: { quantity: qty } })
  }
  return ok()
}

// DELETE /api/v1/cart?itemId=
export async function DELETE(req: NextRequest) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  const itemId = new URL(req.url).searchParams.get('itemId') || ''
  const item = await db.cartItem.findUnique({ where: { id: itemId } })
  if (!item || item.userId !== auth.user.id) return fail('قلم سبد یافت نشد', 404)
  await db.cartItem.delete({ where: { id: itemId } })
  return ok()
}
