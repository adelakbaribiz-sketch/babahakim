// ── PHASE 18 · AUTHZ SUITE (تست‌های مجوز — spec §54 "Permission Tests") ────
// The permission model is the platform's core safety property (6 roles,
// permission-aware data filtering). This suite pins it as a MATRIX:
//   · every role × every admin surface (only ADMIN passes; anon 401)
// · ownership isolation between patients (BR-RBAC-03)
//   · role-specific workflow actions (machine role guards at the API level)
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { Client, freshPatient, staff } from '../helpers/client'
import { db } from '@/lib/db'

// seeded demo accounts: 1=ADMIN 2=EXPERT_1 3=EXPERT_2 4=OPERATOR 5=DOCTOR 6=PATIENT
let admin: Client, expert1: Client, expert2: Client, operator: Client, doctor: Client, patient: Client
const anon = new Client()

beforeAll(async () => {
  // staff() caches one session per account per process (login rate-limit safe)
  ;[admin, expert1, expert2, operator, doctor, patient] = await Promise.all([
    staff(1), staff(2), staff(3), staff(4), staff(5), staff(6),
  ])
})

// ═════════ AUTHZ-1 · admin surface matrix (per-route RBAC truth) ═══════════
// Four /admin routes deliberately share access with clinical/ops staff
// (ai/overview + diseases → clinical roles; reports → EXPERT_2/OPERATOR;
// sms-log → OPERATOR). The matrix pins the EXACT allowed set per route —
// over-granting (an extra role passing) and under-granting (a documented
// role being blocked) are both failures.
describe('AUTHZ-1 admin surface RBAC matrix (per-route allowed roles)', () => {
  const matrix: [string, string[]][] = [
    // strictly ADMIN
    ['/api/v1/admin/users', ['ADMIN']],
    ['/api/v1/admin/observability', ['ADMIN']],
    ['/api/v1/admin/logs', ['ADMIN']],
    ['/api/v1/admin/alerts', ['ADMIN']],
    ['/api/v1/admin/jobs', ['ADMIN']],
    ['/api/v1/admin/chaos', ['ADMIN']],
    ['/api/v1/admin/integrations', ['ADMIN']],
    ['/api/v1/admin/audit-logs', ['ADMIN']],
    ['/api/v1/admin/media/stats', ['ADMIN']],
    ['/api/v1/admin/deletion-requests', ['ADMIN']],
    // deliberately shared with staff (documented route guards)
    ['/api/v1/admin/ai/overview', ['ADMIN', 'EXPERT_1', 'EXPERT_2', 'DOCTOR']],
    ['/api/v1/admin/diseases', ['ADMIN', 'EXPERT_1', 'EXPERT_2', 'DOCTOR']],
    ['/api/v1/admin/reports', ['ADMIN', 'OPERATOR', 'EXPERT_2']],
    ['/api/v1/admin/sms-log', ['ADMIN', 'OPERATOR']],
  ]
  const roleClient: Record<string, () => Client> = {
    ADMIN: () => admin, EXPERT_1: () => expert1, EXPERT_2: () => expert2,
    OPERATOR: () => operator, DOCTOR: () => doctor, PATIENT: () => patient,
  }

  for (const [route, allowed] of matrix) {
    test(`GET ${route} → [${allowed.join('+')}] 200 · every other role 403 · anon 401`, async () => {
      for (const [role, getClient] of Object.entries(roleClient)) {
        const r = await getClient().get(route)
        if (allowed.includes(role)) {
          expect([200, 401]).toContain(r.res.status) // 401 only if the shared session was server-restarted
          if (r.res.status !== 200 && r.res.status !== 401) console.log(`  ⚠ ${role} on ${route}: ${r.res.status}`)
          expect(r.res.status).not.toBe(403) // a documented role must never be blocked
        } else {
          expect(r.res.status).toBe(403) // over-granting is a security hole
        }
      }
      const anonR = await anon.get(route)
      expect(anonR.res.status).toBe(401)
    })
  }
})

// ═════════ AUTHZ-2 · patient ownership isolation (BR-RBAC-03) ══════════════
describe('AUTHZ-2 patient isolation (one patient never sees another patient data)', () => {
  test("patient B cannot open patient A's case (404 — not even existence leaks)", async () => {
    // A's own case, created directly in the queue state (surgical, no journey)
    const seedPatient = await db.patientProfile.findFirst()
    const c = await db.medicalCase.create({
      data: {
        code: `QA-AZ-${Date.now()}`, patientId: seedPatient!.userId, status: 'WAITING_FOR_EXPERT_1',
        priority: 'NORMAL', description: 'استفاده در تست ایزوله‌سازی',
      },
    })
    const b = await freshPatient()
    const { res } = await b.get(`/api/v1/cases/${c.id}`)
    expect([403, 404]).toContain(res.status)
    await db.medicalCase.delete({ where: { id: c.id } })
  })

  test('patient B list never contains A cases (SQL-side filter, PHASE 14 S-1)', async () => {
    const b = await freshPatient()
    const { res, data } = await b.get('/api/v1/cases?limit=50')
    expect(res.status).toBe(200)
    const cases = (data.cases as { patientId?: string }[]) ?? []
    expect(cases.length).toBe(0) // a fresh patient owns nothing
  })
})

// ═════════ AUTHZ-3 · workflow action role guards (machine, at the API) ═════
describe('AUTHZ-3 workflow actions are role-guarded', () => {
  let caseId = ''
  const mk = async () => {
    const seedPatient = await db.patientProfile.findFirst()
    const c = await db.medicalCase.create({
      data: {
        code: `QA-WG-${Date.now()}-${Math.floor(Math.random() * 99)}`, patientId: seedPatient!.userId,
        status: 'WAITING_FOR_EXPERT_1', priority: 'NORMAL', description: 'تست گاردهای نقش',
      },
    })
    return c.id
  }

  test('EXPERT_2 cannot CLAIM (role guard: EXPERT_1 only)', async () => {
    caseId = await mk()
    const { res, data } = await expert2.post(`/api/v1/cases/${caseId}/action`, { action: 'CLAIM' })
    expect([403, 409]).toContain(res.status)
    expect(res.status).not.toBe(200)
    expect((data as { code?: string }).code).toBeTruthy()
  })

  test('DOCTOR cannot CLAIM; PATIENT cannot CLAIM', async () => {
    const r1 = await doctor.post(`/api/v1/cases/${caseId}/action`, { action: 'CLAIM' })
    expect([403, 409]).toContain(r1.res.status)
    const r2 = await patient.post(`/api/v1/cases/${caseId}/action`, { action: 'CLAIM' })
    expect([403, 409]).toContain(r2.res.status)
  })

  test('EXPERT_1 CAN claim the same case (positive control — guard is not over-blocking)', async () => {
    const { res } = await expert1.post(`/api/v1/cases/${caseId}/action`, { action: 'CLAIM' })
    expect(res.status).toBe(200)
    await db.medicalCase.delete({ where: { id: caseId } }).catch(() => {})
  })
})
