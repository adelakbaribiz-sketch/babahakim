import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, audit } from '@/lib/api'
import { getAuth } from '@/lib/auth'
import { notify } from '@/lib/notify'

// GET /api/v1/patients/profile
export async function GET(req: NextRequest) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  const user = await db.user.findUnique({ where: { id: auth.user.id }, include: { profile: true } })
  if (!user) return fail('کاربر یافت نشد', 404)
  const lastMizaj = await db.questionnaireResponse.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } })
  return ok({
    user: {
      id: user.id, firstName: user.firstName, lastName: user.lastName, phone: user.phone, email: user.email,
      gender: user.gender, birthDate: user.birthDate, referralCode: user.referralCode, profileComplete: user.profileComplete,
    },
    profile: user.profile, lastMizaj,
  })
}

// PUT /api/v1/patients/profile
export async function PUT(req: NextRequest) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  const body = await req.json().catch(() => null)
  if (!body) return fail('درخواست نامعتبر')

  const userData: Record<string, unknown> = {}
  if (body.firstName) userData.firstName = String(body.firstName).trim()
  if (body.lastName) userData.lastName = String(body.lastName).trim()
  if (body.email !== undefined) userData.email = body.email || null
  if (body.gender) userData.gender = body.gender
  if (body.birthDate) userData.birthDate = new Date(body.birthDate)
  if (Object.keys(userData).length) await db.user.update({ where: { id: auth.user.id }, data: userData })

  const profileData: Record<string, unknown> = {}
  for (const k of ['province', 'city', 'postalCode', 'addressLine', 'emergencyPhone', 'allergies', 'pastIllnesses', 'currentMeds', 'pregnancy', 'referredBy']) {
    if (body[k] !== undefined) profileData[k] = body[k] || null
  }
  for (const k of ['heightCm', 'weightKg']) {
    if (body[k] !== undefined && body[k] !== null && body[k] !== '') profileData[k] = Number(body[k])
  }

  const existing = await db.patientProfile.findUnique({ where: { userId: auth.user.id } })
  if (existing) {
    if (Object.keys(profileData).length) await db.patientProfile.update({ where: { userId: auth.user.id }, data: profileData })
  } else {
    await db.patientProfile.create({ data: { userId: auth.user.id, ...profileData } })
  }

  const complete = Boolean(userData.firstName !== undefined || body.firstName)
  await db.user.update({ where: { id: auth.user.id }, data: { profileComplete: true } })
  await notify(auth.user.id, 'PROFILE_COMPLETED', {})
  await audit(req, auth.user.id, 'EDIT_PATIENT', 'PatientProfile', auth.user.id, null, profileData)
  return ok()
}
