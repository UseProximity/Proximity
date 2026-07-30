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

/*
 * PILOT MODE — a landlord-facing sandbox on its own domain.
 *
 * A pilot has to be a Vercel PRODUCTION deployment (of its own project), because
 * Vercel Cron Jobs only fire on production deployments — a preview would never run
 * the nightly sync that the pilot exists to demonstrate. But being a production
 * deployment sets VERCEL_ENV=production, which would otherwise resolve this whole
 * module to "production" and point a landlord demo at the REAL database, sending
 * REAL email to real users.
 *
 * PILOT_MODE closes that gap at the only two places it can hurt: data target and
 * outreach. It is checked *independently* of appEnv() rather than folded into the
 * resolver, so it cannot be undone by APP_ENV being set (or mis-set) alongside it —
 * a pilot is never prod data, no matter what else the environment says.
 */
export function isPilot() {
  return process.env.PILOT_MODE === "1";
}

// True ONLY on the real production site. Staging, local, and pilot resolve to false,
// so they use the dev database and dev storage bucket. This is the single switch that
// repoints data.
export function isProdData() {
  return !isPilot() && appEnv() === "production";
}

// External outreach (transactional email, Airtable sync, Formspree) is allowed only on
// the real production site — never on staging, local, or a pilot. A pilot still needs
// to mail its own operators; that goes through OUTREACH_ALLOWLIST in outreach.js, which
// requires every recipient to be named explicitly.
export function outreachEnabled() {
  return !isPilot() && appEnv() === "production";
}
