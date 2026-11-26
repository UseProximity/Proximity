/*
 * Follow-ups for conversations that went quiet (Wyatt, 2026-10-16).
 *
 * Two pieces live here:
 *
 * 1. The "no reply" note. A student who messaged a landlord and has heard
 *    nothing back at all after NO_REPLY_AFTER_DAYS sees a quiet note in the
 *    conversation pointing them at similar listings. Nothing is sent: the note
 *    is worked out every time the inbox loads (annotateNoReply), so it goes
 *    away by itself the moment the landlord writes anything. It only covers
 *    landlords who never answered; one who replied and then went quiet gets
 *    no note. When the listing is no longer available the note shows straight
 *    away, without waiting the 5 days.
 *
 * 2. Listing availability for the reminder email the daily check-in sends
 *    (api/cron/chat-checkin). No reminder goes out about a listing that is off
 *    the market.
 */
import supabase from "@/lib/supabase";
import { listingIsUnavailable } from "@/lib/listings/unitAvailability";

export const NO_REPLY_AFTER_DAYS = 5;
// The check-in alerts on any silence of 3 days or more, however old. Reminders
// only go out for silences that started inside this window, so the first run
// does not email everyone with a months-old unanswered message.
export const REMINDER_MAX_AGE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The ids, out of `listingIds`, that a student could not rent today: deleted,
 * flagged unavailable by the owner, or with no live offering left.
 * Fails open (empty set) on a lookup error, since this only softens copy and
 * skips emails.
 */
export async function unavailableListingIds(listingIds) {
  const ids = [...new Set((listingIds ?? []).filter(Boolean))];
  if (ids.length === 0) return new Set();

  const { data, error } = await supabase
    .from("listings")
    .select("id, unavailable, deleted_at, listing_units!listing_id(deleted_at, unit_leases!unit_id(is_active, unavailable))")
    .in("id", ids);
  if (error) {
    console.error("unavailableListingIds failed:", error);
    return new Set();
  }

  const found = new Map((data ?? []).map((l) => [l.id, l]));
  const out = new Set();
  for (const id of ids) {
    const l = found.get(id);
    if (!l || l.deleted_at) {
      out.add(id);
      continue;
    }
    const row = { ...l, listing_units: (l.listing_units ?? []).filter((u) => !u.deleted_at) };
    if (listingIsUnavailable(row)) out.add(id);
  }
  return out;
}

/**
 * Inbox view of the no-reply note. Adds `noReply` to each thread the viewer
 * started as the student where the landlord has never sent a message:
 *   { since, listingUnavailable }
 * `since` is the student's first message. The note is set once that is
 * NO_REPLY_AFTER_DAYS old, or straight away when the listing is unavailable.
 * Every other thread gets `noReply: null`. Threads marked `unavailable` (the
 * other person blocked the viewer) are left alone. Fails open: on a lookup
 * error the threads come back without notes.
 */
export async function annotateNoReply(userId, threads, { now = new Date() } = {}) {
  if (!Array.isArray(threads) || threads.length === 0) return threads ?? [];
  const candidates = threads.filter((t) => t.isInterestedUser && t.otherUserId && t.listingId && !t.unavailable);
  if (candidates.length === 0) return threads.map((t) => ({ ...t, noReply: null }));

  const ids = candidates.map((t) => t.threadId);
  const [theirs, mine] = await Promise.all([
    supabase
      .from("chat_messages")
      .select("thread_id")
      .in("thread_id", ids)
      .is("deleted_at", null)
      .not("sender_id", "is", null)
      .neq("sender_id", userId),
    supabase
      .from("chat_messages")
      .select("thread_id, created_at")
      .in("thread_id", ids)
      .is("deleted_at", null)
      .eq("sender_id", userId)
      .order("created_at", { ascending: true }),
  ]);
  if (theirs.error || mine.error) {
    console.error("annotateNoReply failed:", theirs.error || mine.error);
    return threads.map((t) => ({ ...t, noReply: null }));
  }

  const answered = new Set((theirs.data ?? []).map((m) => m.thread_id));
  const firstMine = new Map();
  for (const m of mine.data ?? []) {
    if (!firstMine.has(m.thread_id)) firstMine.set(m.thread_id, m.created_at);
  }

  const waiting = candidates.filter((t) => !answered.has(t.threadId) && firstMine.has(t.threadId));
  const unavailable = await unavailableListingIds(waiting.map((t) => t.listingId));
  const cutoff = now.getTime() - NO_REPLY_AFTER_DAYS * DAY_MS;

  const notes = new Map();
  for (const t of waiting) {
    const since = firstMine.get(t.threadId);
    const listingUnavailable = unavailable.has(t.listingId);
    if (listingUnavailable || new Date(since).getTime() <= cutoff) {
      notes.set(t.threadId, { since, listingUnavailable });
    }
  }
  return threads.map((t) => ({ ...t, noReply: notes.get(t.threadId) ?? null }));
}

export function silenceIsTooOld(silentSince, now = new Date()) {
  return now.getTime() - new Date(silentSince).getTime() > REMINDER_MAX_AGE_DAYS * DAY_MS;
}
