// ── BabaHakim Backend · Application Service: Dashboard (PHASE 08) ─────────
// Role-scoped read model (CQRS-lite, ARCHITECTURE §8). Cached briefly (ED-98)
// — dashboards tolerate 15s staleness by design.
import { db } from '@/lib/db'
import type { AuthContext } from '@/lib/auth'
import { parseJSON } from '@/lib/api'
import { cached, cacheKeys, cacheTtl } from '@/server/infrastructure/cache'

export async function getDashboard(auth: AuthContext) {
  return cached(cacheKeys.dashboard(auth.user.role, auth.user.id), cacheTtl.dashboard, () =>
    buildDashboard(auth.user.role, auth.user.id),
  )
}

async function buildDashboard(role: string, userId: string) {
  if (role === 'PATIENT') {
    const [cases, orders, tickets, notifications, lastMizaj] = await Promise.all([
      db.medicalCase.findMany({ where: { patientId: userId }, orderBy: { createdAt: 'desc' }, take: 5, include: { images: { select: { id: true } } } }),
      db.order.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 5, include: { items: true } }),
      db.ticket.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' }, take: 3 }),
      db.notification.findMany({ where: { userId, read: false }, take: 5, orderBy: { createdAt: 'desc' } }),
      db.questionnaireResponse.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    ])
    const [totalCases, activeCases, totalOrders] = await Promise.all([
      db.medicalCase.count({ where: { patientId: userId } }),
      db.medicalCase.count({ where: { patientId: userId, status: { notIn: ['CLOSED', 'CANCELLED'] } } }),
      db.order.count({ where: { userId } }),
    ])
    return {
      role,
      stats: {
        totalCases, activeCases, totalOrders,
        openTickets: tickets.filter((t) => !['RESOLVED', 'CLOSED'].includes(t.status)).length,
      },
      cases, orders, tickets, notifications, lastMizaj,
    }
  }

  // staff dashboards
  const [totalCases, totalPatients, pendingExpert1, pendingExpert2, pendingDoctor, proformas, awaitingPayment,
    paidOrders, shipped, delivered, followups, openTickets, totalProducts, lowStock, images, analyses, unreadSelf] = await Promise.all([
    db.medicalCase.count(),
    db.user.count({ where: { role: 'PATIENT' } }),
    db.medicalCase.count({ where: { status: 'WAITING_FOR_EXPERT_1' } }),
    db.medicalCase.count({ where: { status: 'WAITING_FOR_EXPERT_2' } }),
    db.medicalCase.count({ where: { status: 'WAITING_FOR_DOCTOR' } }),
    db.medicalCase.count({ where: { status: 'WAITING_FOR_USER_CONFIRMATION' } }),
    db.medicalCase.count({ where: { status: 'WAITING_FOR_PAYMENT' } }),
    db.order.count({ where: { status: 'PAID' } }),
    db.order.count({ where: { status: 'SHIPPED' } }),
    db.order.count({ where: { status: 'DELIVERED' } }),
    db.followUp.count({ where: { status: { in: ['PENDING', 'DUE', 'OVERDUE'] } } }),
    db.ticket.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING_USER', 'WAITING_EXPERT'] } } }),
    db.product.count({ where: { active: true, deletedAt: null } }),
    db.product.count({ where: { stock: { lte: 5 }, active: true, deletedAt: null } }),
    db.medicalImage.count(),
    db.aIAnalysis.count(),
    db.notification.count({ where: { userId, read: false } }),
  ])

  const income = await db.financialTransaction.aggregate({ where: { type: 'INCOME' }, _sum: { amount: true } })
  const expense = await db.financialTransaction.aggregate({ where: { type: 'EXPENSE' }, _sum: { amount: true } })
  const queue = await db.medicalCase.findMany({
    where: role === 'EXPERT_1' ? { status: 'WAITING_FOR_EXPERT_1' }
      : role === 'EXPERT_2' ? { status: 'WAITING_FOR_EXPERT_2' }
      : role === 'DOCTOR' ? { status: 'WAITING_FOR_DOCTOR' }
      : { status: { notIn: ['CLOSED', 'CANCELLED'] } },
    orderBy: { createdAt: 'asc' }, take: 10,
    include: { patient: { select: { firstName: true, lastName: true, phone: true } } },
  })
  const recentEvents = await db.caseEvent.findMany({
    orderBy: { createdAt: 'desc' }, take: 12,
    include: { case: { select: { code: true } }, actor: { select: { firstName: true, lastName: true, role: true } } },
  })

  return {
    role,
    stats: {
      totalCases, totalPatients, pendingExpert1, pendingExpert2, pendingDoctor,
      proformas, awaitingPayment, paidOrders, shipped, delivered,
      followups, openTickets, totalProducts, lowStock, images, analyses,
      revenue: income._sum.amount || 0, expenses: expense._sum.amount || 0,
      profit: (income._sum.amount || 0) - (expense._sum.amount || 0), unreadSelf,
    },
    queue: queue.map((c) => ({ ...c, waitingHours: Math.round((Date.now() - c.createdAt.getTime()) / 36e5), mizajSnapshot: parseJSON(c.mizajSnapshot, null) })),
    recentEvents,
  }
}
