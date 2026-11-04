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
