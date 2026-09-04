// PHASE 05 — Privacy rights: consent ledger, data access, export, deletion
// (anonymization), terms/privacy acceptance (ED-67/68/69; spec privacy items).
import { db } from '@/lib/db'

// ── Consent ledger (versioned; MARKETING revocable, core service consents not) ──

export const CONSENT_TYPES = ['TERMS', 'PRIVACY', 'DATA_PROCESSING', 'MEDICAL_IMAGE_AI', 'MARKETING'] as const
export type ConsentType = (typeof CONSENT_TYPES)[number]

export const CONSENT_DOC_VERSIONS: Record<ConsentType, string> = {
  TERMS: '1.0',
  PRIVACY: '1.0',
  DATA_PROCESSING: '1.0',
  MEDICAL_IMAGE_AI: '1.0',
  MARKETING: '1.0',
}

export const REVOCABLE: ConsentType[] = ['MARKETING']

export async function recordConsent(
  userId: string,
  consentType: ConsentType,
  ip: string | null,
  device: string | null,
): Promise<void> {
  const version = CONSENT_DOC_VERSIONS[consentType]
  await db.consentRecord.create({ data: { userId, consentType, version, granted: true, ip, device } })
}

export async function revokeConsent(userId: string, consentType: ConsentType): Promise<boolean> {
  if (!REVOCABLE.includes(consentType)) return false
  const latest = await db.consentRecord.findFirst({
    where: { userId, consentType, revokedAt: null },
    orderBy: { grantedAt: 'desc' },
  })
  if (!latest) return false
  await db.consentRecord.update({ where: { id: latest.id }, data: { revokedAt: new Date(), granted: false } })
  return true
}

export async function currentConsents(userId: string) {
  const rows = await db.consentRecord.findMany({ where: { userId }, orderBy: { grantedAt: 'desc' } })
  const state: Record<string, { granted: boolean; version: string | null; at: Date | null }> = {}
  for (const r of rows) {
    if (!(r.consentType in state)) {
      state[r.consentType] = { granted: r.revokedAt === null, version: r.version, at: r.grantedAt }
    }
  }
  return state
}

export async function hasConsent(userId: string, consentType: ConsentType): Promise<boolean> {
  const state = await currentConsents(userId)
  return state[consentType]?.granted === true
}

// ── Data access & export (ED-68) ───────────────────────────────────────

export async function buildExportBundle(userId: string) {
  const [user, profile, responses, cases, prescriptions, orders, tickets, referralRow] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: { phone: true, email: true, firstName: true, lastName: true, role: true, birthDate: true, gender: true, createdAt: true, referralCode: true },
    }),
    db.patientProfile.findUnique({ where: { userId } }),
    db.questionnaireResponse.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    db.medicalCase.findMany({
      where: { patientId: userId },
      select: {
        code: true, status: true, priority: true, description: true, createdAt: true, closedAt: true,
        expert1Summary: true, diagnoses: { select: { title: true, notes: true, createdAt: true } },
        prescriptions: { select: { version: true, status: true, expert1Notes: true, doctorComment: true, items: { select: { drugName: true, dosage: true, frequency: true, duration: true } } } },
      },
    }),
    db.prescription.findMany({
      where: { case: { patientId: userId } },
      select: { version: true, status: true, createdAt: true, items: { select: { drugName: true, dosage: true, frequency: true, duration: true } } },
    }),
    db.order.findMany({
      where: { userId },
      select: { code: true, status: true, total: true, createdAt: true, items: { select: { nameFa: true, quantity: true, unitPrice: true } } },
    }),
    db.ticket.findMany({ where: { userId }, select: { code: true, subject: true, status: true, createdAt: true, messages: { select: { message: true, createdAt: true, senderId: true } } } }),
    db.referral.findFirst({ where: { referredUserId: userId } }),
  ])
  return {
    generatedAt: new Date().toISOString(),
    subject: user,
    patientProfile: profile,
    questionnaireResponses: responses,
    medicalCases: cases,
    prescriptions,
    orders,
    tickets,
    referral: referralRow,
  }
}

// ── Deletion request + anonymization (ED-69: never hard delete) ────────

export async function createDeletionRequest(userId: string, reason: string | null) {
  const existing = await db.deletionRequest.findUnique({ where: { userId } })
  if (existing && ['PENDING', 'PROCESSING'].includes(existing.status)) return { ok: false, reason: 'ALREADY_PENDING' as const, existing }
  const rec = existing
    ? await db.deletionRequest.update({ where: { id: existing.id }, data: { status: 'PENDING', reason, requestedAt: new Date(), processedAt: null, processedById: null, anonymizedAt: null } })
    : await db.deletionRequest.create({ data: { userId, reason } })
  return { ok: true, rec }
}

/**
 * Anonymize a user account (executed by admin approving a deletion request):
 * - PII replaced (phone/name/national id) with irreversible placeholders
 * - sessions revoked, account deactivated
 * - clinical/financial AGGREGATES retained (ED-49 accounting duty, ED-69)
 *
 * PHASE 12 (ED-125): the transactional core runs INSIDE the DELETION_REQUEST
 * machine's COMPLETE transition (all-or-nothing with the status write).
 * The deletion-request row itself is NO LONGER written here — the machine
 * owns that state.
 */
export async function anonymizeUserTx(tx: unknown, userId: string, adminId: string): Promise<{ anonymized: string[] }> {
  const stamp = Date.now().toString(36)
  const placeholderPhone = `deleted-${stamp}`
  const txx = tx as {
    user: { update: (a: unknown) => Promise<unknown> }
    refreshToken: { updateMany: (a: unknown) => Promise<unknown> }
    medicalImage: { findMany: (a: unknown) => Promise<{ id: string }[]> }
  }
  await txx.user.update({
    where: { id: userId },
    data: {
      phone: placeholderPhone, // unique-freed: real phone released
      email: null,
      firstName: 'کاربر',
      lastName: 'حذف‌شده',
      nationalId: null,
      birthDate: null,
      isActive: false,
      profileComplete: false,
    },
  })
  await txx.refreshToken.updateMany({ where: { userId, revoked: false }, data: { revoked: true, revokedReason: 'DELETION', revokedAt: new Date() } })
  // images: keep records (clinical history duty) but machine-guard the status
  // change to REJECTED (MEDICAL_IMAGE machine, reason RIGHT_TO_ERASURE)
  const { cascadeSubTransition } = await import('@/lib/workflow/subtransition')
  const { MEDICAL_IMAGE_MACHINE } = await import('@/lib/workflow/machines/medicalImage')
  const images = await txx.medicalImage.findMany({ where: { ownerId: userId }, select: { id: true } })
  for (const img of images) {
    await cascadeSubTransition({
      tx, machine: MEDICAL_IMAGE_MACHINE, entityId: img.id, action: 'REJECT',
      payload: { reason: 'RIGHT_TO_ERASURE' },
    })
  }
  return { anonymized: ['phone', 'email', 'name', 'nationalId', 'birthDate', 'sessions', 'images'] }
}

/**
 * Backward-compatible entry point (security tests, legacy callers): runs the
 * FULL machine transition when a deletion request exists (COMPLETED + audit +
 * WorkflowState + anonymization in one atomic transaction), otherwise falls
 * back to the bare anonymization core.
 */
export async function anonymizeUser(userId: string, adminId: string): Promise<{ anonymized: string[] }> {
  const rec = await db.deletionRequest.findUnique({ where: { userId } })
  if (rec) {
    const { executeTransition } = await import('@/lib/workflow/engine')
    // Legacy entry point (tests / scripts): the passed adminId may not exist
    // as a User row, so the transition runs as the SYSTEM identity holding
    // the ADMIN role (engine maps actor.id === 'SYSTEM' → null audit userId,
    // FK-safe). Real admin flows (patchDeletionRequest) attribute the actual
    // authenticated user; the initiator lands in the note.
    const res = await executeTransition({
      machine: 'DELETION_REQUEST', entityId: rec.id, action: 'COMPLETE',
      actor: { id: 'SYSTEM', role: 'ADMIN' },
      payload: { confirm: true, note: `anonymized:${Date.now().toString(36)}${adminId ? ` by:${adminId}` : ''}` },
    })
    if (!res.ok) {
      throw new Error(`anonymize failed: ${res.code} — ${res.error}`)
    }
    return { anonymized: ['phone', 'email', 'name', 'nationalId', 'birthDate', 'sessions', 'images'] }
  }
  return db.$transaction((tx) => anonymizeUserTx(tx, userId, adminId))
}
