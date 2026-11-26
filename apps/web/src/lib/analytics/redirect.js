/*
 * Where an old /analytics address goes now: the matching tab of the admin Analytics page,
 * keeping the period. Unknown tabs open the first tab. The slugs are the ones /analytics used
 * (lib/analytics/tabs/index.js), so every old bookmark has a match.
 *
 * Pure; no "@/" imports (Node test runner loads it).
 */

export const ADMIN_ANALYTICS_PATH = "/dashboard/admin/analytics";

export const ANALYTICS_SLUGS = ["overview", "matchmaking", "landlords", "engagement", "reviews", "lease-check", "traffic", "marketing"];

export function analyticsRedirectTarget(slug, searchParams) {
  const tab = ANALYTICS_SLUGS.includes(slug) ? slug : ANALYTICS_SLUGS[0];
  const query = new URLSearchParams({ tab });
  const raw = searchParams?.weeks;
  const weeks = Array.isArray(raw) ? raw[0] : raw;
  if (typeof weeks === "string" && /^\d{1,2}$/.test(weeks)) query.set("weeks", weeks);
  return `${ADMIN_ANALYTICS_PATH}?${query.toString()}`;
}
