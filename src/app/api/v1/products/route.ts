import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, textMatches } from '@/lib/api'
import { getAuth, signImageUrl } from '@/lib/auth'

// GET /api/v1/products?q=&category=&otc=&disease=&sort= — Persian-normalized search
export async function GET(req: NextRequest) {
  const auth = await getAuth()
  const url = new URL(req.url)
  const q = url.searchParams.get('q') || ''
  const category = url.searchParams.get('category') || ''
  const otc = url.searchParams.get('otc') || ''
  const brand = url.searchParams.get('brand') || ''

  const products = await db.product.findMany({
    where: { active: true, deletedAt: null, ...(category ? { category } : {}), ...(brand ? { brand } : {}) },
    orderBy: { createdAt: 'asc' },
  })

  let filtered = products
  if (q) filtered = products.filter((p) => textMatches(q, p.nameFa, p.nameEn, p.brand, p.category, p.sku))
  if (otc === 'true') filtered = filtered.filter((p) => !p.requiresPrescription)
  if (otc === 'false') filtered = filtered.filter((p) => p.requiresPrescription)

  const categories = [...new Set(products.map((p) => p.category).filter(Boolean))]
  const brands = [...new Set(products.map((p) => p.brand).filter(Boolean))]

  return ok({
    products: filtered.map((p) => ({
      id: p.id, sku: p.sku, nameFa: p.nameFa, nameEn: p.nameEn, brand: p.brand, category: p.category,
      descriptionFa: p.descriptionFa, descriptionEn: p.descriptionEn,
      price: p.currentPrice, stock: p.stock, requiresPrescription: p.requiresPrescription,
      usageFa: p.usageFa, image: p.imagePath ? signImageUrl(p.id) : null,
    })),
    categories, brands,
  })
}
