// Synthetic, checksum-valid Iranian national IDs for tests (2026-10 overhaul:
// registration requires a national ID; random values keep reruns collision-free).
export function nid(): string {
  for (;;) {
    const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10))
    if (d.every((x) => x === d[0])) continue
    const r = d.reduce((s, x, i) => s + x * (10 - i), 0) % 11
    return d.join('') + String(r < 2 ? r : 11 - r)
  }
}
