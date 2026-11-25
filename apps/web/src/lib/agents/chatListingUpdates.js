/*
 * Listing updates from what a landlord says in chat (Ben's idea, Wyatt
 * 2026-11-25).
 *
 * A landlord who writes "we don't have any units available at 841 Westgate"
 * to a student has told us the listing is out of date. Each message a
 * listing's owner sends in a student chat (in the app or by email reply) is
 * read once: does it state that the listing itself changed (taken, available
 * again, a new move-in date, a new rent)? If so, and we are sure enough, the
 * listing changes at once.
 *
 * Wyatt's decisions (2026-11-25):
 *   - every listing, not only agent pilots
 *   - applies on its own and silently (no email to anyone)
 *   - undo from the landlord's Agent tab and the admin sync decisions list:
 *     each change is a listing_source_events row (detail.source 'chat'), so
 *     the sync ledger's Undo (sourceImport/decisions.js) works on it
 *   - only high confidence, scored the sync ledger's way (sourceImport/score.js):
 *       score = landlord trust x Jev "what does the message say" x
 *               the message names the property (code)
 *     and it must clear CHAT_BAR. No confidence check, no change.
 *   - generic statements are ignored. "We're fully leased" says nothing
 *     about which property: a message must name the property's address or
 *     title, or the unit (namesTheProperty). And a
 *     statement about now ("currently fully leased") never touches an
 *     offering with a later move-in (a listing advertising next year).
 *
 * A change is the landlord's own edit (core provenance, landlord_set), so a
 * website that still shows the old value does not put it back.
 *
 * Left alone on purpose:
 *   - anything true only for this student ("won't work for 3 people",
 *     "another application is pending", "filled for your dates")
 *   - other properties the landlord mentions (a lead, not a change)
 *   - "taken" on a listing with several offerings when the message does not
 *     say which one
 *   - hedged statements ("might", "probably", "I think")
 *   - messages from anyone but an owner of the listing
 *
 * CHAT_LISTING_UPDATES: unset or "on" applies; "dry_run" records only; "off".
 */
import { z } from "zod";
import supabase from "@/lib/supabase";
import { parseStructured, SONNET } from "./model";
import { money, shortDate, todayChicago } from "./sections";
import { applyCoreChange } from "./coreWrites";
import { askJev, expectedProbability, jevOn } from "@/lib/sourceImport/jev";
import { planChanges, namesTheProperty } from "./chatListingRules";
import { TRUST, claimScore } from "@/lib/sourceImport/score";

const FRESH_MS = 14 * 24 * 3600 * 1000;
const MAX_LEASES = 80;
/* How sure we must be. Above the sync's own bars (0.75 to 0.85): Wyatt wants high confidence. */
export const CHAT_BAR = 0.85;

export function chatUpdatesMode() {
  const v = String(process.env.CHAT_LISTING_UPDATES ?? "").trim().toLowerCase();
  if (["off", "false", "0", "no"].includes(v)) return "off";
  if (v === "dry_run") return "dry_run";
  return "apply";
}

const Change = z.object({
  offering: z.string().describe("The offering code from the list (\"O1\", \"O2\", ...), or \"ALL\" when the landlord says the whole property has nothing available."),
  field: z.enum(["unavailable", "available_from", "rent"]).describe("unavailable: the offering is taken / off the market (value \"true\") or available again (value \"false\"). available_from: the first move-in date, value YYYY-MM-DD. rent: monthly rent in dollars, value a number."),
  value: z.string().describe("The new value as text: \"true\"/\"false\", a YYYY-MM-DD date, or a number."),
});

const Reading = z.object({
  about: z.enum(["listing_change", "this_student_only", "other_property", "nothing"]).describe(
    "listing_change: the landlord states, as a fact, that THIS listing has changed for everyone (taken, leased, no units available, available again, a new move-in date, a new rent). this_student_only: true only for this student's situation (group size, their dates, their application, a unit 'pending' another applicant). other_property: about a different property. nothing: no change stated (questions, scheduling, pleasantries, hedged or uncertain statements)."
  ),
  quote: z.string().describe("The exact words from the message that state the change, copied character for character. Empty when about is not listing_change."),
  changes: z.array(Change).describe("The changes to this listing. Empty unless about is listing_change. If the landlord says something is taken but it is not clear WHICH offering, and the listing has more than one, leave this empty and say so in reason."),
  reason: z.string().describe("One short plain sentence explaining the call."),
});

const SYSTEM = `You read one message a landlord sent to a student about a rental listing on Proximity, a student housing site, and decide whether it tells us the LISTING ITSELF is out of date.

Only a plain statement of fact about the listing counts: "we don't have any units available at this address", "that apartment has been leased", "the 2 bedroom is rented", "it's available again", "it won't be available until August 1", "rent is now $1,450". Hedged or uncertain wording ("might", "probably", "should be", "I think") does not count.

Things that are NOT listing changes:
- anything about this student only: group size, their move-in dates, their application, "it's pending another application", "it won't work for 3 people"
- other properties the landlord mentions or links
- tour scheduling, questions, pleasantries

Match each change to an offering code from the list. When the landlord says the property has nothing available, use "ALL". When they say one apartment is taken and the list has several, only pick an offering if the message makes clear which one; otherwise return no changes. A future date ("not available until August 1") is an available_from change, not "unavailable". Never invent values.`;

function describeOfferings(leases) {
  return leases.map((l) => {
    const u = l.listing_units ?? {};
    const parts = [
      `${l.code}`,
      `"${u.name || u.title || "Unit"}"`,
      u.bedrooms != null ? `${u.bedrooms} bd` : null,
      u.bathrooms != null ? `${u.bathrooms} ba` : null,
      l.rent != null ? `${money(l.rent)}${l.rent_is_per_person ? " per person" : ""}` : "no rent shown",
      l.available_from ? `from ${shortDate(l.available_from)}` : "available now",
      l.unavailable || l.is_active === false ? "OFF the market" : "on the market",
    ].filter(Boolean);
    return parts.join(" | ");
  }).join("\n");
}

/* The thread, its listing, owners and offerings. null when not applicable. */
export async function loadContext(threadId) {
  const { data: thread } = await supabase.from("chat_threads")
    .select("id, listing_id, landlord_id, interested_user_id, lease_id, deleted_at, listing:listings!listing_id(id, title, address, deleted_at)")
    .eq("id", threadId).maybeSingle();
  if (!thread?.listing_id || thread.deleted_at || thread.listing?.deleted_at) return null;
  const [{ data: owners }, { data: units }] = await Promise.all([
    supabase.from("listing_landlords").select("user_id").eq("listing_id", thread.listing_id),
    supabase.from("listing_units").select("id").eq("listing_id", thread.listing_id).is("deleted_at", null),
  ]);
  const unitIds = (units ?? []).map((u) => u.id);
  const { data: leaseRows } = unitIds.length
    ? await supabase.from("unit_leases")
      .select("id, unit_id, rent, rent_is_per_person, available_from, unavailable, is_active, owner_id, listing_units!unit_id(name, title, bedrooms, bathrooms)")
      .in("unit_id", unitIds).is("deleted_at", null).order("created_at", { ascending: true }).limit(MAX_LEASES)
    : { data: [] };
  const leases = (leaseRows ?? []).map((l, i) => ({ ...l, code: `O${i + 1}` }));
  return { thread, listing: thread.listing, ownerIds: (owners ?? []).map((o) => o.user_id), leases };
}

/* Ask the model about one message. Never throws (returns null). */
export async function readMessage({ text, ctx, recent = [], today = null }) {
  try {
    const history = recent.length
      ? `Earlier in this chat (oldest first):\n${recent.map((m) => `${m.side}: ${String(m.body ?? "").slice(0, 400)}`).join("\n")}\n\n`
      : "";
    const { parsed } = await parseStructured({
      model: SONNET, listingId: ctx.listing.id, kind: "chat_listing_update", tag: "chat-listing-update", maxTokens: 600,
      system: SYSTEM,
      messages: [{
        role: "user",
        content: `Today is ${today ?? todayChicago()}.\n\nListing: ${ctx.listing.title ?? ""} (${ctx.listing.address ?? "no address"})\nOfferings:\n${describeOfferings(ctx.leases) || "(none)"}\n\n${history}The landlord's new message:\n"""${text.slice(0, 3000)}"""`,
      }],
      schema: Reading,
    });
    return parsed ?? null;
  } catch (err) {
    console.error("chatListingUpdates: read failed:", err?.message ?? err);
    return null;
  }
}

const TAKEN = "nothing available, it is taken or fully leased";
const AVAILABLE = "available";
const UNSURE = "unsure or hedged";
const OTHER = "not about that";

/*
 * The Jev question for one change, as a pick-one (sharper than yes/no on
 * chat messages, tested 2026-11-25: "taken" statements 1.00, hedged 0.01,
 * true-for-this-student 0.17, about another property 0.00).
 * Returns { question, expect }.
 */
function claimQuestion(c, { listing, allOfIt, name }) {
  const street = listing.address ? listing.address.split(",")[0] : listing.title || "this property";
  const target = allOfIt || !c.unit ? street : `${c.unit} at ${street}`;
  if (c.field === "unavailable") {
    return {
      question: { type: "choice", name, instructions: `What does the landlord say about whether ${target} can be rented?`, choices: [{ value: TAKEN }, { value: AVAILABLE }, { value: UNSURE }, { value: OTHER }] },
      expect: { kind: "choice", value: c.to ? TAKEN : AVAILABLE },
    };
  }
  if (c.field === "available_from") {
    const said = `from ${c.to}`;
    return {
      question: { type: "choice", name, instructions: `What does the landlord say about when ${target} can be moved into? (today's year applies when none is given)`, choices: [{ value: said }, { value: "a different date" }, { value: UNSURE }, { value: OTHER }] },
      expect: { kind: "choice", value: said },
    };
  }
  const said = `${money(c.to)} a month`;
  return {
    question: { type: "choice", name, instructions: `What monthly rent does the landlord state for ${target}?`, choices: [{ value: said }, { value: "a different amount" }, { value: UNSURE }, { value: OTHER }] },
    expect: { kind: "choice", value: said },
  };
}

/*
 * Score each planned change the sync ledger's way:
 *   trust (landlord) x read quality (Jev) x right thing (code) x freshness (1, a new message)
 * Jev reads only the landlord's message. Returns the changes with
 * { score, parts }, or null when the check could not run (nothing applies then).
 */
export async function scoreChanges({ text, ctx, changes, allOfIt = false }) {
  if (!changes.length) return [];
  const listing = ctx.listing;
  const named = changes.map((c) => namesTheProperty(text, { listing, unit: allOfIt ? null : c.unit }));
  const asked = changes.map((c, i) => (named[i] ? claimQuestion(c, { listing, allOfIt, name: `c${i}` }) : null));
  let answers = {};
  if (asked.some(Boolean)) {
    if (!jevOn()) return null;
    try {
      ({ answers } = await askJev(text.slice(0, 4000), asked.filter(Boolean).map((a) => a.question)));
    } catch (err) {
      console.error("chatListingUpdates: Jev failed:", err?.message ?? err);
      return null;
    }
  }
  return changes.map((c, i) => {
    const readQuality = asked[i] ? expectedProbability(answers[`c${i}`], asked[i].expect) : null;
    const parts = { trust: TRUST.landlord, readQuality: readQuality ?? 0, rightThing: named[i] ? 1 : 0, freshness: 1 };
    return { ...c, score: claimScore(parts), parts, ...(named[i] ? {} : { why: "the message does not name the property or the unit" }) };
  });
}

async function recentMessages(thread, beforeIso, limit = 6) {
  const { data } = await supabase.from("chat_messages").select("sender_id, body, created_at")
    .eq("thread_id", thread.id).is("deleted_at", null).lt("created_at", beforeIso)
    .order("created_at", { ascending: false }).limit(limit);
  return (data ?? []).reverse().map((m) => ({ ...m, side: m.sender_id === thread.landlord_id ? "Landlord" : "Student" }));
}

/*
 * The whole read for one message, with every check, and no writes.
 * Returns { eligible, reason?, reading?, changes?, skipped? }; each change
 * carries { score, parts, apply }.
 */
export async function evaluateMessage({ threadId, messageId, senderId, body, createdAt = null, requireFresh = true }) {
  const text = String(body ?? "").trim();
  if (!threadId || !messageId || !senderId || text.length < 8) return { eligible: false, reason: "empty" };
  if (requireFresh && createdAt && Date.now() - Date.parse(createdAt) > FRESH_MS) return { eligible: false, reason: "old message" };
  const ctx = await loadContext(threadId);
  if (!ctx) return { eligible: false, reason: "no listing" };
  if (senderId !== ctx.thread.landlord_id || !ctx.ownerIds.includes(senderId)) return { eligible: false, reason: "not an owner" };
  if (!ctx.leases.length) return { eligible: false, reason: "no offerings" };

  // Co-landlords: an owner changes only their own leases (unowned leases fall to the primary).
  const ownLeases = new Set(ctx.leases.filter((l) => !l.owner_id || l.owner_id === senderId).map((l) => l.id));
  const recent = await recentMessages(ctx.thread, createdAt ?? new Date().toISOString());
  // A replayed old message is read as of the day it was sent.
  const today = createdAt ? new Date(createdAt).toLocaleDateString("en-CA", { timeZone: "America/Chicago" }) : todayChicago();
  const reading = await readMessage({ text, ctx, recent, today });
  const planned = planChanges({ reading, text, leases: ctx.leases, ownerLeaseIds: ownLeases, today });
  const base = { eligible: true, ctx, listingId: ctx.listing.id, listing: ctx.listing.title, reading };
  if (!planned.changes.length) return { ...base, changes: [], skipped: planned.skipped };

  const allOfIt = (reading.changes ?? []).some((c) => String(c.offering).toUpperCase() === "ALL");
  const scored = await scoreChanges({ text, ctx, changes: planned.changes, allOfIt });
  if (!scored) return { ...base, changes: planned.changes.map((c) => ({ ...c, apply: false })), skipped: "confidence check could not run" };
  const changes = scored.map((c) => ({ ...c, apply: c.score >= CHAT_BAR }));
  const skipped = changes.some((c) => c.apply) ? null : changes.every((c) => c.why) ? "generic: the message does not name the property" : "not sure enough";
  return { ...base, changes, skipped };
}

/* The event row's shape for one change, in the sync's own terms. */
function eventFor(c) {
  if (c.field === "unavailable") {
    return { kind: c.to ? "lease_withdrawn" : "unit_relisted", field: "unavailable", old_value: { unavailable: !!c.from }, new_value: { unavailable: !!c.to } };
  }
  if (c.field === "available_from") return { kind: "lease_updated", field: "availableFrom", old_value: { availableFrom: c.from }, new_value: { availableFrom: c.to } };
  return { kind: "rent_change", field: "rent", old_value: { rent: c.from }, new_value: { rent: c.to } };
}

/* What to put back on Undo: the columns this change wrote, and what they were. */
function undoFor(c) {
  if (c.field === "unavailable") {
    return { op: "lease_restore", leaseId: c.leaseId, values: { unavailable: !!c.from, is_active: c.wasActive }, wrote: { unavailable: !!c.to, is_active: !c.to } };
  }
  const col = c.field === "available_from" ? "available_from" : "rent";
  return { op: "lease_restore", leaseId: c.leaseId, values: { [col]: c.from }, wrote: { [col]: c.to } };
}

/*
 * Apply one scored change as the landlord's own edit and record it as a
 * sync-style event with an Undo. Returns { ok, eventId } or { error }.
 */
async function applyOne({ c, ctx, senderId, messageId, threadId, quote }) {
  const r = await applyCoreChange({
    listingId: ctx.listing.id, userId: senderId, cause: "landlord_chat",
    change: { target: "lease", id: c.leaseId, field: c.field, value: c.to },
  });
  if (!r?.ok) return { error: r?.error ?? "not applied" };
  const ev = eventFor(c);
  const { data, error } = await supabase.from("listing_source_events").insert({
    monitor_id: null,
    listing_id: ctx.listing.id,
    ...ev,
    confidence: "high",
    status: "applied",
    applied: true,
    detail: {
      source: "chat",
      messageId,
      threadId,
      leaseId: c.leaseId,
      label: c.unit ?? null,
      quote,
      note: "from the landlord's message to a student",
      ledger: { source: "chat", score: c.score, need: CHAT_BAR, ...c.parts },
      undo: undoFor(c),
    },
  }).select("id").maybeSingle();
  if (error) console.error("chatListingUpdates: event not saved:", error.message);
  return { ok: true, eventId: data?.id ?? null };
}

/*
 * Hook: called after a message is posted (app send route and email relay).
 * Reads it, applies what clears the bar, and keeps the outcome on the
 * message (chat_messages.metadata.listingUpdate) for Admin > Conversations.
 * Never throws.
 */
export async function detectListingUpdate({ threadId, messageId, senderId, body, createdAt = null, requireFresh = true, mode = chatUpdatesMode() }) {
  try {
    if (mode === "off") return { eligible: false, reason: "off" };
    const { data: msg } = await supabase.from("chat_messages").select("metadata").eq("id", messageId).maybeSingle();
    // Read once: a retry or a second hook call never applies twice.
    if (msg?.metadata?.listingUpdate) return { eligible: false, reason: "already read" };
    const r = await evaluateMessage({ threadId, messageId, senderId, body, createdAt, requireFresh });
    if (!r.eligible || !r.reading || r.reading.about === "nothing") return r;

    const changes = [];
    for (const c of r.changes) {
      const row = { leaseId: c.leaseId, unit: c.unit, field: c.field, from: c.from, to: c.to, score: c.score ?? null, parts: c.parts ?? null, apply: !!c.apply };
      if (c.apply && mode === "apply") {
        const done = await applyOne({ c, ctx: r.ctx, senderId, messageId, threadId, quote: r.reading.quote });
        if (done.ok) Object.assign(row, { applied: true, eventId: done.eventId });
        else Object.assign(row, { applied: false, error: done.error });
      }
      changes.push(row);
    }
    const record = {
      mode,
      at: new Date().toISOString(),
      about: r.reading.about,
      quote: r.reading.quote || null,
      reason: r.reading.reason || null,
      bar: CHAT_BAR,
      changes,
      skipped: r.skipped,
    };
    await supabase.from("chat_messages").update({ metadata: { ...(msg?.metadata ?? {}), listingUpdate: record } }).eq("id", messageId);
    return { ...r, ctx: undefined, record };
  } catch (err) {
    console.error("chatListingUpdates: detect failed:", err?.message ?? err);
    return { eligible: false, reason: "error" };
  }
}

export { changeLabel, planChanges, availableNow, namesTheProperty } from "./chatListingRules";
