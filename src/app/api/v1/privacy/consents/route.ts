import { NextRequest } from 'next/server'
import { ok, fail, audit, getIP, getDevice } from '@/lib/api'
import { requireAuth } from '@/lib/api'
import { currentConsents, recordConsent, CONSENT_TYPES, CONSENT_DOC_VERSIONS, ConsentType } from '@/lib/security/privacy'

// GET /api/v1/privacy/consents — my consent ledger + current document versions
export async function GET() {
  const auth = await requireAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  const state = await currentConsents(auth.user.id)
  return ok({ consents: state, documentVersions: CONSENT_DOC_VERSIONS })
}

// POST /api/v1/privacy/consents { consentType } — accept terms/privacy/...
export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  const body = await req.json().catch(() => null)
  const consentType = String(body?.consentType || '') as ConsentType
  if (!CONSENT_TYPES.includes(consentType)) return fail('نوع رضایت نامعتبر است', 422)

  const ip = await getIP(req)
  const device = getDevice(req)
  await recordConsent(auth.user.id, consentType, ip, device)
  await audit(req, auth.user.id, 'CONSENT_GRANTED', 'ConsentRecord', auth.user.id, null, { consentType })
  return ok({ consentType, granted: true })
}
