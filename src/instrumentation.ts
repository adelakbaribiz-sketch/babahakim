// Next.js server-start hook. Production fail-fast for secrets (ED-59):
// getSecrets() was only reached lazily on the first login/encryption, so a
// container without JWT_SECRET / FIELD_ENC_KEY booted, passed its health
// check, and then failed every sign-in. Now it refuses to start instead.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NODE_ENV !== 'production') return
  const { getSecrets } = await import('@/lib/security/env')
  try {
    getSecrets()
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}
