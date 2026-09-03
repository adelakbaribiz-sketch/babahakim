import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, parseJSON } from '@/lib/api'
import { getAuth } from '@/lib/auth'

// GET /api/v1/dashboard — role-scoped dynamic dashboard data
export async function GET(req: NextRequest) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  const role = auth.user.role

  if (role === 'PATIENT') {
    const [cases, orders, tickets, notifications, lastMizaj] = await Promise.all([
      db.medicalCase.findMany({ where: { patientId: auth.user.id }, orderBy: { createdAt: 'desc' }, take: 5, include: { images: { select: { id: true } } } }),
      db.order.findMany({ where: { userId: auth.user.id }, orderBy: { createdAt: 'desc' }, take: 5, include: { items: true } }),
      db.ticket.findMany({ where: { userId: auth.user.id }, orderBy: { updatedAt: 'desc' }, take: 3 }),
      db.notification.findMany({ where: { userId: auth.user.id, read: false }, take: 5, orderBy: { createdAt: 'desc' } }),
      db.questionnaireResponse.findFirst({ where: { userId: auth.user.id }, orderBy: { createdAt: 'desc' } }),
    ])
    return ok({
      role,
      stats: {
        totalCases: await db.medicalCase.count({ where: { patientId: auth.user.id } }),
        activeCases: await db.medicalCase.count({ where: { patientId: auth.user.id, status: { notIn: ['CLOSED', 'CANCELLED'] } } }),
        totalOrders: await db.order.count({ where: { userId: auth.user.id } }),
        openTickets: tickets.filter((t) => !['RESOLVED', 'CLOSED'].includes(t.status)).length,
      },
      cases, orders, tickets, notifications, lastMizaj,
    })
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
    db.notification.count({ where: { userId: auth.user.id, read: false } }),
  ])

  // revenue & queue with wait times
  const income = await db.financialTransaction.aggregate({ where: { type: 'INCOME' }, _sum: { amount: true } })
  const expense = await db.financialTransaction.aggregate({ where: { type: 'EXPENSE' }, _sum: { amount: true } })
  const queue = await db.medicalCase.findMany({
    where: role === 'EXPERT_1' ? { status: 'WAITING_FOR_EXPERT_1' } : role === 'EXPERT_2' ? { status: 'WAITING_FOR_EXPERT_2' } : role === 'DOCTOR' ? { status: 'WAITING_FOR_DOCTOR' } : { status: { notIn: ['CLOSED', 'CANCELLED'] } },
    orderBy: { createdAt: 'asc' }, take: 10,
    include: { patient: { select: { firstName: true, lastName: true, phone: true } } },
  })

  const recentEvents = await db.caseEvent.findMany({
    orderBy: { createdAt: 'desc' }, take: 12,
    include: { case: { select: { code: true } }, actor: { select: { firstName: true, lastName: true, role: true } } },
  })

  return ok({
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
  })
}
