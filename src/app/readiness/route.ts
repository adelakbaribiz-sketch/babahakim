// PHASE 15 (ED-175): public readiness probe — spec §57 `/readiness`.
// Answers "can we serve traffic?": DB ping (3s budget) + queue worker +
// storage present + bootstrap done. Boolean checks only — details (latency,
// versions, integration inventory) stay behind the ADMIN console (ED-173).
import { NextResponse } from 'next/server'
import { readiness } from '@/server/infrastructure/observability/health'

export const dynamic = 'force-dynamic'

export async function GET() {
  const ready = await readiness()
  const status = ready.status === 'not_ready' ? 503 : 200
  return NextResponse.json(
    {
      status: ready.status,
      checks: { db: ready.checks.db, queue: ready.checks.queue, storage: ready.checks.storage, bootstrap: ready.checks.bootstrap },
    },
    { status },
  )
}
