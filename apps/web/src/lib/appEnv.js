/*
 * Central environment / data-target helper.
 *
 * Distinguishes the real production site from the STAGING environment. Staging runs as a
 * Vercel "production" build, but must behave as a sandbox: it points at the DEV database
 * and DEV storage bucket, shows a banner, and has external outreach (emails, Airtable,
 * Formspree) disabled — so the team can test on a fresh prod-data snapshot without
 * touching real production data or contacting real users.
 *
 * Set APP_ENV=staging on the staging deployment. When APP_ENV is unset we fall back to
 * NODE_ENV, so local dev and the real production site behave exactly as before.
 */

export function appEnv() {
  const v = (process.env.APP_ENV || "").toLowerCase();
  if (v === "staging" || v === "production" || v === "development") return v;
  return process.env.NODE_ENV === "production" ? "production" : "development";
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
