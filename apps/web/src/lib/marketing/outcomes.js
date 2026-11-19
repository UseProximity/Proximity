/*
 * Canonical marketing outcomes (PRD section 6) and how each is deduplicated.
 *
 * The names match the check constraint on marketing_outcomes.outcome and the
 * tier matches its generated column. Existing trackEvent names are NOT these
 * names and are not renamed (GA reports depend on them).
 *
 * dedupe scopes ("Counted" column of the PRD):
 *   account          once per account
 *   session_subject  once per listing per session
 *   session          once per session
 *   subject          once per subject (application_submitted: per application)
 *   every            every one (subject id is the review / lease check id)
 *
 * Pure; no "@/" imports (Node test runner loads it).
 */
import { randomUUID } from "node:crypto";

export const OUTCOMES = {
  account_created: { tier: "account", scope: "account" },
  account_activated: { tier: "account", scope: "account" },
  proxy_question: { tier: "inquiry", scope: "session_subject" },
  landlord_message: { tier: "inquiry", scope: "session_subject" },
  tour_requested: { tier: "inquiry", scope: "session_subject" },
  application_started: { tier: "application", scope: "session_subject" },
  application_submitted: { tier: "application", scope: "subject" },
  waitlist_click: { tier: "engagement", scope: "session_subject" },
  review_submitted: { tier: "engagement", scope: "every" },
  lease_check_started: { tier: "engagement", scope: "every" },
  lease_check_completed: { tier: "engagement", scope: "every" },
  guides_visit: { tier: "engagement", scope: "session" },
  hub_visit: { tier: "engagement", scope: "session" },
};

export const OUTCOME_NAMES = Object.keys(OUTCOMES);

export function isOutcome(name) {
  return Object.prototype.hasOwnProperty.call(OUTCOMES, name);
}

/** UTC calendar day, used to bound sessionless "per session" outcomes. */
function dayKey(now) {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * The dedupe_key for an outcome, or null when it cannot be recorded (unknown
 * outcome, or a required id is missing). Every key starts with the outcome
 * name, so different inquiry channels never collapse into one.
 *
 * A sessionless outcome (mobile app, expired cookie) has no session to scope
 * "once per session" by, so it falls back to the user and the UTC day: one
 * per listing per user per day.
 */
export function buildDedupeKey(outcome, { sessionId = null, userId = null, subjectId = null, now = Date.now(), uuid = randomUUID } = {}) {
  const def = OUTCOMES[outcome];
  if (!def) return null;
  const scopeId = sessionId ? `s:${sessionId}` : userId ? `u:${userId}:${dayKey(now)}` : null;

  switch (def.scope) {
    case "account":
      return userId ? `${outcome}:${userId}` : null;
    case "session_subject":
      if (!subjectId) return null;
      return scopeId ? `${outcome}:${scopeId}:${subjectId}` : `${outcome}:${uuid()}`;
    case "session":
      return scopeId ? `${outcome}:${scopeId}` : null;
    case "subject":
      return subjectId ? `${outcome}:${subjectId}` : null;
    case "every":
      return `${outcome}:${subjectId || uuid()}`;
    default:
      return null;
  }
}

/** Page-visit outcomes the session beacon records for a path. */
export function visitOutcomesForPath(path) {
  const p = String(path ?? "").split(/[?#]/)[0].toLowerCase();
  const under = (prefix) => p === prefix || p.startsWith(`${prefix}/`);
  const out = [];
  if (under("/guides")) out.push("guides_visit");
  // /CampusHub and /washu (with building pages) are one outcome (edge case 21).
  if (under("/campushub") || under("/washu")) out.push("hub_visit");
  return out;
}
