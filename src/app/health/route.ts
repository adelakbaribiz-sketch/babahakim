// PHASE 15 (ED-175): public health endpoint — spec §57 `/health`.
// Combines liveness + readiness into ONE operator-facing status
// (ok | degraded | down) with boolean checks only. Load balancers should
// use /liveness|/readiness; /health is for humans and uptime monitors.
import { NextResponse } from 'next/server'
import { health } from '@/server/infrastructure/observability/health'

export const dynamic = 'force-dynamic'

export async function GET() {
  const h = await health()
  const status = h.status === 'ok' ? 200 : h.status === 'degraded' ? 200 : 503
  return NextResponse.json(
    {
      status: h.status,
      uptimeSec: h.liveness.uptimeSec,
      checks: {
        db: h.readiness.checks.db,
        queue: h.readiness.checks.queue,
        storage: h.readiness.checks.storage,
        bootstrap: h.readiness.checks.bootstrap,
      },
    },
    { status },
  )
}
