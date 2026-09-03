import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, audit } from '@/lib/api'
import { getAuth } from '@/lib/auth'
import { notify } from '@/lib/notify'

// GET /api/v1/admin/products — management list w/ price history
export async function GET(req: NextRequest) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  if (!['ADMIN', 'OPERATOR', 'EXPERT_2'].includes(auth.user.role)) return fail('دسترسی غیرمجاز', 403)
  const products = await db.product.findMany({
    where: { deletedAt: null }, orderBy: { createdAt: 'asc' },
    include: { priceHistory: { orderBy: { createdAt: 'desc' }, take: 5, include: { changedBy: { select: { firstName: true, lastName: true } } } } },
  })
  return ok({ products })
}

// POST /api/v1/admin/products — create product
export async function POST(req: NextRequest) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  if (!['ADMIN', 'OPERATOR'].includes(auth.user.role)) return fail('دسترسی غیرمجاز', 403)
  const body = await req.json().catch(() => ({}))
  if (!body.nameFa || !body.sku) return fail('SKU و نام فارسی الزامی است')
  const exists = await db.product.findUnique({ where: { sku: String(body.sku) } })
  if (exists) return fail('این SKU قبلاً ثبت شده است', 409)
  const p = await db.product.create({
    data: {
      sku: String(body.sku), nameFa: String(body.nameFa), nameEn: String(body.nameEn || body.nameFa),
      brand: body.brand || null, category: body.category || null,
      descriptionFa: body.descriptionFa || null, descriptionEn: body.descriptionEn || null,
      currentPrice: Number(body.currentPrice || 0), purchasePrice: Number(body.purchasePrice || 0),
      stock: Number(body.stock || 0), requiresPrescription: Boolean(body.requiresPrescription),
      usageFa: body.usageFa || null, restrictions: body.restrictions || null,
    },
  })
  await db.productPriceHistory.create({ data: { productId: p.id, newPrice: p.currentPrice, reason: 'INITIAL', changedById: auth.user.id } })
  await audit(req, auth.user.id, 'CREATE_PRODUCT', 'Product', p.id, null, { sku: p.sku })
  return ok({ product: p })
}

// PATCH /api/v1/admin/products — update stock/active/price (price → history)
export async function PATCH(req: NextRequest) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  if (!['ADMIN', 'OPERATOR'].includes(auth.user.role)) return fail('دسترسی غیرمجاز', 403)
  const body = await req.json().catch(() => ({}))
  const p = await db.product.findUnique({ where: { id: String(body.id || '') } })
  if (!p) return fail('محصول یافت نشد', 404)
  const data: Record<string, unknown> = {}
  for (const k of ['nameFa', 'nameEn', 'brand', 'category', 'descriptionFa', 'descriptionEn', 'usageFa', 'restrictions']) {
    if (body[k] !== undefined) data[k] = body[k]
  }
  if (body.stock !== undefined) data.stock = Number(body.stock)
  if (body.requiresPrescription !== undefined) data.requiresPrescription = Boolean(body.requiresPrescription)
  if (body.active !== undefined) { data.active = Boolean(body.active); if (!body.active) data.deletedAt = new Date() }
  if (body.currentPrice !== undefined && Number(body.currentPrice) !== p.currentPrice) {
    const newPrice = Number(body.currentPrice)
    data.currentPrice = newPrice
    await db.productPriceHistory.create({
      data: { productId: p.id, oldPrice: p.currentPrice, newPrice, reason: String(body.reason || 'MANUAL'), changedById: auth.user.id },
    })
  }
  await db.product.update({ where: { id: p.id }, data })
  await audit(req, auth.user.id, 'EDIT_PRODUCT', 'Product', p.id, { stock: p.stock, price: p.currentPrice }, data)
  return ok()
}
