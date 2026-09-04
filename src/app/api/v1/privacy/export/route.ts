import { NextRequest } from 'next/server'
import { fail, ok, audit } from '@/lib/api'
import { requireAuth } from '@/lib/api'
import { rateLimit, rateLimited, LIMITS } from '@/lib/security/rate-limit'
import { buildExportBundle } from '@/lib/security/privacy'

// GET /api/v1/privacy/export — full personal data export (JSON bundle).
// PHASE 05 (ED-68): right to data portability. Rate-limited to 1/day per user
// (bundle assembly is heavy). Every export is audited (sensitive).
export async function GET(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)

  const rl = rateLimit(`export:${auth.user.id}`, LIMITS.export.limit, LIMITS.export.windowMs)
  if (!rl.allowed) {
    await audit(req, auth.user.id, 'EXPORT_RATE_LIMITED', 'User', auth.user.id)
    return rateLimited(rl, 'خروجی داده روزانه یک‌بار مجاز است')
  }

  const bundle = await buildExportBundle(auth.user.id)
  await audit(req, auth.user.id, 'DATA_EXPORT', 'User', auth.user.id, null, { sections: Object.keys(bundle) })

  return new Response(JSON.stringify({ ...bundle, generatedAt: new Date().toISOString() }, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="babahakim-data-export-${Date.now()}.json"`,
      'Cache-Control': 'no-store',
    },
  })
}

export { ok }
