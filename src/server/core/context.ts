// ── BabaHakim Backend · Request context (transport-derived metadata) ─────
// Built once per request in the API layer and passed DOWN into services.
// Services stay transport-agnostic (NextRequest never crosses the boundary).
export interface RequestContext {
  reqId: string
  ip: string
  device: 'Mobile' | 'Tablet' | 'Desktop'
}

export function buildRequestContext(req: { headers: Headers }, reqId: string): RequestContext {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
  const ua = req.headers.get('user-agent') || ''
  const device = /mobile/i.test(ua) ? 'Mobile' as const : /tablet|ipad/i.test(ua) ? 'Tablet' as const : 'Desktop' as const
  return { reqId, ip, device }
}
