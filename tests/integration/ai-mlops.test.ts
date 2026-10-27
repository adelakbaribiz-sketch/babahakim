// ── PHASE 11 · AI/ML Engineering Integration Tests (live server) ───────────
// End-to-end MLOps feedback loop:
//   patient → upload → case → async AI analysis (registry + telemetry)
//   → Expert 1 review WITH corrections → dataset item (labeled, de-identified)
//   → doctor gate → FINALIZED finalLabel
//   → admin overview (registry/dataset/monitoring/cost) → evaluation report
//   → re-run creates a NEW analysis (history preserved)
// plus authorization on every new endpoint.
import { describe, test, expect, beforeAll } from 'bun:test'
import { randomBytes } from 'node:crypto'
import { nid } from '../helpers/national-id'

const BASE = 'http://localhost:3000'

// ── tiny cookie-jar client with CSRF (shared convention with golden path) ─
class Client {
  jar = new Map<string, string>()
  csrf = ''
  ip = `10.88.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`

  cookieHeader() { return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ') }

  store(res: Response) {
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';')
      const eq = pair.indexOf('=')
      const name = pair.slice(0, eq).trim()
      const value = pair.slice(eq + 1).trim()
      if (value === '') this.jar.delete(name)
      else this.jar.set(name, value)
      if (name === 'ta_csrf') this.csrf = value
    }
  }

  async call(method: string, path: string, opts: { json?: unknown; body?: BodyInit } = {}) {
    const headers: Record<string, string> = {}
    if (opts.json !== undefined) headers['Content-Type'] = 'application/json'
    if (this.jar.size) headers['Cookie'] = this.cookieHeader()
    headers['X-Forwarded-For'] = this.ip
    if (method !== 'GET' && this.csrf) headers['x-csrf-token'] = this.csrf
    if (method !== 'GET') headers['Origin'] = BASE
    const res = await fetch(`${BASE}${path}`, {
      method, headers,
      body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.body,
      redirect: 'manual',
    })
    this.store(res)
    const text = await res.text()
    let data: unknown = undefined
    try { data = text ? JSON.parse(text) : undefined } catch { /* non-JSON */ }
    return { res, data: (data ?? {}) as Record<string, unknown> }
  }

  get(p: string) { return this.call('GET', p) }
  post(p: string, json?: unknown) { return this.call('POST', p, { json: json ?? {} }) }
}

let tongueJpeg: Blob
beforeAll(async () => {
  const sharp = (await import('sharp')).default
  const buf = await sharp(randomBytes(640 * 480 * 3), { raw: { width: 640, height: 480, channels: 3 } })
    .jpeg({ quality: 90 })
    .toBuffer()
  tongueJpeg = new Blob([new Uint8Array(buf)], { type: 'image/jpeg' })
})

const seedUser = (n: number) => ({ phone: `0912000000${n}`, password: 'Pass1234' })
const uid = () => `0919${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 9)}`.slice(0, 11)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('PHASE 11 — AI/ML engineering feedback loop (integration)', () => {
  const patient = new Client()
  const expert1 = new Client()
  const expert2 = new Client()
  const doctor = new Client()
  const admin = new Client()
  let caseId = ''
  let imageId = ''
  let analysisId = ''

  beforeAll(async () => {
    for (const c of [patient, expert1, expert2, doctor, admin]) await c.get('/api/v1/products')
    // register a fresh patient
    await patient.post('/api/v1/auth/register', {
      nationalId: nid(), phone: uid(), password: 'Pass1234', firstName: 'آزمون', lastName: 'فاز۱۱',
      gender: 'FEMALE', birthDate: '1994-05-05', acceptTerms: true, privacyConsent: true,
    })
    for (const [c, n] of [[expert1, 2], [expert2, 3], [doctor, 5], [admin, 1]] as [Client, number][]) {
      const { res } = await c.post('/api/v1/auth/login', seedUser(n))
      expect(res.status).toBe(200)
    }
  })

  test('questionnaire completed (case precondition, BR-MED-02)', async () => {
    const { data: active } = await patient.get('/api/v1/questionnaires/active')
    const q = active.questionnaire as { questions: { id: string; options: { id: string }[] }[] }
    expect(q).toBeTruthy()
    const answers = q.questions.map((qq) => ({ questionId: qq.id, optionId: qq.options[0].id }))
    const { res, data } = await patient.post('/api/v1/questionnaires/submit', { answers })
    expect(res.status).toBe(200)
    expect((data.response as { mizajFa: string }).mizajFa).toBeTruthy()
  })

  test('upload → 202 → poll VALIDATED (media async pipeline, PHASE 10 handoff)', async () => {
    const form = new FormData()
    form.append('file', tongueJpeg, 'tongue.jpg')
    form.append('type', 'TONGUE')
    const up = await patient.call('POST', '/api/v1/images/upload', { body: form })
    expect([200, 202]).toContain(up.res.status)
    imageId = String((up.data.image as { id: string } | undefined)?.id ?? '')
    expect(imageId).toBeTruthy()
    let img: { status: string } = { status: 'PENDING' }
    for (let i = 0; i < 40 && img.status === 'PENDING'; i++) {
      await sleep(750)
      const poll = await patient.get(`/api/v1/images/${imageId}`)
      img = (poll.data.image as { status: string }) ?? { status: 'PENDING' }
    }
    expect(['VALIDATED', 'PROCESSED']).toContain(img.status)
  }, 45_000)

  test('case creation → async AI analysis lands with registry provenance + telemetry', async () => {
    const create = await patient.post('/api/v1/cases', {
      description: 'خشکی و گزگز زبان صبحگاهی — تست فاز ۱۱',
      imageId,
      priority: 'NORMAL',
    })
    expect(create.res.status).toBe(200)
    const c = create.data.case as { id: string; status: string }
    expect(c.status).toBe('WAITING_FOR_EXPERT_1')
    caseId = c.id

    // AI runs in the JobQueue (non-blocking) — poll the case for the analysis
    let found: Record<string, unknown> | undefined
    for (let i = 0; i < 40; i++) {
      await sleep(750)
      const view = await patient.get(`/api/v1/cases/${caseId}`)
      const analyses = ((view.data.case ?? {}) as Record<string, unknown>).aiAnalyses as Record<string, unknown>[] | undefined
      if (analyses?.length) { found = analyses[0]; break }
    }
    expect(found).toBeTruthy()
    analysisId = String(found!.id)
    // provenance (spec §61): model identity is recorded per prediction
    expect(String(found!.modelName)).toBeTruthy()
    expect(Number(found!.modelVersion)).toBeGreaterThanOrEqual(1)
    // human-validation invariant: fresh AI output is ALWAYS pending review
    expect(found!.reviewStatus).toBe('PENDING_REVIEW')
    expect(found!.humanReviewed).toBe(false)
  })

  test('inference telemetry logged (AIInferenceLog → monitoring stats)', async () => {
    const { res, data } = await admin.get('/api/v1/admin/ai/overview')
    expect(res.status).toBe(200)
    const monitoring = data.monitoring as Record<string, unknown>
    expect(Number(monitoring.total)).toBeGreaterThanOrEqual(1)
    expect(monitoring.status === undefined).toBe(true) // shape sanity (no stray fields)
  })

  test('prompt registry is seeded and versioned (ED-122)', async () => {
    const { res, data } = await admin.get('/api/v1/admin/ai/prompts')
    expect(res.status).toBe(200)
    const prompts = data.prompts as { key: string; version: number; status: string }[]
    expect(prompts.length).toBeGreaterThanOrEqual(2)
    expect(prompts.some((p) => p.key === 'tongue-analysis-system' && p.status === 'ACTIVE')).toBe(true)
  })

  test('Expert 1 review with corrections → dataset item created (feedback loop, ED-124)', async () => {
    await expert1.post(`/api/v1/cases/${caseId}/action`, { action: 'CLAIM' })
    const assess = await expert1.post(`/api/v1/cases/${caseId}/action`, {
      action: 'SUBMIT_ASSESSMENT',
      summary: 'ارزیابی فاز ۱۱ با اصلاح شاخص‌ها',
      diseases: [],
      aiAgreement: 'MODIFIED',
      aiComment: 'رنگ بدنه اصلاح شد',
      aiCorrections: [{ indicator: 'BODY_COLOR', value: 'کم‌رنگ' }],
    })
    expect(assess.res.status).toBe(200)

    const { data } = await admin.get('/api/v1/admin/ai/datasets')
    const items = data.items as { analysisId?: string; expert1Label?: string; reviewStatus: string; patientHash?: string }[]
    const item = items.find((i) => i.analysisId === analysisId)
    expect(item).toBeTruthy()
    expect(item!.reviewStatus).toBe('LABELED')
    // corrections land as per-indicator ground truth
    expect(item!.expert1Label).toContain('BODY_COLOR')
    expect(item!.expert1Label).toContain('کم‌رنگ')
    // de-identification: only a salted hash, never a patient id
    expect(item!.patientHash).toBeTruthy()
    expect(String(item!.patientHash)).not.toContain('09')
  })

  test('patient gate + prescription + doctor gate → FINALIZED finalLabel (loop closure)', async () => {
    await patient.post(`/api/v1/cases/${caseId}/action`, { action: 'USER_APPROVE' })
    await expert1.post(`/api/v1/cases/${caseId}/action`, {
      action: 'SUBMIT_PRESCRIPTION',
      items: [{ drugName: 'شربت سنبل‌الطیب', dosage: '۵ میلی‌لیتر', frequency: 'روزانه', duration: '۷ روز' }],
    })
    // Expert 2 needs the prescription item ids for the availability/pricing review
    const { data: detail } = await expert1.get(`/api/v1/cases/${caseId}`)
    const prescriptions = ((detail.case ?? {}) as Record<string, unknown>).prescriptions as { items: { id: string }[] }[]
    const p = prescriptions[0]
    const e2review = await expert2.post(`/api/v1/cases/${caseId}/action`, {
      action: 'EXPERT2_REVIEW',
      notes: 'کالا موجود است',
      items: p.items.map((it) => ({ id: it.id, available: true, missing: false, unitPrice: 160000 })),
    })
    expect(e2review.res.status).toBe(200)
    const approve = await doctor.post(`/api/v1/cases/${caseId}/action`, {
      action: 'DOCTOR_APPROVE', comment: 'تأیید نهایی — فاز ۱۱',
    })
    expect(approve.res.status).toBe(200)

    const { data } = await admin.get('/api/v1/admin/ai/datasets')
    const items = data.items as { analysisId?: string; finalLabel?: string; reviewStatus: string }[]
    const item = items.find((i) => i.analysisId === analysisId)
    expect(item).toBeTruthy()
    expect(item!.finalLabel).toBe('DOCTOR_APPROVED')
    expect(item!.reviewStatus).toBe('FINALIZED')
  })

  test('evaluation job → report with FULL metric suite (ED-127 — never accuracy-only)', async () => {
    const req = await admin.post('/api/v1/admin/ai/evaluate', { includeDraft: true })
    expect(req.res.status).toBe(200)
    expect(req.data.queued).toBe(true)

    // job runs async — poll overview for a fresh report
    let report: Record<string, unknown> | undefined
    for (let i = 0; i < 20; i++) {
      await sleep(800)
      const { data } = await admin.get('/api/v1/admin/ai/overview')
      const reports = data.reports as Record<string, unknown>[]
      report = reports?.find((r) => String(r.summary).includes('n='))
      if (report) break
    }
    expect(report).toBeTruthy()
    expect(String(report!.summary)).toContain('macro-F1')
  })

  test('re-run creates a NEW analysis — history preserved, still PENDING_REVIEW', async () => {
    const rerun = await expert1.post(`/api/v1/cases/${caseId}/rerun-ai`)
    expect(rerun.res.status).toBe(200)
    const newId = String(rerun.data.analysisId)
    expect(newId).not.toBe(analysisId)

    const view = await patient.get(`/api/v1/cases/${caseId}`)
    const analyses = ((view.data.case ?? {}) as Record<string, unknown>).aiAnalyses as Record<string, unknown>[]
    expect(analyses.length).toBeGreaterThanOrEqual(2) // history kept
    const fresh = analyses.find((a) => String(a.id) === newId)
    expect(fresh!.reviewStatus).toBe('PENDING_REVIEW') // validation gate invariant holds
  })

  test('authorization: new AI ops endpoints are role-guarded', async () => {
    // patient blocked from everything
    const p1 = await patient.get('/api/v1/admin/ai/overview')
    expect(p1.res.status).toBe(403)
    const p2 = await patient.post('/api/v1/admin/ai/evaluate', { includeDraft: true })
    expect(p2.res.status).toBe(403)
    const p3 = await patient.post('/api/v1/admin/ai/datasets', { action: 'freeze' })
    expect(p3.res.status).toBe(403)
    const p4 = await patient.post(`/api/v1/cases/${caseId}/rerun-ai`)
    expect(p4.res.status).toBe(403)
    // doctor may READ overview but not freeze datasets
    const d1 = await doctor.get('/api/v1/admin/ai/overview')
    expect(d1.res.status).toBe(200)
    const d2 = await doctor.post('/api/v1/admin/ai/datasets', { action: 'freeze' })
    expect(d2.res.status).toBe(403)
  })

  test('dataset freeze → immutable FROZEN version + new draft opened', async () => {
    const freeze = await admin.post('/api/v1/admin/ai/datasets', { action: 'freeze' })
    expect(freeze.res.status).toBe(200)
    expect(Number((freeze.data as { dataset: { itemCount: number } }).dataset.itemCount)).toBeGreaterThanOrEqual(1)

    const { data } = await admin.get('/api/v1/admin/ai/datasets')
    const datasets = data.datasets as { status: string }[]
    expect(datasets.some((d) => d.status === 'FROZEN')).toBe(true)
    expect(data.activeDraft).toBeTruthy()
  })
})
