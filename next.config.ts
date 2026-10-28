import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js inlines its runtime bootstrap; dev additionally needs eval for HMR.
      `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }] : []),
];

const config: NextConfig = {
  serverExternalPackages: ["pg-boss", "pino", "@electric-sql/pglite", "@electric-sql/pglite-socket"],
  // Demo mode ships the mock database snapshot and PGlite's WebAssembly with every server function.
  outputFileTracingIncludes: {
    "/**": [".mock-db/**", "node_modules/@electric-sql/pglite/dist/**", "node_modules/@electric-sql/pglite-socket/dist/**"],
  },
  eslint: { ignoreDuringBuilds: true },
  devIndicators: false,
  // E2E builds into its own folder so it can run next to `next dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default config;
