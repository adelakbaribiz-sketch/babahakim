// ── BabaHakim Backend · Application Service: Patient Profile (PHASE 08) ───
// The update use case is now atomic (user + profile upsert together, ED-103).
import { db } from '@/lib/db'
import type { AuthContext } from '@/lib/auth'
import { invalidateUserIdentity } from '@/lib/auth'
import { NotFoundError } from '@/server/core/errors'
import { writeAudit } from '@/server/infrastructure/audit'
import { withTransaction } from '@/server/infrastructure/uow'
import { publish, Events } from '@/server/infrastructure/events'
import type { RequestContext } from '@/server/core/context'
import type { profileUpdateSchema } from '@/server/application/dto'
import type { z } from 'zod'

export async function getProfile(auth: AuthContext) {
  const user = await db.user.findUnique({ where: { id: auth.user.id }, include: { profile: true } })
  if (!user) throw new NotFoundError('کاربر یافت نشد')
  const lastMizaj = await db.questionnaireResponse.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } })
  return {
    user: {
      id: user.id, firstName: user.firstName, lastName: user.lastName, phone: user.phone, email: user.email,
      gender: user.gender, birthDate: user.birthDate, referralCode: user.referralCode, profileComplete: user.profileComplete,
    },
    profile: user.profile, lastMizaj,
  }
}

export async function updateProfile(
  auth: AuthContext, ctx: RequestContext, input: z.infer<typeof profileUpdateSchema>,
) {
  const userData: Record<string, unknown> = {}
  if (input.firstName) userData.firstName = input.firstName
  if (input.lastName) userData.lastName = input.lastName
  if (input.email !== undefined) userData.email = input.email || null
  if (input.gender) userData.gender = input.gender
  if (input.birthDate) userData.birthDate = new Date(input.birthDate)

  const profileData: Record<string, unknown> = {}
  for (const k of ['province', 'city', 'postalCode', 'addressLine', 'emergencyPhone', 'allergies', 'pastIllnesses', 'currentMeds', 'pregnancy', 'referredBy'] as const) {
    if (input[k] !== undefined) profileData[k] = input[k] || null
  }
  for (const k of ['heightCm', 'weightKg'] as const) {
    if (input[k] !== undefined && input[k] !== null) profileData[k] = input[k]
  }

  await withTransaction(async (tx) => {
    if (Object.keys(userData).length) {
      await tx.user.update({ where: { id: auth.user.id }, data: { ...userData, profileComplete: true } })
    } else {
      await tx.user.update({ where: { id: auth.user.id }, data: { profileComplete: true } })
    }
    const existing = await tx.patientProfile.findUnique({ where: { userId: auth.user.id } })
    if (existing) {
      if (Object.keys(profileData).length) {
        await tx.patientProfile.update({ where: { userId: auth.user.id }, data: profileData })
      }
    } else {
      await tx.patientProfile.create({ data: { userId: auth.user.id, ...profileData } })
    }
  })

  await publish(Events.ProfileUpdated, auth.user.id, ctx.reqId)
  invalidateUserIdentity(auth.user.id) // ED-183: name changes feed the identity/JWT payload
  await writeAudit(ctx, { userId: auth.user.id, action: 'EDIT_PATIENT', entity: 'PatientProfile', entityId: auth.user.id, newValues: profileData })
  return { ok: true }
}
