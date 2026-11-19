/*
 * Retention for attribution data (PRD section 9): sessions never linked to an
 * account, with their touchpoints, are deleted after 13 months, and so are the
 * duplicate-rejection counters. Sessions linked to an account stay until the
 * account is purged (api/cron/purge-accounts).
 *
 * Pure; no "@/" imports (Node test runner loads it).
 */

export const RETENTION_MONTHS = 13;

/** The moment 13 calendar months before `now` (UTC), as an ISO string. */
export function retentionCutoff(now = new Date()) {
  const d = new Date(now);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - RETENTION_MONTHS);
  // Clamp to the month's last day (31 March minus 13 months is 28/29 February).
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.toISOString();
}
