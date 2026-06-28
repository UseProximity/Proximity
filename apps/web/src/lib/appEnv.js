/*
 * Central environment / data-target helper.
 *
 * Distinguishes the real production site from the STAGING environment. Staging runs as a
 * Vercel Preview deployment and the real site as a Vercel Production deployment — but BOTH
 * build with NODE_ENV=production, so NODE_ENV alone cannot tell them apart. Staging must
 * behave as a sandbox: it points at the DEV database and DEV storage bucket, shows a banner,
 * and has external outreach (emails, Airtable, Formspree) disabled — so the team can test on
 * a fresh prod-data snapshot without touching real production data or contacting real users.
 *
 * This resolver is intentionally FAIL-SAFE: prod data/outreach is used ONLY when there is a
 * positive production signal. Any ambiguity (missing/misconfigured env vars) resolves to a
 * NON-prod environment, so a forgotten variable can never silently point staging — or a PR
 * preview — at the production database or fire real emails.
 *
 * Resolution order:
 *   1. APP_ENV, when explicitly set to staging|production|development (manual override).
 *   2. Vercel's automatic per-deployment VERCEL_ENV: production → production, preview → staging.
 *   3. Local (NODE_ENV !== "production") → development.
 *   4. Built as production with no trustworthy signal → "staging" (dev DB, outreach OFF),
 *      NOT production. Belt-and-suspenders: also set APP_ENV=production on the Production
 *      deployment so prod never relies on inference.
 */

export function appEnv() {
  const explicit = (process.env.APP_ENV || "").toLowerCase();
  if (explicit === "staging" || explicit === "production" || explicit === "development") {
    return explicit;
  }

  const vercelEnv = (process.env.VERCEL_ENV || "").toLowerCase();
  if (vercelEnv === "production") return "production";
  if (vercelEnv === "preview") return "staging";

  if (process.env.NODE_ENV !== "production") return "development";

  // Production build, no trustworthy signal: refuse to assume prod data — fail safe.
  return "staging";
}

export function isStaging() {
  return appEnv() === "staging";
}

// True ONLY on the real production site. Staging and local resolve to false, so they use
// the dev database and dev storage bucket. This is the single switch that repoints data.
export function isProdData() {
  return appEnv() === "production";
}

// External outreach (transactional email, Airtable sync, Formspree) is allowed only on
// the real production site — never on staging or local.
export function outreachEnabled() {
  return appEnv() === "production";
}
