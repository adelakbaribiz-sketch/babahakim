// API layer (thin controller) — business logic in @/server/application (ED-93).
import { apiRoute } from '@/server/api/handler'
import { requireRole } from '@/server/api/guards'
import { parseListQuery } from '@/server/api/query'
import { listAuditLogs } from '@/server/application/services/adminService'

// GET /api/v1/admin/audit-logs?q=&action= (append-only audit stream)
export const GET = apiRoute(async (req) => {
  await requireRole('ADMIN')
  const query = parseListQuery(req.url, { defaultLimit: 300, maxLimit: 300, sortable: ['createdAt'] })
  return listAuditLogs(query, query.raw.get('action') || '')
})
