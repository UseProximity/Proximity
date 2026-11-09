/*
 * The switches for the per-listing agents (PRD v3, 2026-10-26).
 *
 * Every milestone of the agents project lands on staging, and staging is
 * released to production on its own schedule, so the whole feature ships
 * switched off and is turned on in two steps:
 *
 *   global        LISTING_AGENTS_ENABLED. Off everywhere unless set, except
 *                 local development, where it defaults to on so the work can
 *                 be seen. Crons and Proxy do nothing while it is off.
 *   per listing   listing_agents.status: 'off' until the listing joins the
 *                 pilot ('pilot'), then 'on' for everyone. Proxy answers on a
 *                 listing only when both switches are on.
 *
 * Reading facts (the read API, the landlord's knowledge view) is not gated:
 * the knowledge store is just data about the listing.
 */
import { appEnv } from "@/lib/appEnv";

const ON = new Set(["1", "true", "on", "yes"]);
const OFF = new Set(["0", "false", "off", "no"]);

export function agentsEnabled() {
  const v = String(process.env.LISTING_AGENTS_ENABLED ?? "").trim().toLowerCase();
  if (ON.has(v)) return true;
  if (OFF.has(v)) return false;
  return appEnv() === "development";
}

export const LIVE_STATUSES = new Set(["pilot", "on"]);

/* Proxy answers on this listing: both switches on. */
export function agentIsLive(agentRow) {
  return agentsEnabled() && !!agentRow && LIVE_STATUSES.has(agentRow.status);
}

/*
 * Launch review for the website sync (Wyatt, 2026-11-07). While on, nothing a
 * student sees changes on its own from a sync: every change is recorded for
 * the Proximity team, who apply or reject it from the admin queue, and the
 * landlord sees none of it. On unless WEBSITE_SYNC_TEAM_REVIEW is set to off,
 * so a missing variable fails safe.
 */
export function syncTeamReview() {
  const v = String(process.env.WEBSITE_SYNC_TEAM_REVIEW ?? "").trim().toLowerCase();
  return !OFF.has(v);
}

/*
 * Source search (pages about a listing found on Zillow, Apartments.com and the
 * web) and reading those pages into knowledge. Off for launch (Wyatt,
 * 2026-11-07): only pages a landlord uploaded or gave us are sources. On only
 * when FOUND_SOURCES_ENABLED is set to on.
 */
export function foundSourcesEnabled() {
  const v = String(process.env.FOUND_SOURCES_ENABLED ?? "").trim().toLowerCase();
  return ON.has(v);
}
