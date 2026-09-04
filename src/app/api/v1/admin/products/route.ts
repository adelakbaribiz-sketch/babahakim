// API layer (thin controller) — business logic in @/server/application (ED-93).
// POST/PATCH accept EITHER JSON or multipart (field `data` = JSON product
// payload + field `image` = optional product image → media engine, PUBLIC).
import { apiRoute, parseBody } from '@/server/api/handler'
import { requireRole } from '@/server/api/guards'
import { productSchema, looseIdSchema } from '@/server/application/dto'
import { listAdminProducts, createProduct, patchProduct } from '@/server/application/services/adminService'

// GET /api/v1/admin/products — management list w/ price history
export const GET = apiRoute(async () => {
  await requireRole('ADMIN', 'OPERATOR', 'EXPERT_2')
  return listAdminProducts()
})

async function readBody(req: Request): Promise<{ body: unknown; imageFile?: File }> {
  const ct = req.headers.get('content-type') || ''
  if (ct.includes('multipart/form-data')) {
    const form = await req.formData()
    const raw = form.get('data')
    let body: unknown = {}
    if (typeof raw === 'string' && raw.trim() !== '') {
      try { body = JSON.parse(raw) } catch { body = {} }
    }
    const image = form.get('image')
    return { body, imageFile: image instanceof File ? image : undefined }
  }
  return { body: await req.json().catch(() => ({})) }
}

// POST /api/v1/admin/products — create product (+ initial price history row
// + optional PUBLIC image through the media engine, PHASE 10)
export const POST = apiRoute(async (req, _route, env) => {
  const auth = await requireRole('ADMIN', 'OPERATOR')
  const { body, imageFile } = await readBody(req)
  const input = productSchema.parse(body)
  return createProduct(auth, env.ctx, input, { imageFile })
})

// PATCH /api/v1/admin/products — update stock/active/price (price → history)
// + optional image replacement (new immutable version, PHASE 10)
export const PATCH = apiRoute(async (req, _route, env) => {
  const auth = await requireRole('ADMIN', 'OPERATOR')
  const { body, imageFile } = await readBody(req)
  const input = looseIdSchema.parse(body)
  return patchProduct(auth, env.ctx, input as Record<string, unknown>, { imageFile })
})
