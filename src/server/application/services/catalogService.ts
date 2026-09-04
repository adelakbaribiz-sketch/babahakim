// ── BabaHakim Backend · Application Service: Catalog + Cart (PHASE 08) ────
// Product listing now: permission-gated (audit A12 fix), cached (ED-98),
// paginated (ED-100), DB-level category/brand filtering. Cart operations
// are stock-guarded.
import { db } from '@/lib/db'
import type { AuthContext } from '@/lib/auth'
import { signImageUrl } from '@/lib/auth'
import { textMatches } from '@/lib/api'
import { NotFoundError, ValidationError } from '@/server/core/errors'
import { cached, cacheKeys, cacheTtl } from '@/server/infrastructure/cache'
import { listMeta } from '@/server/api/envelope'
import { computeTotals } from '@/server/domain/policies' // PHASE 09 (S2): server-side cart totals
import type { ListQuery } from '@/server/api/query'
import type { cartAddSchema, cartPatchSchema } from '@/server/application/dto'
import type { z } from 'zod'

// ── PRODUCT LIST (cached + paginated) ─────────────────────────────────────
export async function listProducts(query: ListQuery, category: string, otc: string, brand: string) {
  const otcFilter = otc === 'true' ? 'otc' : otc === 'false' ? 'rx' : 'all'
  const cacheKey = cacheKeys.products(`cat:${category || 'all'}|brand:${brand || 'all'}|otc:${otcFilter}|sort:${query.sort}:${query.order}`)

  const data = await cached(cacheKey, cacheTtl.catalog, async () => {
    const products = await db.product.findMany({
      where: { active: true, deletedAt: null, ...(category ? { category } : {}), ...(brand ? { brand } : {}) },
      orderBy: { [query.sort === 'nameFa' ? 'nameFa' : 'createdAt']: query.order },
    })
    return products
  })

  let filtered = data
  if (query.q) filtered = filtered.filter((p) => textMatches(query.q, p.nameFa, p.nameEn, p.brand, p.category, p.sku))
  if (otcFilter === 'otc') filtered = filtered.filter((p) => !p.requiresPrescription)
  if (otcFilter === 'rx') filtered = filtered.filter((p) => p.requiresPrescription)

  const pageRows = filtered.slice(query.offset, query.offset + query.limit)
  const categories = [...new Set(data.map((p) => p.category).filter(Boolean))]
  const brands = [...new Set(data.map((p) => p.brand).filter(Boolean))]

  return {
    products: pageRows.map((p) => ({
      id: p.id, sku: p.sku, nameFa: p.nameFa, nameEn: p.nameEn, brand: p.brand, category: p.category,
      descriptionFa: p.descriptionFa, descriptionEn: p.descriptionEn,
      price: p.currentPrice, stock: p.stock, requiresPrescription: p.requiresPrescription,
      usageFa: p.usageFa, image: p.imagePath ? signImageUrl(p.id) : null,
    })),
    categories, brands,
    ...listMeta(query.page, query.limit, filtered.length),
  }
}

// ── PRODUCT DETAIL ────────────────────────────────────────────────────────
export async function getProduct(id: string) {
  const p = await db.product.findUnique({ where: { id } })
  if (!p || !p.active || p.deletedAt) throw new NotFoundError('محصول یافت نشد')
  return {
    product: {
      id: p.id, sku: p.sku, nameFa: p.nameFa, nameEn: p.nameEn, brand: p.brand, category: p.category,
      descriptionFa: p.descriptionFa, descriptionEn: p.descriptionEn, usageFa: p.usageFa,
      price: p.currentPrice, stock: p.stock, requiresPrescription: p.requiresPrescription,
      image: p.imagePath ? signImageUrl(p.id) : null,
    },
  }
}

/** Detail + price history (10 latest; history rows are never destroyed). */
export async function getProductWithHistory(id: string) {
  const p = await db.product.findUnique({ where: { id } })
  if (!p || p.deletedAt) throw new NotFoundError('محصول یافت نشد')
  const history = await db.productPriceHistory.findMany({ where: { productId: id }, orderBy: { createdAt: 'desc' }, take: 10 })
  return { product: { ...p, image: p.imagePath ? signImageUrl(p.id) : null }, priceHistory: history }
}

// ── CART ──────────────────────────────────────────────────────────────────
export async function getCart(userId: string) {
  const items = await db.cartItem.findMany({ where: { userId }, include: { product: true } })
  const subtotal = items.reduce((s, i) => s + i.product.currentPrice * i.quantity, 0)
  // PHASE 09 (S2/F15): totals from the domain policy — single source of truth.
  // The client renders these fields read-only; it never computes money (ED-110).
  const { shippingCost, total } = computeTotals(items.map((i) => ({ unitPrice: i.product.currentPrice, quantity: i.quantity })))
  return {
    items: items.map((i) => ({
      id: i.id, productId: i.product.id, nameFa: i.product.nameFa, nameEn: i.product.nameEn,
      price: i.product.currentPrice, quantity: i.quantity, stock: i.product.stock,
      requiresPrescription: i.product.requiresPrescription,
      lineTotal: i.product.currentPrice * i.quantity,
    })),
    subtotal, shippingCost, total, count: items.reduce((s, i) => s + i.quantity, 0),
  }
}

export async function addToCart(userId: string, input: z.infer<typeof cartAddSchema>) {
  const product = await db.product.findUnique({ where: { id: input.productId } })
  if (!product || !product.active) throw new NotFoundError('محصول یافت نشد')
  if (product.stock < input.quantity) throw new ValidationError('موجودی کافی نیست')
  const existing = await db.cartItem.findUnique({ where: { userId_productId: { userId, productId: input.productId } } })
  if (existing) {
    const newQty = existing.quantity + input.quantity
    if (product.stock < newQty) throw new ValidationError('موجودی کافی نیست')
    await db.cartItem.update({ where: { id: existing.id }, data: { quantity: newQty } })
  } else {
    await db.cartItem.create({ data: { userId, productId: input.productId, quantity: input.quantity } })
  }
  return { ok: true }
}

export async function updateCartItem(userId: string, input: z.infer<typeof cartPatchSchema>) {
  const item = await db.cartItem.findUnique({ where: { id: input.itemId }, include: { product: true } })
  if (!item || item.userId !== userId) throw new NotFoundError('قلم سبد یافت نشد')
  if (input.quantity <= 0) {
    await db.cartItem.delete({ where: { id: item.id } })
    return { ok: true }
  }
  if (item.product.stock < input.quantity) throw new ValidationError('موجودی کافی نیست')
  await db.cartItem.update({ where: { id: item.id }, data: { quantity: input.quantity } })
  return { ok: true }
}

export async function removeCartItem(userId: string, itemId: string) {
  const item = await db.cartItem.findUnique({ where: { id: itemId } })
  if (!item || item.userId !== userId) throw new NotFoundError('قلم سبد یافت نشد')
  await db.cartItem.delete({ where: { id: itemId } })
  return { ok: true }
}
