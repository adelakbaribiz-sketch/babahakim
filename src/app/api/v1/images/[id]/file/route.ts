import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { fail } from '@/lib/api'
import { getAuth, verifyImageSig, signImageUrl } from '@/lib/auth'
import { readStored, fileExists } from '@/lib/storage'

// GET /api/v1/images/[id]/file?variant=thumb|compressed|original|ai&exp=&sig=
// Medical images are NEVER public: access requires either a valid session + authorization,
// or a short-lived HMAC signed URL (expiry enforced).
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const url = new URL(req.url)
  const variant = (url.searchParams.get('variant') || 'compressed') as 'thumb' | 'compressed' | 'original' | 'ai'
  const exp = url.searchParams.get('exp') || ''
  const sig = url.searchParams.get('sig') || ''

  const image = await db.medicalImage.findUnique({ where: { id } })
  if (!image) return fail('تصویر یافت نشد', 404)

  let authorized = false
  if (exp && sig) {
    authorized = verifyImageSig(id, exp, sig) // signed URL path
  } else {
    const auth = await getAuth()
    if (auth) {
      if (auth.user.role === 'PATIENT') {
        authorized = image.ownerId === auth.user.id || (image.caseId != null && (await isOwnCase(auth.user.id, image.caseId)))
      } else {
        authorized = true // staff with any view permission (checked client-side by nav)
        if (auth.user.role === 'DOCTOR' || auth.user.role === 'EXPERT_1' || auth.user.role === 'EXPERT_2') {
          await recordView(req, auth.user.id, id)
        }
      }
    }
  }
  if (!authorized) return fail('دسترسی به تصویر پزشکی غیرمجاز است', 403)

  const path = variant === 'thumb' ? image.thumbPath : variant === 'ai' ? image.aiPath : variant === 'original' ? image.originalPath : image.compressedPath
  if (!path || !(await fileExists(path))) return fail('فایل یافت نشد', 404)
  const buf = await readStored(path)
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'private, max-age=60',
      'Content-Length': String(buf.length),
    },
  })
}

async function isOwnCase(userId: string, caseId: string) {
  const c = await db.medicalCase.findUnique({ where: { id: caseId }, select: { patientId: true } })
  return c?.patientId === userId
}

async function recordView(req: NextRequest, userId: string, imageId: string) {
  try {
    const { audit } = await import('@/lib/api')
    await audit(req, userId, 'VIEW_MEDICAL_FILE', 'MedicalImage', imageId)
  } catch { /* noop */ }
}
