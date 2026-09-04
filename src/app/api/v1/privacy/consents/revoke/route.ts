import { NextRequest } from 'next/server'
import { ok, fail, audit } from '@/lib/api'
import { requireAuth } from '@/lib/api'
import { revokeConsent, REVOCABLE, ConsentType } from '@/lib/security/privacy'

// POST /api/v1/privacy/consents/revoke { consentType }
// MARKETING is revocable; core service consents (TERMS/PRIVACY/DATA_PROCESSING/
// MEDICAL_IMAGE_AI) cannot be revoked while the service relationship is active (ED-67).
export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  const body = await req.json().catch(() => null)
  const consentType = String(body?.consentType || '') as ConsentType
  if (!REVOCABLE.includes(consentType)) {
    return fail('این رضایت به دلیل فعال بودن خدمات قابل لغو نیست؛ برای حذف کامل داده درخواست حذف ثبت کنید', 409)
  }
  const done = await revokeConsent(auth.user.id, consentType)
  if (!done) return fail('رضایت فعالی برای لغو یافت نشد', 404)
  await audit(req, auth.user.id, 'CONSENT_REVOKED', 'ConsentRecord', auth.user.id, null, { consentType })
  return ok({ consentType, granted: false })
}
