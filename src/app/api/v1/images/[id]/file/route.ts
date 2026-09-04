import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { fail } from '@/lib/api'
import { getAuth, verifyImageSig } from '@/lib/auth'
import { readStored, fileExists } from '@/lib/storage'
import { audit, getIP, getDevice } from '@/lib/api'

// GET /api/v1/images/[id]/file?variant=thumb|compressed|original|ai&exp=&sig=
// PHASE 05: medical images are NEVER public. Access = signed URL (short-lived HMAC)
// OR an authenticated session with an EXPLICIT view permission (ED-66):
//   - PATIENT: owner of the image / owner of the case the image belongs to
//   - staff: view_images OR view_medical_files permission (server-enforced)
// Every staff access to a patient's medical image is audited (VIEW_MEDICAL_FILE).
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  // path-traversal hardening: ids are opaque cuids; reject anything else early
  if (!/^[a-zA-Z0-9]{10,40}$/.test(id)) return fail('شناسه تصویر نامعتبر است', 400)

  const url = new URL(req.url)
  const variant = (url.searchParams.get('variant') || 'compressed') as 'thumb' | 'compressed' | 'original' | 'ai'
  const exp = url.searchParams.get('exp') || ''
  const sig = url.searchParams.get('sig') || ''

  const image = await db.medicalImage.findUnique({ where: { id } })
  if (!image || image.deletedAt) return fail('تصویر یافت نشد', 404)

  let authorized = false
  let viewerId: string | null = null
  if (exp && sig) {
    authorized = verifyImageSig(id, exp, sig) // signed URL path (expiry enforced, timing-safe)
  } else {
    const auth = await getAuth()
    if (auth) {
      viewerId = auth.user.id
      if (auth.user.role === 'PATIENT') {
        authorized = image.ownerId === auth.user.id || (image.caseId != null && (await isOwnCase(auth.user.id, image.caseId)))
      } else {
        // ED-66: server-side permission check — not "any staff role"
        const canView = auth.user.role === 'ADMIN' || auth.permissions.includes('view_images') || auth.permissions.includes('view_medical_files')
        authorized = canView
      }
    }
  }
  if (!authorized) {
    if (viewerId) await audit(req, viewerId, 'MEDICAL_FILE_ACCESS_DENIED', 'MedicalImage', id)
    return fail('دسترسی به تصویر پزشکی غیرمجاز است', 403)
  }

  // Download/access audit for EVERY staff viewer (incl. OPERATOR) and signed-URL
  // fetches lacking a session (entity id + ip recorded; signed URLs are patient-share links)
  if (exp && sig) {
    await audit(req, viewerId, 'DOWNLOAD_IMAGE', 'MedicalImage', id, null, { variant, via: 'SIGNED_URL' })
  } else if (viewerId && (await isStaffSession(viewerId, image.ownerId))) {
    await audit(req, viewerId, 'VIEW_MEDICAL_FILE', 'MedicalImage', id, null, { variant })
  }

  const path = variant === 'thumb' ? image.thumbPath : variant === 'ai' ? image.aiPath : variant === 'original' ? image.originalPath : image.compressedPath
  if (!path || !(await fileExists(path))) return fail('فایل یافت نشد', 404)
  const buf = await readStored(path)
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'private, max-age=60, no-store-when-shared',
      'Content-Length': String(buf.length),
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

async function isOwnCase(userId: string, caseId: string) {
  const c = await db.medicalCase.findUnique({ where: { id: caseId }, select: { patientId: true } })
  return c?.patientId === userId
}

async function isStaffSession(viewerId: string, ownerId: string): Promise<boolean> {
  // staff = anyone who is not the owning patient
  return viewerId !== ownerId
}
