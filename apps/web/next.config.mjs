// Build-time equivalent of isProdData(). Fail-safe: only an explicit production
// signal may bundle the production project's public URL and anon key.
const explicitAppEnv = (process.env.APP_ENV || "").toLowerCase();
const vercelEnv = (process.env.VERCEL_ENV || "").toLowerCase();
const useProdSupabase =
  explicitAppEnv === "production" ||
  (!["development", "staging", "production"].includes(explicitAppEnv) &&
    vercelEnv === "production");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // expo-server-sdk is ESM and reads ../package.json through createRequire(import.meta.url).
  // Bundled, that path is frozen to the build machine (/vercel/path0/...) and push sends fail
  // at runtime with "Cannot find module '../package.json'", so load it from node_modules.
  // pdfjs-dist reads placeholder positions in uploaded agreement PDFs (lib/billing/placeholders.js); bundling breaks its worker.
  serverExternalPackages: ["expo-server-sdk", "pdfjs-dist"],
  // pdf.js loads pdf.worker.mjs at runtime, which the deploy's file tracing misses:
  // ship it with the routes that read agreement PDFs (hoisted to the repo root).
  outputFileTracingIncludes: {
    "/api/admin/billing/agreement-versions": ["../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
    "/api/admin/billing/agreement-versions/[id]": ["../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
  },
  // Browser Realtime client needs the selected project's public URL + anon key.
  // Resolve at build time; service-role and JWT secrets are never bundled.
  env: {
    NEXT_PUBLIC_SUPABASE_URL: useProdSupabase
      ? process.env.PROD_SUPABASE_URL
      : process.env.DEV_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_DEFAULT_KEY: useProdSupabase
      ? process.env.PROD_SUPABASE_DEFAULT_KEY
      : process.env.DEV_SUPABASE_DEFAULT_KEY,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
    formats: ["image/avif", "image/webp"],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  },
};

export default nextConfig;
