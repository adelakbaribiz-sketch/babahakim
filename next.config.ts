import type { NextConfig } from "next";

// PHASE 05 — security headers (ED-62): CSP, frame protection, nosniff,
// referrer policy, permissions policy. HSTS only over TLS in production.
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next dev/prod injects inline bootstrap + styles: 'unsafe-inline' for v1
      // (nonce-based CSP migration tracked as debt in SECURITY.md §headers)
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  // PHASE 14 (ED-156): pdfkit must stay external — Turbopack bundling breaks
  // its runtime font-data reads (js/data/*.afm resolve against a fake /ROOT).
  serverExternalPackages: ['pdfkit'],
  output: "standalone",
  // PHASE 16 (ED-186): gzip transfer compression ON explicitly (measured:
  // first-load 1434 KB identity → 455 KB wire, −68.3%). Brotli needs an edge
  // proxy (tracked as debt D-16-3 — Next standalone serves gzip only).
  compress: true,
  // PHASE 16 (ED-185): CDN seam — set NEXT_PUBLIC_CDN_BASE in deployment to
  // move static chunk delivery to a CDN. No-op locally (single node). When
  // activated, CSP default-src/script-src/style-src must list the CDN origin
  // (see PERFORMANCE.md §CDN — the headers above stay the single source).
  ...(process.env.NEXT_PUBLIC_CDN_BASE
    ? { assetPrefix: process.env.NEXT_PUBLIC_CDN_BASE.replace(/\/$/, '') }
    : {}),
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // dev-only floating "N" badge off: it overlapped the sidebar footer and
  // README screenshots (no effect on production builds)
  devIndicators: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
