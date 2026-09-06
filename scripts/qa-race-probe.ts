// PHASE 18 · LOAD-1 isolation probe — reproduces the claim race OUTSIDE the
// bun test runner to bisect test-runner context vs pure HTTP concurrency.
// Usage: BH_CHAOS=1 NODE_ENV=test bun scripts/qa-race-probe.ts
import { Client } from '../tests/helpers/client'

const a = await new Client().loginAs(2)
const b = await new Client().loginAs(2)
const { db } = await import('../src/lib/db')
const seed = await db.patientProfile.findFirst()
const c = await db.medicalCase.create({
  data: {
    code: `QA-RACE-${Date.now()}`, patientId: seed!.userId, status: 'WAITING_FOR_EXPERT_1',
    priority: 'NORMAL', description: 'bun race probe',
  },
})

const t0 = Date.now()
const [ra, rb] = await Promise.allSettled([
  a.post(`/api/v1/cases/${c.id}/action`, { action: 'CLAIM' }),
  b.post(`/api/v1/cases/${c.id}/action`, { action: 'CLAIM' }),
])
const elapsed = Date.now() - t0
const sa = ra.status === 'fulfilled' ? ra.value.res.status : 'REJ'
const sb = rb.status === 'fulfilled' ? rb.value.res.status : 'REJ'
console.log(`elapsed=${elapsed}ms statuses=[${sa},${sb}]`)
if (ra.status === 'fulfilled' && sa !== 200) console.log('A body:', JSON.stringify(ra.value.data).slice(0, 160))
if (rb.status === 'fulfilled' && sb !== 200) console.log('B body:', JSON.stringify(rb.value.data).slice(0, 160))
await db.medicalCase.delete({ where: { id: c.id } }).catch(() => {})
process.exit(sa === 200 && sb === 409 ? 0 : 1)
