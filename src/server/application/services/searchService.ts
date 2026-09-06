// ── BabaHakim Backend · Application Service: Global Search (PHASE 14) ─────
// One endpoint, entity-scoped by ROLE + PERMISSIONS (ED-157):
//   PATIENT   → own cases/orders/tickets + public catalog + diseases
//   staff     → catalog + cases (view_all_cases) + queue orders (manage_orders)
//               + users (manage_users) + tickets (manage_tickets) + diseases
// Every entity query is SQL-side (ED-151 needles), capped at 5 rows and runs
// inside the report wall-clock budget — a global search must never become a
// cross-table unbounded scan (ED-153).
import { db } from '@/lib/db'
import type { AuthContext } from '@/lib/auth'
import { applyQ } from '@/server/infrastructure/search/query-build'
import { withReportTimeout, SEARCH_LIMITS } from '@/server/infrastructure/search'
import { rateLimit } from '@/lib/security/rate-limit'
import { RateLimitError } from '@/server/core/errors'
import { buildNeedles } from '@/server/infrastructure/search/normalize'

const PER_GROUP = 5

export interface SearchHit {
  id: string
  title: string
  subtitle?: string
  kind: 'case' | 'product' | 'user' | 'order' | 'ticket' | 'disease'
  extra?: Record<string, unknown>
}

export interface GlobalSearchResult {
  q: string
  tokensDropped: number
  groups: { kind: SearchHit['kind']; hits: SearchHit[] }[]
  ms: number
}

/**
 * Endpoint entry (thin routes call this): enforces the per-user+IP search
 * budget (60/min, ED-153 spirit) then delegates to the scoped search.
 */
export async function searchEndpoint(auth: AuthContext, ip: string, qRaw: string): Promise<GlobalSearchResult> {
  const rl = rateLimit(`search:${auth.user.id}:${ip}`, 60, 60_000)
  if (!rl.allowed) {
    throw new RateLimitError('جستجو بیش از حد مکرر است؛ کمی بعد تلاش کنید', { retryAfterSec: rl.retryAfterSec })
  }
  const q = (qRaw || '').trim().slice(0, SEARCH_LIMITS.maxQ)
  return globalSearch(auth, q)
}

export async function globalSearch(auth: AuthContext, q: string): Promise<GlobalSearchResult> {
  const start = Date.now()
  const needles = buildNeedles(q)
  const tokensDropped = Math.max(0, (q.trim().split(/[^\p{L}\p{N}]+/u).filter(Boolean).length) - needles.length)
  const result: GlobalSearchResult = { q, tokensDropped, groups: [], ms: 0 }
  // server-side floor: 1-char queries are useless AND expensive (LIKE '%x%'
  // matches most rows) — the client debounces, the server enforces the bound
  if (needles.length === 0 || q.trim().length < 2) {
    result.ms = Date.now() - start
    return result
  }

  const role = auth.user.role
  const isStaff = role !== 'PATIENT'
  const can = (p: string) => role === 'ADMIN' || auth.permissions.includes(p)
  const tasks: Promise<void>[] = []

  // ── products (everyone; public catalog, §25) ─────────────────────────────
  const { where: productWhere } = applyQ(q, ['nameFa', 'nameEn', 'brand', 'category', 'sku'])
  if (productWhere) {
    tasks.push(
      db.product.findMany({
        where: { active: true, deletedAt: null, ...(productWhere as Record<string, unknown>) },
        select: { id: true, nameFa: true, nameEn: true, brand: true, category: true, currentPrice: true, requiresPrescription: true },
        take: PER_GROUP,
        orderBy: { createdAt: 'desc' },
      }).then((rows) => {
        if (rows.length) result.groups.push({
          kind: 'product',
          hits: rows.map((p) => ({ id: p.id, kind: 'product', title: p.nameFa, subtitle: `${p.brand || ''} ${p.category || ''}`.trim() || p.nameEn, extra: { price: p.currentPrice, rx: p.requiresPrescription } })),
        })
      }),
    )
  }

  // ── diseases (everyone; reference data) ─────────────────────────────────
  const { where: diseaseWhere } = applyQ(q, ['nameFa', 'nameEn', 'code'])
  if (diseaseWhere) {
    tasks.push(
      db.disease.findMany({
        where: { deletedAt: null, ...(diseaseWhere as Record<string, unknown>) },
        select: { id: true, nameFa: true, nameEn: true, code: true },
        take: PER_GROUP,
      }).then((rows) => {
        if (rows.length) result.groups.push({
          kind: 'disease',
          hits: rows.map((d) => ({ id: d.id, kind: 'disease', title: d.nameFa, subtitle: d.code })),
        })
      }),
    )
  }

  // ── cases (patients: OWN only, ED-77; staff: view_all_cases) ────────────
  const { where: caseQ } = applyQ(q, ['code', 'status', 'patient.firstName', 'patient.lastName', 'patient.phone'])
  if (caseQ && (role === 'PATIENT' || can('view_all_cases'))) {
    const scope = role === 'PATIENT' ? { patientId: auth.user.id } : {}
    tasks.push(
      db.medicalCase.findMany({
        where: { deletedAt: null, ...scope, ...(caseQ as Record<string, unknown>) },
        select: { id: true, code: true, status: true, createdAt: true, patient: { select: { firstName: true, lastName: true } } },
        take: PER_GROUP,
        orderBy: { createdAt: 'desc' },
      }).then((rows) => {
        if (rows.length) result.groups.push({
          kind: 'case',
          hits: rows.map((c) => ({ id: c.id, kind: 'case', title: c.code, subtitle: isStaff ? `${c.patient.firstName} ${c.patient.lastName}` : c.status, extra: { status: c.status } })),
        })
      }),
    )
  }

  // ── orders (patients: OWN; staff with manage_orders) ────────────────────
  const { where: orderQ } = applyQ(q, ['code', 'status', 'user.firstName', 'user.lastName', 'user.phone'])
  if (orderQ && (role === 'PATIENT' ? true : can('manage_orders'))) {
    const scope = role === 'PATIENT' ? { userId: auth.user.id } : {}
    tasks.push(
      db.order.findMany({
        where: { ...scope, ...(orderQ as Record<string, unknown>) },
        select: { id: true, code: true, status: true, total: true, user: { select: { firstName: true, lastName: true } } },
        take: PER_GROUP,
        orderBy: { createdAt: 'desc' },
      }).then((rows) => {
        if (rows.length) result.groups.push({
          kind: 'order',
          hits: rows.map((o) => ({ id: o.id, kind: 'order', title: o.code, subtitle: isStaff ? `${o.user.firstName} ${o.user.lastName}` : o.status, extra: { status: o.status, total: o.total } })),
        })
      }),
    )
  }

  // ── users (manage_users only — ADMIN) ───────────────────────────────────
  const { where: userQ } = applyQ(q, ['firstName', 'lastName', 'phone', 'email', 'referralCode'])
  if (userQ && can('manage_users')) {
    tasks.push(
      db.user.findMany({
        where: { deletedAt: null, ...(userQ as Record<string, unknown>) },
        select: { id: true, firstName: true, lastName: true, phone: true, role: true },
        take: PER_GROUP,
      }).then((rows) => {
        if (rows.length) result.groups.push({
          kind: 'user',
          hits: rows.map((u) => ({ id: u.id, kind: 'user', title: `${u.firstName} ${u.lastName}`, subtitle: u.role })),
        })
      }),
    )
  }

  // ── tickets (patients: OWN; staff with manage_tickets) ──────────────────
  const { where: ticketQ } = applyQ(q, ['subject', 'code', 'user.firstName', 'user.lastName'])
  if (ticketQ && (role === 'PATIENT' || can('manage_tickets'))) {
    const scope = role === 'PATIENT' ? { userId: auth.user.id } : {}
    tasks.push(
      db.ticket.findMany({
        where: { ...scope, ...(ticketQ as Record<string, unknown>) },
        select: { id: true, subject: true, status: true, user: { select: { firstName: true, lastName: true } } },
        // user relation is selected explicitly (see select)
        take: PER_GROUP,
        orderBy: { createdAt: 'desc' },
      }).then((rows) => {
        if (rows.length) result.groups.push({
          kind: 'ticket',
          hits: rows.map((t) => ({ id: t.id, kind: 'ticket', title: t.subject, subtitle: isStaff ? `${t.user.firstName} ${t.user.lastName}` : t.status })),
        })
      }),
    )
  }

  // bounded fan-out: everything inside the report wall-clock budget (ED-153)
  await withReportTimeout(Promise.all(tasks))
  result.ms = Date.now() - start
  return result
}
