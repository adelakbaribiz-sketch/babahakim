import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { getAuth, signImageUrl } from '@/lib/auth'

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  const { id } = await ctx.params
  const p = await db.product.findUnique({ where: { id } })
  if (!p || p.deletedAt) return fail('محصول یافت نشد', 404)
  const history = await db.productPriceHistory.findMany({ where: { productId: id }, orderBy: { createdAt: 'desc' }, take: 10 })
  return ok({ product: { ...p, image: p.imagePath ? signImageUrl(p.id) : null }, priceHistory: history })
}
