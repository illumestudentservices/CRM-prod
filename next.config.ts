import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// Security headers applied to every response
const securityHeaders = [
  // Prevent MIME type sniffing
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Control referrer information sent with requests
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Disable browser features not needed by this app
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // DNS prefetch for performance
  { key: "X-DNS-Prefetch-Control", value: "on" },
  // HSTS — only in production (HTTPS). A 2-year max-age with preload.
  // Omitting in dev prevents breaking localhost over HTTP.
  ...(isProd
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]
    : []),
  {
    key: "Content-Security-Policy",
    value: [
      // Default: only allow resources from same origin
      "default-src 'self'",
      // Next.js requires unsafe-eval (HMR) and unsafe-inline (styles injected by React).
      // In production, consider adding nonce-based CSP for scripts.
      "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      // Allow images from any HTTPS source (logos, avatars, etc.) and data URIs
      "img-src 'self' data: blob: https:",
      // Allow fonts from same origin and data URIs
      "font-src 'self' data:",
      // API calls: allow same origin and Neon/Resend (server-side only, but belt-and-suspenders)
      "connect-src 'self'",
      // Disallow all frames — this app should never be embedded
      "frame-src 'none'",
      // Disallow this app from being embedded in any frame (supersedes X-Frame-Options)
      "frame-ancestors 'none'",
      // Disallow plugins
      "object-src 'none'",
      // Prevent base tag hijacking
      "base-uri 'self'",
      // Require all mixed-content to be upgraded to HTTPS in production
      ...(isProd ? ["upgrade-insecure-requests"] : []),
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  // Don't advertise the framework — reduces fingerprinting for targeted attacks.
  poweredByHeader: false,
  serverExternalPackages: ["bcryptjs", "puppeteer-core"],
  images: {
    remotePatterns: [
      // Restrict to HTTPS only; wildcard hostname needed for external avatars/logos
      { protocol: "https", hostname: "**" },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
