// PHASE 15 (ED-175): public liveness probe — spec §57 `/liveness`.
// Kubernetes semantics: NEVER touches the DB (a broken DB must not get the
// pod killed). Reaching this handler is itself the proof the event loop is
// responsive. Minimal body — no topology disclosure (ED-173).
// Standalone handler (not apiRoute) so probes never inflate API metrics.
import { NextResponse } from 'next/server'
import { liveness } from '@/server/infrastructure/observability/health'

export const dynamic = 'force-dynamic'

export async function GET() {
  const live = await liveness()
  const status = live.status === 'ok' ? 200 : 503
  return NextResponse.json({ status: live.status, uptimeSec: live.uptimeSec }, { status })
}
