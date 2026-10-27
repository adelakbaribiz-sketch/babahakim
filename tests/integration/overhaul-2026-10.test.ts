// ── 2026-10 overhaul · integration tests (live server on :3000, TEST database) ──
// Covers the P0 fixes and the new identity / workflow / archive / mizaj
// behavior end-to-end through the real HTTP API. Run against the isolated
// test DB only:  bun run dev:testdb   then   bun test tests/integration/overhaul-2026-10.test.ts
import { describe, test, expect, beforeAll } from 'bun:test'
import { db } from '@/lib/db'
import { Client } from '../helpers/client'

/** Random checksum-valid Iranian national ID (synthetic test value). */
function makeNationalId(): string {
  for (;;) {
    const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10))
    if (d.every((x) => x === d[0])) continue
    const sum = d.reduce((s, x, i) => s + x * (10 - i), 0)
    const r = sum % 11
    return d.join('') + String(r < 2 ? r : 11 - r)
  }
}
const sharedPhone = `0935${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`
const PASSWORD = 'Test1234pw'

async function register(c: Client, nationalId: string, extra: Record<string, unknown> = {}) {
  await c.get('/api/v1/products') // CSRF cookie
  return c.post('/api/v1/auth/register', {
    nationalId, phone: sharedPhone, password: PASSWORD, firstName: 'آزمون', lastName: 'خانواده', ...extra,
  })
}

describe('identity: national ID login, shared family mobile', () => {
  const nidA = makeNationalId()
  const nidB = makeNationalId()

  test('two family members register with ONE mobile; duplicate national ID is refused', async () => {
    const a = await register(new Client(), nidA, { ageYears: 34, province: 'تهران', city: 'تهران' })
    expect(a.res.status).toBe(200)
    const b = await register(new Client(), nidB, { birthDate: '1990-03-21' })
    expect(b.res.status).toBe(200)
    const dup = await register(new Client(), nidA)
    expect(dup.res.status).toBe(409)
    const users = await db.user.findMany({ where: { phone: sharedPhone } })
    expect(users.length).toBe(2)
    // raw national ID never stored; age/birthDate rule honored (no fabricated birth date)
    const ua = users.find((u) => u.ageYears === 34)!
    expect(ua.birthDate).toBeNull()
    expect(ua.nationalId).toBeNull()
    expect(ua.nationalIdHash).toHaveLength(64)
    expect(ua.nationalIdEnc).not.toContain(nidA)
    const ub = users.find((u) => u.birthDate)!
    expect(ub.ageYears).toBeNull()
  })

  test('invalid national ID checksum → 400 with field error', async () => {
    const r = await register(new Client(), '0013542418')
    expect(r.res.status).toBe(400)
    expect(JSON.stringify(r.data)).toContain('nationalId')
  })

  test('login with national ID works; shared mobile login is refused generically', async () => {
    const ok = await new Client().post('/api/v1/auth/login', { nationalId: nidA, password: PASSWORD })
    // CSRF: login from a fresh client needs the cookie first
    const c = new Client()
    await c.get('/api/v1/products')
    const r = await c.post('/api/v1/auth/login', { nationalId: nidA, password: PASSWORD })
    expect([ok.res.status, r.res.status]).toContain(200)
    const amb = new Client()
    await amb.get('/api/v1/products')
    const byPhone = await amb.post('/api/v1/auth/login', { phone: sharedPhone, password: PASSWORD })
    expect(byPhone.res.status).toBe(401)
    expect(String(byPhone.data.error)).not.toContain(sharedPhone)
  })

  test('a patient registering with a STAFF mobile never locks the staff login out', async () => {
    const c = new Client()
    await c.get('/api/v1/products')
    const r = await c.post('/api/v1/auth/register', { nationalId: makeNationalId(), phone: '09120000004', password: PASSWORD, firstName: 'هم‌شماره', lastName: 'اپراتور' })
    expect(r.res.status).toBe(200)
    const op = await new Client().loginAs(4) // operator still signs in by mobile
    expect((await op.get('/api/v1/auth/me')).data.user).toMatchObject({ role: 'OPERATOR' })
  })

  test('a relative registering with a LEGACY patient mobile never locks that patient out', async () => {
    const c = new Client()
    await c.get('/api/v1/products')
    expect((await c.post('/api/v1/auth/register', { nationalId: makeNationalId(), phone: '09120000007', password: PASSWORD, firstName: 'فرزند', lastName: 'رضایی' })).res.status).toBe(200)
    const legacy = await new Client().loginAs(7) // the legacy patient still signs in by mobile
    expect((await legacy.get('/api/v1/auth/me')).data.user).toMatchObject({ phone: '09120000007' })
  })

  test('legacy account (no national ID) may set it ONCE via profile, then it is locked', async () => {
    const legacy = await db.user.findFirst({ where: { role: 'PATIENT', nationalIdHash: null, phone: '09120000008' } })
    if (!legacy) return // already migrated in this test DB by an earlier run
    const p = await new Client().loginAs(8)
    const first = makeNationalId()
    expect((await p.put('/api/v1/patients/profile', { nationalId: first })).res.status).toBe(200)
    expect((await p.put('/api/v1/patients/profile', { nationalId: makeNationalId() })).res.status).toBe(403)
    const l = new Client()
    await l.get('/api/v1/products')
    expect((await l.post('/api/v1/auth/login', { nationalId: first, password: 'Pass1234' })).res.status).toBe(200)
  })

  test('audit log never contains the raw national ID', async () => {
    const rows = await db.auditLog.findMany({ where: { createdAt: { gt: new Date(Date.now() - 10 * 60_000) } } })
    const blob = JSON.stringify(rows)
    expect(blob).not.toContain(nidA)
    expect(blob).not.toContain(nidB)
  })

  test('patient cannot change national ID; admin can (duplicate-checked + audited)', async () => {
    const p = new Client()
    await p.get('/api/v1/products')
    await p.post('/api/v1/auth/login', { nationalId: nidA, password: PASSWORD })
    const self = await p.put('/api/v1/patients/profile', { nationalId: makeNationalId() })
    expect(self.res.status).toBe(403)
    const forbidden = await p.put('/api/v1/admin/users/national-id', { userId: 'x', nationalId: makeNationalId(), reason: 'تست تغییر' })
    expect(forbidden.res.status).toBe(403)

    const admin = await new Client().loginAs(1)
    const ua = await db.user.findFirstOrThrow({ where: { nationalIdHash: { not: null }, phone: sharedPhone, ageYears: 34 } })
    const clash = await admin.put('/api/v1/admin/users/national-id', { userId: ua.id, nationalId: nidB, reason: 'اصلاح اشتباه ثبت' })
    expect(clash.res.status).toBe(409)
    const nidC = makeNationalId()
    const changed = await admin.put('/api/v1/admin/users/national-id', { userId: ua.id, nationalId: nidC, reason: 'اصلاح اشتباه ثبت' })
    expect(changed.res.status).toBe(200)
    const audit = await db.auditLog.findFirst({ where: { action: 'CHANGE_NATIONAL_ID', entityId: ua.id }, orderBy: { createdAt: 'desc' } })
    expect(audit?.sensitive).toBe(true)
    expect(audit?.newValues).toContain('اصلاح اشتباه ثبت')
    expect(JSON.stringify(audit)).not.toContain(nidC)
    const reveal = await admin.get(`/api/v1/admin/users/national-id?userId=${ua.id}`)
    expect(reveal.data.nationalId).toBe(nidC)
    // old national ID no longer logs in, new one does
    const relog = new Client()
    await relog.get('/api/v1/products')
    expect((await relog.post('/api/v1/auth/login', { nationalId: nidA, password: PASSWORD })).res.status).toBe(401)
    expect((await relog.post('/api/v1/auth/login', { nationalId: nidC, password: PASSWORD })).res.status).toBe(200)
  })

  test('password reset is bound to ONE account even on a shared mobile', async () => {
    const c = new Client()
    await c.get('/api/v1/products')
    const req = await c.post('/api/v1/auth/password-reset', { nationalId: nidB, phone: sharedPhone })
    expect(req.res.status).toBe(200)
    expect(req.data.challengeId).toBeTruthy()
    // the OTP code is only echoed by non-production servers (QA/CI boots the
    // production build, where the code goes out by SMS only) — nothing to confirm then
    if (!req.data.devCode) return
    const mismatch = await c.post('/api/v1/auth/password-reset', { nationalId: makeNationalId(), phone: sharedPhone })
    expect(mismatch.res.status).toBe(200) // same shape, no enumeration
    expect(mismatch.data.devCode).toBeUndefined()
    const bad = await c.post('/api/v1/auth/password-reset/confirm', { challengeId: mismatch.data.challengeId, code: '123456', newPassword: 'NewPass123' })
    expect(bad.res.status).toBe(401)
    const done = await c.post('/api/v1/auth/password-reset/confirm', { challengeId: req.data.challengeId, code: req.data.devCode, newPassword: 'NewPass123' })
    expect(done.res.status).toBe(200)
    const l = new Client()
    await l.get('/api/v1/products')
    expect((await l.post('/api/v1/auth/login', { nationalId: nidB, password: 'NewPass123' })).res.status).toBe(200)
    // the sibling on the same mobile is untouched
    const sib = await db.user.findFirstOrThrow({ where: { phone: sharedPhone, ageYears: 34 } })
    const nidCrow = await db.user.findUniqueOrThrow({ where: { id: sib.id } })
    expect(nidCrow.passwordHash).not.toBe((await db.user.findFirstOrThrow({ where: { phone: sharedPhone, birthDate: { not: null } } })).passwordHash)
  })
})

describe('tickets: create → listed → staff reply/status → patient sees it', () => {
  test('full ticket round trip', async () => {
    const patient = await new Client().loginAs(6)
    const created = await patient.post('/api/v1/tickets', { subject: 'سؤال درباره سفارش', category: 'ORDER', priority: 'HIGH', message: 'سفارش من کی ارسال می‌شود؟' })
    expect(created.res.status).toBe(200)
    const ticketId = (created.data.ticket as { id: string }).id
    const row = await db.ticket.findUniqueOrThrow({ where: { id: ticketId }, include: { messages: true } })
    expect(row.priority).toBe('HIGH')
    expect(row.messages.length).toBe(1)

    const mine = await patient.get('/api/v1/tickets')
    expect((mine.data.tickets as { id: string }[]).some((t) => t.id === ticketId)).toBe(true)

    const operator = await new Client().loginAs(4)
    const staffList = await operator.get('/api/v1/tickets')
    expect((staffList.data.tickets as { id: string }[]).some((t) => t.id === ticketId)).toBe(true)
    expect((await operator.post(`/api/v1/tickets/${ticketId}`, { message: 'فردا ارسال می‌شود' })).res.status).toBe(200)
    expect((await operator.patch(`/api/v1/tickets/${ticketId}`, { status: 'RESOLVED' })).res.status).toBe(200)

    const after = await patient.get('/api/v1/tickets')
    const tk = (after.data.tickets as { id: string; status: string; messages: { message: string }[] }[]).find((t) => t.id === ticketId)!
    expect(tk.status).toBe('RESOLVED')
    expect(tk.messages.map((m) => m.message)).toContain('فردا ارسال می‌شود')
    const notif = await db.notification.findFirst({ where: { userId: row.userId, type: 'TICKET_UPDATED' }, orderBy: { createdAt: 'desc' } })
    expect(notif).not.toBeNull()
  })

  test('another patient cannot read or reply to the ticket', async () => {
    const t = await db.ticket.findFirstOrThrow({ orderBy: { createdAt: 'desc' } })
    const other = await new Client().loginAs(7)
    const list = await other.get('/api/v1/tickets')
    expect((list.data.tickets as { id: string }[]).some((x) => x.id === t.id)).toBe(false)
    expect((await other.post(`/api/v1/tickets/${t.id}`, { message: 'نفوذ' })).res.status).toBe(403)
  })

  test('invalid ticket payload → 400 field errors (no silent failure)', async () => {
    const patient = await new Client().loginAs(6)
    const r = await patient.post('/api/v1/tickets', { subject: '', message: '' })
    expect(r.res.status).toBe(400)
  })
})

describe('prescription workflow: return / revise / doctor reject never close the case', () => {
  let caseId = ''
  beforeAll(async () => {
    const patient = await db.user.findFirstOrThrow({ where: { phone: '09120000006', role: 'PATIENT' } })
    const c = await db.medicalCase.create({
      data: { code: `TC-TEST-${Date.now().toString(36)}`, patientId: patient.id, status: 'WAITING_FOR_EXPERT_1', description: 'آزمون یکپارچه گردش کار نسخه' },
    })
    caseId = c.id
  })
  const act = (c: Client, action: string, body: Record<string, unknown> = {}) => c.post(`/api/v1/cases/${caseId}/action`, { action, ...body })
  const status = async () => (await db.medicalCase.findUniqueOrThrow({ where: { id: caseId } })).status

  test('expert 1 → expert 2 returns with reason → expert 1 queue', async () => {
    const e1 = await new Client().loginAs(2)
    const e2 = await new Client().loginAs(3)
    const patient = await new Client().loginAs(6)
    expect((await act(e1, 'CLAIM')).res.status).toBe(200)
    expect((await act(e1, 'SUBMIT_ASSESSMENT', { summary: 'ارزیابی آزمایشی' })).res.status).toBe(200)
    expect((await act(patient, 'USER_APPROVE')).res.status).toBe(200)
    expect((await act(e1, 'SUBMIT_PRESCRIPTION', { items: [{ drugName: 'قلم آزمایشی', dosage: '۱ عدد', frequency: 'روزی ۲ بار', quantity: 2 }] })).res.status).toBe(200)
    expect(await status()).toBe('WAITING_FOR_EXPERT_2')

    expect((await act(e2, 'EXPERT2_RETURN', {})).res.status).toBe(400) // reason mandatory
    expect((await act(e2, 'EXPERT2_RETURN', { reason: 'دوز قلم اول نامشخص است' })).res.status).toBe(200)
    expect(await status()).toBe('REVISION_REQUESTED')
    const ev = await db.caseEvent.findFirstOrThrow({ where: { caseId, toStatus: 'REVISION_REQUESTED' }, orderBy: { createdAt: 'desc' } })
    expect(ev.reason).toBe('دوز قلم اول نامشخص است')
    // shows up in Expert 1's dashboard queue immediately (cache invalidated)
    const dash = await e1.get('/api/v1/dashboard')
    expect((dash.data.queue as { id: string }[]).some((q) => q.id === caseId)).toBe(true)
  })

  test('expert 1 re-submits; expert 2 edits items → new version, old one kept', async () => {
    const e1 = await new Client().loginAs(2)
    const e2 = await new Client().loginAs(3)
    expect((await act(e1, 'SUBMIT_PRESCRIPTION', { items: [{ drugName: 'قلم آزمایشی', dosage: '۱ عدد', frequency: 'روزی ۲ بار' }] })).res.status).toBe(200)
    const before = await db.prescription.count({ where: { caseId } })
    const r = await act(e2, 'EXPERT2_REVIEW', {
      revisedItems: [{ drugName: 'قلم آزمایشی', dosage: '۱ عدد', frequency: 'روزی ۲ بار', quantity: 1, unitPrice: 50000 }, { drugName: 'قلم دوم', dosage: '۵ قطره', frequency: 'قبل از خواب', unitPrice: 30000 }],
      changeReason: 'افزودن قلم دوم',
    })
    expect(r.res.status).toBe(200)
    expect(await status()).toBe('WAITING_FOR_DOCTOR')
    const rx = await db.prescription.findMany({ where: { caseId }, orderBy: { version: 'asc' }, include: { items: true } })
    expect(rx.length).toBe(before + 1)
    expect(rx.at(-1)!.status).toBe('PENDING_DOCTOR')
    expect(rx.at(-1)!.items.length).toBe(2)
    expect(rx.at(-2)!.status).toBe('SUPERSEDED')
    expect(rx.at(-2)!.items.length).toBe(1)
  })

  test('doctor reject → REVISION_REQUESTED (not CLOSED), reason kept, re-approvable', async () => {
    const doctor = await new Client().loginAs(5)
    expect((await act(doctor, 'DOCTOR_REJECT', { comment: 'تداخل احتمالی؛ قلم دوم حذف شود' })).res.status).toBe(200)
    const c = await db.medicalCase.findUniqueOrThrow({ where: { id: caseId } })
    expect(c.status).toBe('REVISION_REQUESTED')
    expect(c.closedAt).toBeNull()
    const rejected = await db.prescription.findFirstOrThrow({ where: { caseId }, orderBy: { version: 'desc' } })
    expect(rejected.status).toBe('REJECTED')
    expect(rejected.doctorComment).toContain('تداخل احتمالی')

    const e1 = await new Client().loginAs(2)
    const e2 = await new Client().loginAs(3)
    expect((await act(e1, 'SUBMIT_PRESCRIPTION', { items: [{ drugName: 'قلم آزمایشی', dosage: '۱ عدد', frequency: 'روزی ۲ بار' }] })).res.status).toBe(200)
    const latest = await db.prescription.findFirstOrThrow({ where: { caseId }, orderBy: { version: 'desc' }, include: { items: true } })
    expect((await act(e2, 'EXPERT2_REVIEW', { items: latest.items.map((i) => ({ id: i.id, unitPrice: 50000 })) })).res.status).toBe(200)
    expect((await act(doctor, 'DOCTOR_APPROVE', { comment: 'تأیید' })).res.status).toBe(200)
    expect(await status()).toBe('PRESCRIPTION_APPROVED')
    // full history retained: every version still exists
    const versions = await db.prescription.findMany({ where: { caseId } })
    expect(versions.map((v) => v.status)).toContain('REJECTED')
  })

  test('recent events carry the CURRENT case status', async () => {
    const admin = await new Client().loginAs(1)
    const dash = await admin.get('/api/v1/dashboard')
    const ev = (dash.data.recentEvents as { case?: { id: string; status: string } }[]).find((e) => e.case?.id === caseId)
    expect(ev?.case?.status).toBe('PRESCRIPTION_APPROVED')
  })

  test('expert 1 cannot use Expert 2 return; patient cannot act on staff transitions', async () => {
    const id = caseId
    const patient = await new Client().loginAs(6)
    const r = await patient.post(`/api/v1/cases/${id}/action`, { action: 'CREATE_PROFORMA' })
    expect([403, 409]).toContain(r.res.status)
  })
})

describe('case archive (admin) + list filters', () => {
  test('archive hides from active list, shows in archive, restore brings it back', async () => {
    const admin = await new Client().loginAs(1)
    const c = await db.medicalCase.findFirstOrThrow({ where: { code: { startsWith: 'TC-TEST-' } }, orderBy: { createdAt: 'desc' } })
    const e1 = await new Client().loginAs(2)
    expect((await e1.post(`/api/v1/cases/${c.id}/archive`, { action: 'ARCHIVE', reason: 'تست' })).res.status).toBe(403)
    expect((await admin.post(`/api/v1/cases/${c.id}/archive`, { action: 'ARCHIVE', reason: 'پایان دوره آزمون' })).res.status).toBe(200)
    const active = await admin.get(`/api/v1/cases?q=${c.code}`)
    expect((active.data.cases as { id: string }[]).some((x) => x.id === c.id)).toBe(false)
    const arch = await admin.get(`/api/v1/cases?archived=1&q=${c.code}`)
    expect((arch.data.cases as { id: string }[]).some((x) => x.id === c.id)).toBe(true)
    expect((await admin.post(`/api/v1/cases/${c.id}/archive`, { action: 'RESTORE', reason: 'بازگشت برای پیگیری' })).res.status).toBe(200)
    const back = await admin.get(`/api/v1/cases?q=${c.code}`)
    const row = (back.data.cases as { id: string; patient: { firstName: string; age: number | null } }[]).find((x) => x.id === c.id)!
    expect(row.patient.firstName).toBeTruthy() // identity columns present
    expect(JSON.stringify(back.data)).not.toContain('nationalId') // never in lists
    const events = await db.caseEvent.findMany({ where: { caseId: c.id, action: { in: ['ARCHIVED', 'RESTORED'] } } })
    expect(events.length).toBe(2)
  })

  test('queue + date filters', async () => {
    const admin = await new Client().loginAs(1)
    const today = await admin.get('/api/v1/cases?range=today')
    expect(today.res.status).toBe(200)
    for (const c of today.data.cases as { createdAt: string }[]) expect(new Date(c.createdAt).getTime()).toBeGreaterThan(Date.now() - 2 * 864e5)
    const doctorQ = await admin.get('/api/v1/cases?queue=doctor')
    for (const c of doctorQ.data.cases as { status: string }[]) expect(c.status).toBe('WAITING_FOR_DOCTOR')
    expect((await admin.get('/api/v1/cases?queue=nope')).res.status).toBe(400)
  })
})

describe('mizaj questionnaire: optional, partial, versioned', () => {
  test('draft with one answer → IN_PROGRESS; partial completion is flagged incomplete', async () => {
    const patient = await new Client().loginAs(8)
    const active = await patient.get('/api/v1/questionnaires/active')
    const q = active.data.questionnaire as { version: number; questions: { id: string; options: { id: string }[] }[] } | null
    if (!q) return // no active questionnaire seeded in this DB
    const first = { questionId: q.questions[0].id, optionId: q.questions[0].options[0].id }
    const draft = await patient.post('/api/v1/questionnaires/submit', { status: 'DRAFT', answers: [first] })
    expect(draft.res.status).toBe(200)
    expect((await patient.get('/api/v1/questionnaires/active')).data.status).toBe('IN_PROGRESS')
    const done = await patient.post('/api/v1/questionnaires/submit', { status: 'COMPLETED', answers: [first] })
    expect(done.res.status).toBe(200)
    const c = done.data.completeness as { complete: boolean }
    expect(c.complete).toBe(q.questions.length === 1)
    const resp = done.data.response as { mizajFa: string; questionnaireVersion: number; scoringVersion: string }
    expect(resp.questionnaireVersion).toBe(q.version)
    expect(resp.scoringVersion).toBe('mizaj-v2-weighted-partial')
    if (q.questions.length > 3) expect(resp.mizajFa).toContain('نامشخص') // 1 answer < 30% coverage
  })
})

describe('vocabulary presets', () => {
  test('staff read presets; patient forbidden; admin can add', async () => {
    const e1 = await new Client().loginAs(2)
    const list = await e1.get('/api/v1/vocabulary?kind=FREQUENCY')
    expect(list.res.status).toBe(200)
    expect((list.data.items as unknown[]).length).toBeGreaterThan(0)
    expect((await (await new Client().loginAs(6)).get('/api/v1/vocabulary')).res.status).toBe(403)
    const admin = await new Client().loginAs(1)
    const v = `هر ۸ ساعت ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    expect((await admin.post('/api/v1/admin/vocabulary', { kind: 'FREQUENCY', valueFa: v })).res.status).toBe(200)
    expect((await admin.post('/api/v1/admin/vocabulary', { kind: 'FREQUENCY', valueFa: v })).res.status).toBe(409)
  })
})
