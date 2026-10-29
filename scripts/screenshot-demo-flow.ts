// Builds the English demo state used for README screenshots (run against a
// THROWAWAY database behind `bun run dev:testdb`, after `bun prisma/seed.ts`).
// Every person, case and image is synthetic: the tongue picture is an SVG
// illustration rendered by sharp, not a photo of a real patient.
//   bun scripts/screenshot-demo-flow.ts
import sharp from 'sharp'
import { Client } from '../tests/helpers/client'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function tongueImage(hue: number): Promise<Blob> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="768">
    <defs>
      <radialGradient id="bg" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="#5a3a33"/><stop offset="1" stop-color="#1c1110"/></radialGradient>
      <radialGradient id="t" cx="50%" cy="35%" r="70%"><stop offset="0" stop-color="hsl(${hue},62%,72%)"/><stop offset="0.7" stop-color="hsl(${hue},55%,58%)"/><stop offset="1" stop-color="hsl(${hue},50%,42%)"/></radialGradient>
      <filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.18 0"/><feComposite in2="SourceGraphic" operator="in"/></filter>
    </defs>
    <rect width="1024" height="768" fill="url(#bg)"/>
    <path d="M282 150 Q512 96 742 150 Q800 420 640 640 Q512 740 384 640 Q224 420 282 150 Z" fill="url(#t)"/>
    <path d="M282 150 Q512 96 742 150 Q800 420 640 640 Q512 740 384 640 Q224 420 282 150 Z" fill="#fff" filter="url(#n)"/>
    <path d="M512 170 Q500 420 512 640" stroke="hsl(${hue},45%,46%)" stroke-width="6" fill="none" opacity="0.7"/>
    <ellipse cx="512" cy="300" rx="150" ry="70" fill="#f4efe6" opacity="0.28"/>
  </svg>`
  const buf = await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer()
  return new Blob([new Uint8Array(buf)], { type: 'image/jpeg' })
}

async function login(phone: string) {
  const c = new Client()
  await c.get('/api/v1/products')
  const r = await c.post('/api/v1/auth/login', { phone, password: 'Pass1234' })
  if (r.res.status !== 200) throw new Error(`login ${phone}: ${r.res.status}`)
  return c
}

async function openCase(patient: Client, hue: number, description: string, priority = 'NORMAL') {
  const form = new FormData()
  form.append('file', await tongueImage(hue), 'tongue.jpg')
  form.append('type', 'TONGUE')
  const up = await patient.call('POST', '/api/v1/images/upload', { body: form })
  const imageId = (up.data.image as { id: string }).id
  let status = 'PENDING'
  for (let i = 0; i < 60 && status === 'PENDING'; i++) {
    await sleep(500)
    status = ((await patient.get(`/api/v1/images/${imageId}`)).data.image as { status: string }).status
  }
  if (status !== 'VALIDATED') throw new Error(`image ${status}`)
  const created = await patient.post('/api/v1/cases', { description, imageId, priority })
  if (created.res.status !== 200) throw new Error(`case: ${created.text}`)
  const caseId = (created.data.case as { id: string }).id
  for (let i = 0; i < 60; i++) {
    await sleep(500)
    const d = (await patient.get(`/api/v1/cases/${caseId}`)).data.case as { aiAnalyses: unknown[] }
    if (d.aiAnalyses.length) break
  }
  return caseId
}

const act = async (c: Client, caseId: string, action: string, body: Record<string, unknown> = {}) => {
  const r = await c.post(`/api/v1/cases/${caseId}/action`, { action, ...body })
  if (r.res.status !== 200) throw new Error(`${action}: ${r.text}`)
}

const sara = await login('09120000006')
const amir = await login('09120000007')
const negar = await login('09120000008')
const e1 = await login('09120000002')
const e2 = await login('09120000003')

// questionnaire for the two patients without one (all options of question 1..n, first choice)
for (const p of [amir, negar]) {
  const q = (await p.get('/api/v1/questionnaires/active')).data.questionnaire as { questions: { id: string; options: { id: string }[] }[] }
  await p.post('/api/v1/questionnaires/submit', { status: 'COMPLETED', answers: q.questions.map((qq, i) => ({ questionId: qq.id, optionId: qq.options[i % qq.options.length].id })) })
}

// case A — waiting for the doctor (full expert chain, priced prescription)
const caseA = await openCase(sara, 352, 'Dry mouth every morning, a thick white coating on the tongue and mild bloating after meals for about three weeks.')
await act(e1, caseA, 'CLAIM')
await act(e1, caseA, 'SUBMIT_ASSESSMENT', {
  summary: 'Thick white coating on the middle third with a slightly pale body. Pattern is consistent with phlegm (balgham) dominance and weak digestion. Suggest a warming regimen and digestive support; review in 40 days.',
  aiAgreement: 'MODIFIED', aiComment: 'Coating thickness confirmed; colour reading adjusted to pale-pink.',
})
await act(sara, caseA, 'USER_APPROVE')
const products = (await e1.get('/api/v1/products?limit=20')).data.products as { id: string; nameEn: string; price: number }[]
const pick = (en: string) => products.find((p) => p.nameEn === en)!
await act(e1, caseA, 'SUBMIT_PRESCRIPTION', {
  notes: 'Warming regimen; avoid cold drinks and heavy dairy in the evening.',
  items: [
    { productId: pick('Ginger Infusion').id, drugName: 'Ginger Infusion', dosage: '1 cup', frequency: 'twice daily', duration: '14 days', warnings: 'Pause during pregnancy unless approved by the doctor', quantity: 2 },
    { productId: pick('Chamomile Tea').id, drugName: 'Chamomile Tea', dosage: '1 bag', frequency: 'at bedtime', duration: '1 month', quantity: 1 },
  ],
})
const rx = ((await e2.get(`/api/v1/cases/${caseA}`)).data.case as { prescriptions: { items: { id: string; productId: string }[] }[] }).prescriptions[0]
await act(e2, caseA, 'EXPERT2_REVIEW', {
  notes: 'Both items in stock; priced from the current catalogue.',
  items: rx.items.map((it) => ({ id: it.id, available: true, missing: false, unitPrice: products.find((p) => p.id === it.productId)?.price ?? 0 })),
})

// case B — returned by Expert 2 for revision (shows the revision banner)
const caseB = await openCase(amir, 8, 'Burning sensation on the tongue tip and poor sleep since starting a new job.', 'HIGH')
await act(e1, caseB, 'CLAIM')
await act(e1, caseB, 'SUBMIT_ASSESSMENT', { summary: 'Red tip with a thin yellow coating; heat pattern. Cooling regimen proposed.', aiAgreement: 'ACCEPTED' })
await act(amir, caseB, 'USER_APPROVE')
await act(e1, caseB, 'SUBMIT_PRESCRIPTION', { items: [{ productId: pick('Valerian Syrup').id, drugName: 'Valerian Syrup', dosage: '1 tablespoon', frequency: 'at bedtime', duration: '10 days' }] })
await act(e2, caseB, 'EXPERT2_RETURN', { reason: 'Please confirm whether the patient takes any sedatives before adding valerian.' })

// case C — fresh in the Expert 1 queue
await openCase(negar, 340, 'Pale tongue, tiredness in the afternoons and cold hands and feet.', 'URGENT')

// a support ticket with a staff reply
const t = await sara.post('/api/v1/tickets', { subject: 'When will my prescription be ready?', category: 'MEDICAL', priority: 'NORMAL', message: 'I approved the assessment yesterday. How long does the doctor review usually take?' })
const op = await login('09120000004')
await op.post(`/api/v1/tickets/${(t.data.ticket as { id: string }).id}`, { message: 'Doctor reviews are usually completed within 24 hours. You will get a notification as soon as it is approved.' })

console.log(JSON.stringify({ caseA, caseB }))
