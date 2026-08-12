import { indexingEnabled } from "@/lib/appEnv";

const SITE_URL = "https://useproximity.org";

// /robots.txt — generated per deployment rather than served as a static file, so the
// staging deploy can tell crawlers to stay out while production keeps its normal rules.
// (This replaced public/robots.txt: a static file there shadows this route entirely.)
export default function robots() {
  if (!indexingEnabled()) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }

  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/admin/"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
