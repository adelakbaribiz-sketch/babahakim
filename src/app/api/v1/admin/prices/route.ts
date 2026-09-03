import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, audit, textMatches, normalizeFa } from '@/lib/api'
import { getAuth } from '@/lib/auth'
import { notify } from '@/lib/notify'

// Price import & bulk change engine
// POST /api/v1/admin/prices {mode: "preview" | "commit" | "bulk", ...}
//  - mode=preview: parse CSV/TSV text (Excel-exportable) → validated rows
//  - mode=commit: apply previewed changes (price history preserved — old prices never destroyed)
//  - mode=bulk: increase/decrease all (or category) prices by X% (history preserved)
export async function POST(req: NextRequest) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  if (!['ADMIN', 'OPERATOR'].includes(auth.user.role)) return fail('دسترسی غیرمجاز', 403)
  const body = await req.json().catch(() => ({}))
  const mode = String(body.mode || '')

  if (mode === 'preview' || mode === 'commit') {
    const csvText = String(body.csv || '').trim()
    if (!csvText) return fail('متن CSV خالی است — فایل CSV را در Excel باز کرده و محتوا را اینجا جای‌گذاری کنید')
    const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    const delimiter = lines[0].includes('\t') ? '\t' : lines[0].includes(',') ? ',' : ';'
    const header = lines[0].split(delimiter).map((h) => normalizeFa(h))
    const skuIdx = header.findIndex((h) => ['sku', 'کد', 'کد محصول', 'کدکالا'].includes(h))
    const priceIdx = header.findIndex((h) => ['price', 'قیمت', 'قیمت فروش', 'price_new', 'قیمت جدید'].includes(h))
    if (skuIdx === -1 || priceIdx === -1) {
      return fail('ستون‌های الزامی شناسایی نشد — باید ستون «sku/کد» و «price/قیمت» وجود داشته باشد', 422, { header })
    }

    const products = await db.product.findMany({ where: { deletedAt: null } })
    const rows: { line: number; sku: string; productName: string; oldPrice: number | null; newPrice: number; valid: boolean; error?: string }[] = []

    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(delimiter)
      const sku = normalizeFa(String(cells[skuIdx] || '').replace(/"/g, ''))
      const priceRaw = String(cells[priceIdx] || '').replace(/[",\s۰-۹]/g, (d: string) => ('۰۱۲۳۴۵۶۷۸۹'.includes(d) ? String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)) : '')).replace(/[^\d]/g, '')
      const product = products.find((p) => normalizeFa(p.sku) === sku)
      const newPrice = parseInt(priceRaw || '0', 10)
      let valid = true, error: string | undefined
      if (!sku) { valid = false; error = 'SKU خالی' }
      else if (!product) { valid = false; error = 'محصول یافت نشد' }
      else if (!newPrice || newPrice < 1000) { valid = false; error = 'قیمت نامعتبر (<۱۰۰۰ تومان)' }
      rows.push({ line: i, sku, productName: product?.nameFa || '—', oldPrice: product?.currentPrice ?? null, newPrice, valid, error })
    }

    if (mode === 'preview') {
      return ok({
        rows,
        summary: { total: rows.length, valid: rows.filter((r) => r.valid).length, invalid: rows.filter((r) => !r.valid).length },
        detected: { header, delimiter: delimiter === '\t' ? 'TAB' : delimiter === ',' ? 'COMMA' : 'SEMICOLON' },
      })
    }

    // commit
    let applied = 0
    for (const r of rows.filter((x) => x.valid)) {
      const product = products.find((p) => normalizeFa(p.sku) === r.sku)!
      await db.product.update({ where: { id: product.id }, data: { currentPrice: r.newPrice } })
      await db.productPriceHistory.create({
        data: { productId: product.id, oldPrice: product.currentPrice, newPrice: r.newPrice, reason: 'IMPORT', changedById: auth.user.id, sourceRow: JSON.stringify({ sku: r.sku, line: r.line }) },
      })
      applied++
    }
    await audit(req, auth.user.id, 'PRICE_CHANGE', 'Product', 'import', null, { applied })
    return ok({ applied, message: `${applied} قیمت با موفقیت به‌روزرسانی شد` })
  }

  if (mode === 'bulk') {
    const percent = Number(body.percent || 0)
    const category = body.category ? String(body.category) : null
    if (!percent || Math.abs(percent) > 100) return fail('درصد نامعتبر است (۱ تا ۱۰۰)')
    const products = await db.product.findMany({ where: { deletedAt: null, active: true, ...(category ? { category } : {}) } })
    let applied = 0
    for (const p of products) {
      const newPrice = Math.round((p.currentPrice * (100 + percent)) / 100 / 1000) * 1000
      if (newPrice !== p.currentPrice) {
        await db.product.update({ where: { id: p.id }, data: { currentPrice: newPrice } })
        await db.productPriceHistory.create({
          data: { productId: p.id, oldPrice: p.currentPrice, newPrice, reason: percent > 0 ? 'BULK_INCREASE' : 'BULK_DECREASE', changedById: auth.user.id },
        })
        applied++
      }
    }
    await audit(req, auth.user.id, 'PRICE_CHANGE', 'Product', 'bulk', null, { percent, applied })
    return ok({ applied, message: `${applied} محصول ${percent > 0 ? '+' : ''}${percent}٪ شد` })
  }

  return fail('حالت نامعتبر است (preview | commit | bulk)')
}

// GET /api/v1/admin/prices — full price history log
export async function GET(req: NextRequest) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  if (!['ADMIN', 'OPERATOR', 'EXPERT_2'].includes(auth.user.role)) return fail('دسترسی غیرمجاز', 403)
  const history = await db.productPriceHistory.findMany({
    orderBy: { createdAt: 'desc' }, take: 200,
    include: { product: { select: { sku: true, nameFa: true } }, changedBy: { select: { firstName: true, lastName: true, role: true } } },
  })
  return ok({ history })
}
