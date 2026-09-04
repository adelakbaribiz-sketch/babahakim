// API layer (thin controller) — business logic in @/server/application (ED-93).
// Catalog is read-only for unauthenticated listing (public shop data, no PHI);
// every request still flows through the standard handler (logging + envelope).
import { apiRoute } from '@/server/api/handler'
import { parseListQuery } from '@/server/api/query'
import { listProducts } from '@/server/application/services/catalogService'

// GET /api/v1/products?page=&limit=&sort=&order=&q=&category=&brand=&otc=
export const GET = apiRoute(async (req) => {
  const query = parseListQuery(req.url, {
    defaultLimit: 60, sortable: ['createdAt', 'nameFa', 'sku'], defaultOrder: 'asc',
  })
  const raw = query.raw
  return listProducts(query, raw.get('category') || '', raw.get('otc') || '', raw.get('brand') || '')
})
