// ── BabaHakim Backend · Application Service: Dashboard (PHASE 08) ─────────
// Role-scoped read model (CQRS-lite, ARCHITECTURE §8). Cached briefly (ED-98)
// — dashboards tolerate 15s staleness by design.
//
// PHASE 16 (ED-184): measured cold build = 21 queries/user, and the staff
// stats are IDENTICAL for every staff user (17 counts + 2 aggregates are
// role-global). Batching + scope-keyed caching:
//   • 6 medicalCase counts + 3 order counts → 2 groupBy(status) queries
//   • staff-shared block cached ONCE per process (not per user)
//   • queue cached per role; per-request work left = 1 unreadSelf count
// Baseline: 21 queries / 35.8ms cold. After: 9 queries shared / 1 per user.
import { db } from '@/lib/db'
import type { AuthContext } from '@/lib/auth'
import { parseJSON } from '@/lib/api'
import { cached, cacheKeys, cacheTtl } from '@/server/infrastructure/cache'

export async function getDashboard(auth: AuthContext) {
  if (auth.user.role === 'PATIENT') {
    return cached(cacheKeys.dashboard('PATIENT', auth.user.id), cacheTtl.dashboard, () =>
      buildPatientDashboard(auth.user.id),
    )
  }
  return buildStaffDashboard(auth)
}

// ── patient dashboard (per-user, batched counts) ─────────────────────────────
async function buildPatientDashboard(userId: string) {
  const [cases, orders, tickets, notifications, lastMizaj] = await Promise.all([
    db.medicalCase.findMany({ where: { patientId: userId }, orderBy: { createdAt: 'desc' }, take: 5, include: { images: { select: { id: true } } } }),
    db.order.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 5, include: { items: true } }),
    db.ticket.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' }, take: 3 }),
    db.notification.findMany({ where: { userId, read: false }, take: 5, orderBy: { createdAt: 'desc' } }),
    db.questionnaireResponse.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } }),
  ])
  // ED-184: two case counts (total + active) batched into one grouped read
  const [caseStatuses, totalOrders] = await Promise.all([
    db.medicalCase.groupBy({ by: ['status'], where: { patientId: userId }, _count: { _all: true } }),
    db.order.count({ where: { userId } }),
  ])
  const totalCases = caseStatuses.reduce((a, g) => a + g._count._all, 0)
  const activeCases = caseStatuses
    .filter((g) => !['CLOSED', 'CANCELLED'].includes(g.status))
    .reduce((a, g) => a + g._count._all, 0)
  return {
    role: 'PATIENT',
    stats: {
      totalCases, activeCases, totalOrders,
      openTickets: tickets.filter((t) => !['RESOLVED', 'CLOSED'].includes(t.status)).length,
    },
    cases, orders, tickets, notifications, lastMizaj,
  }
}

// ── staff dashboard (shared stats + role queue + 1 per-user count) ──────────
async function buildStaffDashboard(auth: AuthContext) {
  const role = auth.user.role
  const [shared, queue, unreadSelf] = await Promise.all([
    cached(cacheKeys.dashShared(), cacheTtl.dashboard, buildStaffShared),
    cached(cacheKeys.dashQueue(role), cacheTtl.dashboard, () => buildQueueFor(role)),
    db.notification.count({ where: { userId: auth.user.id, read: false } }),
  ])
  return {
    role,
    stats: { ...shared.stats, unreadSelf },
    queue: queue.map((c) => ({ ...c, waitingHours: Math.round((Date.now() - c.createdAt.getTime()) / 36e5), mizajSnapshot: parseJSON(c.mizajSnapshot, null) })),
    recentEvents: shared.recentEvents,
  }
}

/** Staff-wide read model — one cached build serves every staff user for 15s. */
async function buildStaffShared() {
  // ED-184 batching: 6 status counts + 3 order counts → 2 grouped reads
  const [caseStatuses, orderStatuses, followups, openTickets, totalPatients, totalProducts, lowStock,
    images, analyses, income, expense, recentEvents] = await Promise.all([
    db.medicalCase.groupBy({ by: ['status'], _count: { _all: true } }),
    db.order.groupBy({ by: ['status'], _count: { _all: true } }),
    db.followUp.count({ where: { status: { in: ['PENDING', 'DUE', 'OVERDUE'] } } }),
    db.ticket.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING_USER', 'WAITING_EXPERT'] } } }),
    db.user.count({ where: { role: 'PATIENT' } }),
    db.product.count({ where: { active: true, deletedAt: null } }),
    db.product.count({ where: { stock: { lte: 5 }, active: true, deletedAt: null } }),
    db.medicalImage.count(),
    db.aIAnalysis.count(),
    db.financialTransaction.aggregate({ where: { type: 'INCOME' }, _sum: { amount: true } }),
    db.financialTransaction.aggregate({ where: { type: 'EXPENSE' }, _sum: { amount: true } }),
    db.caseEvent.findMany({
      orderBy: { createdAt: 'desc' }, take: 12,
      include: { case: { select: { code: true } }, actor: { select: { firstName: true, lastName: true, role: true } } },
    }),
  ])
  const cc = Object.fromEntries(caseStatuses.map((g) => [g.status, g._count._all]))
  const oc = Object.fromEntries(orderStatuses.map((g) => [g.status, g._count._all]))
  const c = (s: string) => cc[s] ?? 0
  const o = (s: string) => oc[s] ?? 0
  return {
    stats: {
      totalCases: caseStatuses.reduce((a, g) => a + g._count._all, 0),
      totalPatients, pendingExpert1: c('WAITING_FOR_EXPERT_1'), pendingExpert2: c('WAITING_FOR_EXPERT_2'),
      pendingDoctor: c('WAITING_FOR_DOCTOR'), proformas: c('WAITING_FOR_USER_CONFIRMATION'),
      awaitingPayment: c('WAITING_FOR_PAYMENT'), paidOrders: o('PAID'), shipped: o('SHIPPED'),
      delivered: o('DELIVERED'), followups, openTickets, totalProducts, lowStock, images, analyses,
      revenue: income._sum.amount || 0, expenses: expense._sum.amount || 0,
      profit: (income._sum.amount || 0) - (expense._sum.amount || 0),
    },
    recentEvents,
  }
}

async function buildQueueFor(role: string) {
  return db.medicalCase.findMany({
    where: role === 'EXPERT_1' ? { status: 'WAITING_FOR_EXPERT_1' }
      : role === 'EXPERT_2' ? { status: 'WAITING_FOR_EXPERT_2' }
      : role === 'DOCTOR' ? { status: 'WAITING_FOR_DOCTOR' }
      : { status: { notIn: ['CLOSED', 'CANCELLED'] } },
    orderBy: { createdAt: 'asc' }, take: 10,
    include: { patient: { select: { firstName: true, lastName: true, phone: true } } },
  })
}
