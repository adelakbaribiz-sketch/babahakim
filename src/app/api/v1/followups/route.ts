import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { getAuth } from '@/lib/auth'

// GET /api/v1/followups — staff: all (Due Today/Overdue/Upcoming); patient: own
export async function GET(req: NextRequest) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  const where = auth.user.role === 'PATIENT' ? { patientId: auth.user.id } : {}
  const items = await db.followUp.findMany({
    where, orderBy: { dueDate: 'asc' }, take: 200,
    include: {
      case: { select: { code: true, status: true } },
      patient: { select: { firstName: true, lastName: true, phone: true } },
      completedBy: { select: { firstName: true, lastName: true } },
    },
  })
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const tomorrow = new Date(today.getTime() + 864e5)
  const enriched = items.map((f) => ({
    ...f,
    bucket: f.status === 'COMPLETED' ? 'COMPLETED' : f.dueDate < today ? 'OVERDUE' : f.dueDate < tomorrow ? 'DUE_TODAY' : 'UPCOMING',
  }))
  return ok({
    followups: enriched,
    counts: {
      dueToday: enriched.filter((f) => f.bucket === 'DUE_TODAY').length,
      overdue: enriched.filter((f) => f.bucket === 'OVERDUE').length,
      upcoming: enriched.filter((f) => f.bucket === 'UPCOMING').length,
      completed: enriched.filter((f) => f.bucket === 'COMPLETED').length,
    },
  })
}

// PATCH /api/v1/followups {id, status, note}
export async function PATCH(req: NextRequest) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  const body = await req.json().catch(() => ({}))
  const f = await db.followUp.findUnique({ where: { id: String(body.id || '') } })
  if (!f) return fail('پیگیری یافت نشد', 404)
  const data: Record<string, unknown> = {}
  if (body.status && ['PENDING', 'DUE', 'COMPLETED', 'CANCELLED'].includes(body.status)) {
    data.status = body.status
    if (body.status === 'COMPLETED') { data.completedAt = new Date(); data.completedById = auth.user.id }
  }
  if (body.note !== undefined) data.note = body.note
  if (body.resultNote !== undefined) data.resultNote = body.resultNote
  await db.followUp.update({ where: { id: f.id }, data })
  return ok()
}
