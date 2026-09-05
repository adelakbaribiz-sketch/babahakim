// ── BabaHakim Backend · Application Service: Catalog + Cart (PHASE 08) ────
// Product listing now: permission-gated (audit A12 fix), cached (ED-98),
// paginated (ED-100), DB-level category/brand filtering. Cart operations
// are stock-guarded.
import { db } from '@/lib/db'
import type { AuthContext } from '@/lib/auth'
import { NotFoundError, ValidationError } from '@/server/core/errors'
import { cached, cacheKeys, cacheTtl } from '@/server/infrastructure/cache'
import { listMeta } from '@/server/api/envelope'
import { applyQ } from '@/server/infrastructure/search/query-build'
import { computeTotals } from '@/server/domain/policies' // PHASE 09 (S2): server-side cart totals
import type { ListQuery } from '@/server/api/query'
import type { cartAddSchema, cartPatchSchema } from '@/server/application/dto'
import type { z } from 'zod'

/** PHASE 10: public rendition URL for the product image (media engine).
 *  Fixes the pre-PHASE-10 bug where Product IDs were signed as MedicalImage
 *  IDs — those URLs always 404'd (audit F6). Public files need no signature. */
function productImageUrl(imageFileId: string | null): string | null {
  if (!imageFileId) return null
  return `/api/v1/files/${imageFileId}/content?variant=compressed`
}

// ── PRODUCT LIST (SQL-side search/filter/pagination, ED-151) ──────────────
// PHASE 14 fixes S-1/S-4: `q`, OTC and pagination are pushed INTO the SQL
// query (no load-then-filter); facets (categories/brands) come from a tiny
// cached projection. Cache keys include every dimension so pages stay hot.
const PRODUCT_Q_FIELDS = ['nameFa', 'nameEn', 'brand', 'category', 'sku', 'descriptionFa', 'descriptionEn'] as const

export async function listProducts(query: ListQuery, category: string, otc: string, brand: string) {
  const otcFilter = otc === 'true' ? 'otc' : otc === 'false' ? 'rx' : 'all'
  const { where: qWhere } = applyQ(query.q, PRODUCT_Q_FIELDS)
  const where = {
    active: true, deletedAt: null,
    ...(category ? { category } : {}),
    ...(brand ? { brand } : {}),
    ...(otcFilter === 'otc' ? { requiresPrescription: false } : {}),
    ...(otcFilter === 'rx' ? { requiresPrescription: true } : {}),
    ...(qWhere ? (qWhere as Record<string, unknown>) : {}),
  }

  const cacheKey = cacheKeys.products(
    `p${query.page}:${query.limit}|cat:${category || 'all'}|brand:${brand || 'all'}|otc:${otcFilter}`
    + `|q:${query.q ? query.q.toLowerCase() : '-'}|sort:${query.sort}:${query.order}`,
  )

  const data = await cached(cacheKey, cacheTtl.catalog, async () => {
    const [rows, total] = await Promise.all([
      db.product.findMany({
        where,
        orderBy: { [query.sort === 'nameFa' ? 'nameFa' : query.sort === 'sku' ? 'sku' : 'createdAt']: query.order },
        skip: query.offset,
        take: query.limit,
      }),
      db.product.count({ where }),
    ])
    return { rows, total }
  })

  // facets: distinct-ish projection of two short columns only (bounded)
  const facets = await cached(cacheKeys.products('facets'), cacheTtl.catalog, async () => {
    const all = await db.product.findMany({
      where: { active: true, deletedAt: null },
      select: { category: true, brand: true },
    })
    return {
      categories: [...new Set(all.map((p) => p.category).filter(Boolean))],
      brands: [...new Set(all.map((p) => p.brand).filter(Boolean))],
    }
  })

  return {
    products: data.rows.map((p) => ({
      id: p.id, sku: p.sku, nameFa: p.nameFa, nameEn: p.nameEn, brand: p.brand, category: p.category,
      descriptionFa: p.descriptionFa, descriptionEn: p.descriptionEn,
      price: p.currentPrice, stock: p.stock, requiresPrescription: p.requiresPrescription,
      usageFa: p.usageFa, image: productImageUrl(p.imageFileId),
    })),
    categories: facets.categories, brands: facets.brands,
    ...listMeta(query.page, query.limit, data.total),
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
      image: productImageUrl(p.imageFileId),
    },
  }
}

/** Detail + price history (10 latest; history rows are never destroyed). */
export async function getProductWithHistory(id: string) {
  const p = await db.product.findUnique({ where: { id } })
  if (!p || p.deletedAt) throw new NotFoundError('محصول یافت نشد')
  const history = await db.productPriceHistory.findMany({ where: { productId: id }, orderBy: { createdAt: 'desc' }, take: 10 })
  return { product: { ...p, image: productImageUrl(p.imageFileId) }, priceHistory: history }
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
