/*
 * Server-side reads and writes for marketing_sessions and touchpoints.
 *
 * A session is live while its last beacon is under 30 minutes old (the cookie
 * expires at the same moment; this check is the server's own guard). The
 * first source owns the session: later campaign arrivals become touchpoints
 * and never change it (PRD D4).
 */
import supabase from "@/lib/supabase";
import { SESSION_COOKIE, SESSION_IDLE_SECONDS, isUuid } from "./config";

const SESSION_FIELDS = "id, started_at, last_seen_at, source, medium, campaign, content, link_id, user_id";

/** The marketing session id from the request cookie, or null. */
export async function readSessionCookie(req) {
  try {
    let value = req?.cookies?.get?.(SESSION_COOKIE)?.value;
    if (value === undefined) {
      const { cookies } = await import("next/headers");
      value = (await cookies()).get(SESSION_COOKIE)?.value;
    }
    return isUuid(value) ? value : null;
  } catch {
    return null; // outside a request scope (cron, scripts)
  }
}

/** The session row if it exists and is still live, else null. */
export async function loadLiveSession(sessionId, now = Date.now()) {
  if (!isUuid(sessionId)) return null;
  const { data, error } = await supabase
    .from("marketing_sessions")
    .select(SESSION_FIELDS)
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const idleMs = now - new Date(data.last_seen_at).getTime();
  return idleMs <= SESSION_IDLE_SECONDS * 1000 ? data : null;
}

/** A registered campaign link by slug (archived links still attribute). */
export async function findLinkBySlug(slug) {
  if (!slug) return null;
  const { data, error } = await supabase
    .from("marketing_links")
    .select("id, slug, source, medium, campaign, content")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

/** A link's destination for /go/<slug>, or null when the slug is not registered. */
export async function findLinkDestination(slug) {
  if (!slug) return null;
  const { data, error } = await supabase.from("marketing_links").select("destination_path").eq("slug", slug).maybeSingle();
  if (error) throw error;
  return data || null;
}

const sessionColumns = (c) => ({
  source: c.source,
  medium: c.medium,
  campaign: c.campaign,
  content: c.content,
  term: c.term,
  gclid: c.gclid,
  classified_from: c.classified_from,
  link_id: c.link_id,
});

export async function createSession(classification, { landingPath, userId }) {
  const { data, error } = await supabase
    .from("marketing_sessions")
    .insert({
      ...sessionColumns(classification),
      referrer_host: classification.referrer_host,
      tags_cleaned: Boolean(classification.tags_cleaned),
      landing_path: landingPath,
      user_id: userId || null,
    })
    .select(SESSION_FIELDS)
    .single();
  if (error) throw error;
  return data;
}

/** Renew the session and attach the signed-in user if it has none yet. */
export async function touchSession(session, { userId }) {
  const patch = { last_seen_at: new Date().toISOString() };
  if (userId && !session.user_id) patch.user_id = userId;
  const { error } = await supabase.from("marketing_sessions").update(patch).eq("id", session.id);
  if (error) throw error;
}

/** Attach a user to a session (signup or sign-in mid-session). Never throws. */
export async function attachUserToSession(sessionId, userId) {
  if (!isUuid(sessionId) || !isUuid(userId)) return;
  try {
    await supabase.from("marketing_sessions").update({ user_id: userId }).eq("id", sessionId).is("user_id", null);
  } catch (err) {
    console.error("marketing: attach user to session failed:", err?.message || err);
  }
}

/*
 * Record a later campaign arrival inside a live session. Skipped when it
 * repeats the session's own source or the previous touchpoint, so reloading a
 * tagged URL does not pile up identical rows.
 */
export async function addTouchpoint(session, classification, path) {
  const same = (a) =>
    a &&
    a.source === classification.source &&
    a.medium === classification.medium &&
    (a.campaign ?? null) === (classification.campaign ?? null) &&
    (a.content ?? null) === (classification.content ?? null) &&
    (a.link_id ?? null) === (classification.link_id ?? null);
  if (same(session)) return false;

  const { data: last } = await supabase
    .from("marketing_touchpoints")
    .select("source, medium, campaign, content, link_id")
    .eq("session_id", session.id)
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (same(last)) return false;

  const { error } = await supabase
    .from("marketing_touchpoints")
    .insert({ ...sessionColumns(classification), session_id: session.id, path });
  if (error) throw error;
  return true;
}
