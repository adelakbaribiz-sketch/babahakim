import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, audit } from '@/lib/api'
import { getAuth } from '@/lib/auth'

// GET /api/v1/admin/diseases
export async function GET(req: NextRequest) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  if (!['ADMIN', 'EXPERT_1', 'EXPERT_2', 'DOCTOR'].includes(auth.user.role)) return fail('دسترسی غیرمجاز', 403)
  const diseases = await db.disease.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'asc' }, include: { _count: { select: { diagnoses: true } } } })
  return ok({ diseases })
}

// POST /api/v1/admin/diseases — create
export async function POST(req: NextRequest) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  if (!['ADMIN'].includes(auth.user.role)) return fail('دسترسی غیرمجاز', 403)
  const body = await req.json().catch(() => ({}))
  if (!body.nameFa || !body.code) return fail('کد و نام فارسی الزامی است')
  const exists = await db.disease.findUnique({ where: { code: String(body.code) } })
  if (exists) return fail('این کد قبلاً ثبت شده است', 409)
  const d = await db.disease.create({
    data: {
      code: String(body.code), nameFa: String(body.nameFa), nameEn: String(body.nameEn || body.nameFa),
      category: body.category || null, descriptionFa: body.descriptionFa || null, descriptionEn: body.descriptionEn || null,
      symptomsFa: body.symptomsFa || null, symptomsEn: body.symptomsEn || null, expertNotes: body.expertNotes || null,
    },
  })
  await audit(req, auth.user.id, 'CREATE_DISEASE', 'Disease', d.id, null, { code: d.code })
  return ok({ disease: d })
}

// PATCH /api/v1/admin/diseases — update / deactivate
export async function PATCH(req: NextRequest) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  if (!['ADMIN'].includes(auth.user.role)) return fail('دسترسی غیرمجاز', 403)
  const body = await req.json().catch(() => ({}))
  const d = await db.disease.findUnique({ where: { id: String(body.id || '') } })
  if (!d) return fail('بیماری یافت نشد', 404)
  const data: Record<string, unknown> = {}
  for (const k of ['nameFa', 'nameEn', 'category', 'descriptionFa', 'descriptionEn', 'symptomsFa', 'symptomsEn', 'expertNotes']) {
    if (body[k] !== undefined) data[k] = body[k]
  }
  if (body.active !== undefined) { data.active = Boolean(body.active); if (!body.active) data.deletedAt = new Date() }
  await db.disease.update({ where: { id: d.id }, data })
  await audit(req, auth.user.id, 'EDIT_DISEASE', 'Disease', d.id, { active: d.active }, data)
  return ok()
}
