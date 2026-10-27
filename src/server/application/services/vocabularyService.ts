// ── BabaHakim Backend · Application Service: Clinical vocabulary ──────────
// Admin-managed presets for prescription fields (dose / unit / frequency /
// duration / warning). Experts pick from them in searchable comboboxes and
// may still type a controlled custom value; nothing here is medical advice.
import { db } from '@/lib/db'
import type { AuthContext } from '@/lib/auth'
import { ConflictError, NotFoundError } from '@/server/core/errors'
import { writeAudit } from '@/server/infrastructure/audit'
import type { RequestContext } from '@/server/core/context'
import type { z } from 'zod'
import type { vocabularyCreateSchema, vocabularyPatchSchema } from '@/server/application/dto'

export const VOCAB_KINDS = ['DOSAGE', 'UNIT', 'FREQUENCY', 'DURATION', 'WARNING'] as const

export async function listVocabulary(kind: string | null, includeInactive: boolean) {
  const items = await db.clinicalVocabulary.findMany({
    where: { ...(kind ? { kind } : {}), ...(includeInactive ? {} : { active: true }) },
    orderBy: [{ kind: 'asc' }, { order: 'asc' }, { valueFa: 'asc' }],
  })
  return { items }
}

export async function createVocabulary(auth: AuthContext, ctx: RequestContext, input: z.infer<typeof vocabularyCreateSchema>) {
  const dup = await db.clinicalVocabulary.findUnique({ where: { kind_valueFa: { kind: input.kind, valueFa: input.valueFa } } })
  if (dup) throw new ConflictError('این مقدار قبلاً در واژه‌نامه ثبت شده است')
  const item = await db.clinicalVocabulary.create({ data: { kind: input.kind, valueFa: input.valueFa, valueEn: input.valueEn || null, order: input.order } })
  await writeAudit(ctx, { userId: auth.user.id, action: 'VOCABULARY_CREATE', entity: 'ClinicalVocabulary', entityId: item.id, newValues: input })
  return { item }
}

export async function patchVocabulary(auth: AuthContext, ctx: RequestContext, input: z.infer<typeof vocabularyPatchSchema>) {
  const old = await db.clinicalVocabulary.findUnique({ where: { id: input.id } })
  if (!old) throw new NotFoundError('مورد یافت نشد')
  const { id, ...data } = input
  const item = await db.clinicalVocabulary.update({ where: { id }, data })
  await writeAudit(ctx, { userId: auth.user.id, action: 'VOCABULARY_UPDATE', entity: 'ClinicalVocabulary', entityId: id, oldValues: old, newValues: data })
  return { item }
}
