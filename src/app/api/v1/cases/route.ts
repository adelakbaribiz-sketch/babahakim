import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, audit, genCode, parseJSON } from '@/lib/api'
import { getAuth } from '@/lib/auth'
import { notify } from '@/lib/notify'

// GET /api/v1/cases?status=&q=&page= — role-scoped queue/list
export async function GET(req: NextRequest) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  const url = new URL(req.url)
  const status = url.searchParams.get('status') || ''
  const q = url.searchParams.get('q') || ''

  const where: Record<string, unknown> = { deletedAt: null }
  if (status) where.status = status
  if (auth.user.role === 'PATIENT') where.patientId = auth.user.id

  const cases = await db.medicalCase.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
      expert1: { select: { firstName: true, lastName: true } },
      expert2: { select: { firstName: true, lastName: true } },
      doctor: { select: { firstName: true, lastName: true } },
      images: { select: { id: true, type: true, status: true, createdAt: true } },
      _count: { select: { prescriptions: true, invoices: true } },
    },
  })

  let filtered = cases
  if (q) {
    const { textMatches } = await import('@/lib/api')
    filtered = cases.filter((c) => textMatches(q, c.code, c.patient.firstName, c.patient.lastName, c.patient.phone, c.status))
  }

  return ok({
    cases: filtered.map((c) => ({
      ...c,
      mizajSnapshot: parseJSON(c.mizajSnapshot, null),
      waitingHours: Math.round((Date.now() - c.createdAt.getTime()) / 36e5),
    })),
  })
}

// POST /api/v1/cases — patient creates case: { description, imageId, mizaj }
export async function POST(req: NextRequest) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  if (auth.user.role !== 'PATIENT' && auth.user.role !== 'ADMIN') return fail('فقط کاربران بیمار می‌توانند پرونده ایجاد کنند', 403)

  const body = await req.json().catch(() => null)
  if (!body) return fail('درخواست نامعتبر')
  const description = String(body.description || '').trim()
  const imageId = body.imageId as string | undefined
  const priority = ['LOW', 'NORMAL', 'HIGH', 'URGENT'].includes(body.priority) ? body.priority : 'NORMAL'
  if (!description) return fail('شرح حال (توضیح مشکل) الزامی است')
  if (!imageId) return fail('برای ایجاد پرونده، ابتدا تصویر زبان را بارگذاری کنید')

  const image = await db.medicalImage.findUnique({ where: { id: imageId } })
  if (!image || image.ownerId !== auth.user.id) return fail('تصویر یافت نشد یا متعلق به شما نیست', 404)
  if (image.type !== 'TONGUE') return fail('تصویر باید از نوع زبان باشد')
  if (image.status !== 'VALIDATED') return fail('کیفیت تصویر تأیید نشده است؛ لطفاً تصویر جدیدی ارسال کنید')

  const lastMizaj = await db.questionnaireResponse.findFirst({ where: { userId: auth.user.id }, orderBy: { createdAt: 'desc' } })
  if (!lastMizaj) return fail('قبل از ایجاد پرونده، پرسشنامه مزاج‌شناسی را تکمیل کنید', 400)

  const profile = await db.patientProfile.findUnique({ where: { userId: auth.user.id } })
  const mizajSnapshot = {
    mizajFa: lastMizaj.mizajFa, mizajEn: lastMizaj.mizajEn,
    scores: parseJSON(lastMizaj.scores, {}),
    province: profile?.province || null, city: profile?.city || null,
  }

  const c = await db.medicalCase.create({
    data: {
      code: genCode('TC'), patientId: auth.user.id, status: 'WAITING_FOR_EXPERT_1',
      priority, description, mizajSnapshot: JSON.stringify(mizajSnapshot),
    },
  })
  await db.medicalImage.update({ where: { id: imageId }, data: { caseId: c.id } })
  await db.caseEvent.create({ data: { caseId: c.id, actorId: auth.user.id, action: 'STATUS_CHANGE', fromStatus: 'NEW', toStatus: 'WAITING_FOR_EXPERT_1', comment: 'ایجاد پرونده و ورود به صف کارشناسان' } })
  if (image.aiPath) {
    // trigger AI analysis immediately (synchronous for SQLite simplicity, logged as job)
    try {
      const { runAIAnalysis } = await import('@/lib/ai/run')
      await runAIAnalysis(c.id, image.id)
      await db.caseEvent.create({ data: { caseId: c.id, action: 'AI_RUN', comment: 'تحلیل اولیه توسط TongueModelV1 انجام شد' } })
    } catch (e) {
      console.error('AI pipeline error', e)
    }
  }

  await notify(auth.user.id, 'CASE_IN_QUEUE', { link: `/cases/${c.id}`, sms: true, phone: auth.user.phone })
  const experts = await db.user.findMany({ where: { role: 'EXPERT_1', isActive: true }, select: { id: true } })
  for (const e of experts) await notify(e.id, 'ASSIGNED_EXPERT', { link: `/cases/${c.id}`, extraFa: c.code })
  await audit(req, auth.user.id, 'CREATE_CASE', 'MedicalCase', c.id, null, { code: c.code })

  return ok({ case: { id: c.id, code: c.code, status: c.status } })
}
