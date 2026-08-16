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
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // The admin surface lives under /dashboard (there is no /admin route);
        // the rest are auth/utility shells with no search value.
        disallow: [
          "/api/",
          "/dashboard/",
          "/login",
          "/reset-password",
          "/review-invite/",
          "/add-listing",
          "/add-sublease",
          "/add-sub-lease",
          "/refer",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
