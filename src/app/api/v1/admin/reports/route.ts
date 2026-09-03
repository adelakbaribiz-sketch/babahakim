import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, fail, parseJSON } from '@/lib/api'
import { getAuth } from '@/lib/auth'

// GET /api/v1/admin/reports?from=&to=&groupBy=day
export async function GET(req: NextRequest) {
  const auth = await getAuth()
  if (!auth) return fail('احراز هویت لازم است', 401)
  if (!['ADMIN', 'OPERATOR', 'EXPERT_2'].includes(auth.user.role)) return fail('دسترسی غیرمجاز', 403)

  const [payments, expenses, orders, cases, products, referrals, users] = await Promise.all([
    db.payment.findMany({ where: { status: 'PAID' }, include: { order: { include: { items: true } }, user: { select: { firstName: true, lastName: true, referralCode: true } } } }),
    db.financialTransaction.findMany({ where: { type: 'EXPENSE' } }),
    db.order.findMany({ include: { items: true } }),
    db.medicalCase.findMany({ select: { id: true, status: true, createdAt: true, patientId: true } }),
    db.product.findMany({ select: { id: true, nameFa: true, currentPrice: true, purchasePrice: true, sku: true } }),
    db.referral.findMany({ include: { referrer: { select: { firstName: true, lastName: true, referralCode: true } }, referredUser: { select: { firstName: true, lastName: true } } } }),
    db.user.findMany({ where: { role: 'PATIENT' }, select: { id: true, firstName: true, lastName: true, createdAt: true, profile: { select: { province: true, city: true } } } }),
  ])

  const income = payments.reduce((s, p) => s + p.amount, 0)
  const expenseTotal = expenses.reduce((s, e) => s + e.amount, 0)

  // revenue by day (last 14 days)
  const byDay: Record<string, number> = {}
  for (let d = 13; d >= 0; d--) {
    const day = new Date(Date.now() - d * 864e5)
    const key = day.toISOString().slice(0, 10)
    byDay[key] = 0
  }
  for (const p of payments) {
    const key = p.createdAt.toISOString().slice(0, 10)
    if (byDay[key] !== undefined) byDay[key] += p.amount
  }

  // top products by sales
  const productSales: Record<string, { name: string; count: number; revenue: number }> = {}
  for (const o of orders) {
    if (!['PAID', 'SHIPPED', 'DELIVERED', 'PREPARING', 'READY_TO_SHIP'].includes(o.status)) continue
    for (const it of o.items) {
      const k = it.productId || it.nameFa
      productSales[k] = productSales[k] || { name: it.nameFa, count: 0, revenue: 0 }
      productSales[k].count += it.quantity
      productSales[k].revenue += it.total
    }
  }
  const topProducts = Object.values(productSales).sort((a, b) => b.revenue - a.revenue).slice(0, 10)

  // cases by status
  const statusCounts: Record<string, number> = {}
  for (const c of cases) statusCounts[c.status] = (statusCounts[c.status] || 0) + 1

  // referral performance
  const referralStats = referrals.map((r) => {
    const referredOrders = orders.filter((o) => o.userId === r.referredUserId && ['PAID', 'SHIPPED', 'DELIVERED'].includes(o.status))
    const revenue = referredOrders.reduce((s, o) => s + o.total, 0)
    return { referrer: `${r.referrer.firstName} ${r.referrer.lastName}`, code: r.referrer.referralCode, referredUser: `${r.referredUser.firstName} ${r.referredUser.lastName}`, orders: referredOrders.length, revenue, commission: Math.round(revenue * 0.05) }
  })

  // users by province
  const provinceStats: Record<string, number> = {}
  for (const u of users) {
    const prov = u.profile?.province || 'نامشخص'
    provinceStats[prov] = (provinceStats[prov] || 0) + 1
  }

  return ok({
    summary: { income, expenses: expenseTotal, profit: income - expenseTotal, paidCount: payments.length, failedCount: await db.payment.count({ where: { status: { in: ['FAILED', 'REJECTED'] } } }), refundTotal: payments.filter((p) => p.status === 'REFUNDED').reduce((s, p) => s + p.amount, 0) },
    byDay: Object.entries(byDay).map(([date, amount]) => ({ date, amount })),
    topProducts, statusCounts, referralStats, provinceStats,
    recentPayments: payments.slice(-15).reverse().map((p) => ({ code: p.code, amount: p.amount, method: p.method, refNumber: p.refNumber, user: `${p.user.firstName} ${p.user.lastName}`, createdAt: p.createdAt })),
  })
}
