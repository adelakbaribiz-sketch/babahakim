import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { getAuth } from '@/lib/auth'

// GET /api/v1/notifications
export async function GET(req: NextRequest) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  const items = await db.notification.findMany({ where: { userId: auth.user.id }, orderBy: { createdAt: 'desc' }, take: 50 })
  return ok({ notifications: items, unread: items.filter((n) => !n.read).length })
}

// PATCH /api/v1/notifications {id?} — mark one/all read
export async function PATCH(req: NextRequest) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  const body = await req.json().catch(() => ({}))
  if (body.id) {
    await db.notification.updateMany({ where: { id: String(body.id), userId: auth.user.id }, data: { read: true } })
  } else {
    await db.notification.updateMany({ where: { userId: auth.user.id, read: false }, data: { read: true } })
  }
  return ok()
}
