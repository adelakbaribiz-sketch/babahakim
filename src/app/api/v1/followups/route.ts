import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { getAuth } from '@/lib/auth'
import { executeTransition } from '@/lib/workflow'

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
// Phase 02: status changes run through the FOLLOWUP machine (guarded + audited).
export async function PATCH(req: NextRequest) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  const body = await req.json().catch(() => ({}))
  const f = await db.followUp.findUnique({ where: { id: String(body.id || '') } })
  if (!f) return fail('پیگیری یافت نشد', 404)

  const actor = { id: auth.user.id, role: auth.user.role as never }
  const STATUS_ACTION: Record<string, string> = {
    COMPLETED: 'COMPLETE', CANCELLED: 'CANCEL', DUE: 'MARK_DUE', OVERDUE: 'MARK_OVERDUE',
  }

  // non-status note updates go directly
  const info: Record<string, unknown> = {}
  if (body.note !== undefined) info.note = body.note
  if (body.resultNote !== undefined && !body.status) info.resultNote = body.resultNote
  if (Object.keys(info).length > 0) {
    await db.followUp.update({ where: { id: f.id }, data: info })
  }

  const action = STATUS_ACTION[String(body.status || '')]
  if (action) {
    const res = await executeTransition({
      machine: 'FOLLOWUP', entityId: f.id, action, actor,
      payload: { note: body.note ?? body.resultNote ?? '', reason: String(body.reason || body.note || '') }, req,
    })
    if (!res.ok) return fail(res.error, res.httpStatus, res.details)
  }
  return ok()
}
