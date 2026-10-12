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
    // Allow cross-origin requests to mobile auth endpoints so the Expo web
    // build (on a different port) can reach them during development.
    // Native builds are unaffected by CORS — this only matters for web testing.
    const corsHeaders = [
      { key: "Access-Control-Allow-Origin", value: "*" },
      { key: "Access-Control-Allow-Methods", value: "GET,POST,PUT,PATCH,DELETE,OPTIONS" },
      { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization" },
    ];
    return [
      { source: "/api/auth/mobile/:path*", headers: corsHeaders },
      { source: "/api/auth/signup", headers: corsHeaders },
      { source: "/api/auth/forgot-password", headers: corsHeaders },
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
