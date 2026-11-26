import supabase from "@/lib/supabase";
import { GROUP_OPTIONS, QUESTION_COUNT } from "@/lib/findYourPlace/options";

/*
 * Find Your Place's own record of the moments that leave no search row: which
 * page someone left on, a failed search, the homepage popup. Every search that
 * brought back an answer is recorded too (`searched`, Wyatt 2026-11-19): a search
 * row only counts its runs while it lasts, so the share of searches that failed
 * needs its own count of the ones that worked. Kept in our
 * database (the `events` table, unused since its old page-view logging stopped
 * in May 2026) so the admin Analytics tab can read it without Google Analytics,
 * and so the mobile app, once it moves to this flow, records the same events
 * through the same endpoint.
 *
 * Every row is `fyp_<name>`, so it never mixes with the old rows. Only the
 * fields listed here are kept, each checked against its allowed values: never
 * typed text, never a listing or an answer the student wrote.
 *
 * Rows stay when an account is deleted, unlinked from it (purge-accounts).
 */

export const EVENT_PREFIX = "fyp_";

// Pages of the flow, plus the two moments on page 3 before any match is seen.
export const STAGES = ["basics", "preferences", "loading", "error", "matches"];
export const FAIL_REASONS = ["invalid", "busy", "cap", "error"];

const int = (lo, hi) => (v) => (Number.isInteger(v) && v >= lo && v <= hi ? v : undefined);
const oneOf = (list) => (v) => (list.includes(v) ? v : undefined);
const bool = (v) => (typeof v === "boolean" ? v : undefined);

// Event name -> the fields it may carry and how each is checked.
const FIELDS = {
  opened: { resumed: bool, fromPopup: bool, fromBar: bool },
  exited: { stage: oneOf(STAGES), answered: int(0, QUESTION_COUNT) },
  started_over: { stage: oneOf(STAGES) },
  // From page 3: "matches", or "loading"/"error" when none were on screen yet.
  preferences_edited: { stage: oneOf(STAGES) },
  cap_sign_in: {},
  popup_shown: {},
  popup_clicked: { group: oneOf(GROUP_OPTIONS) },
  popup_dismissed: {},
  // The homepage hero bar's Start Matching, with how many of its three were filled.
  bar_started: { filled: int(0, 3) },
  // Server only: never accepted from the browser.
  search_failed: { reason: oneOf(FAIL_REASONS), retry: bool },
  // A search that answered. rerun: the same search run again (Back, then Show My Matches).
  searched: { retry: bool, rerun: bool },
};
export const SERVER_EVENTS = ["search_failed", "searched"];
export const CLIENT_EVENTS = Object.keys(FIELDS).filter((name) => !SERVER_EVENTS.includes(name));

export function cleanMetadata(name, raw) {
  const fields = FIELDS[name];
  if (!fields) return null;
  const out = {};
  for (const [key, check] of Object.entries(fields)) {
    const value = check(raw?.[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/*
 * Write one event. Never throws: tracking must not break a search or a page.
 * `visitorId` is the prx_vid device cookie when the browser has one, so
 * signed-out events from one device can be counted together.
 */
export async function recordFypEvent({ name, userId = null, visitorId = null, page = "/find-your-place", metadata = {} }) {
  const clean = cleanMetadata(name, metadata);
  if (!clean) return;
  try {
    const { error } = await supabase.from("events").insert({
      event_type: `${EVENT_PREFIX}${name}`,
      user_id: userId,
      session_id: visitorId,
      page,
      metadata: clean,
    });
    if (error) console.error("[find-your-place events] insert failed:", error.message);
  } catch (err) {
    console.error("[find-your-place events] insert failed:", err?.message);
  }
}
