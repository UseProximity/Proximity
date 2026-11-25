/*
 * Listing updates from what a landlord says in chat (Ben's idea, Wyatt
 * 2026-11-25).
 *
 * A landlord who writes "we don't have any units available at 841 Westgate"
 * to a student has told us the listing is out of date. Each message a
 * listing's owner sends in a student chat (in the app or by email reply) is
 * read once: does it say something about the listing itself has changed
 * (taken, available again, a new available-from date, a new rent)? If so,
 * the change is worked out against the listing's current offerings.
 *
 * Wyatt's decisions (2026-11-25): agent pilot listings only; changes apply
 * on their own and silently (no email to anyone), with an undo; phase 1 is
 * a dry run.
 *
 * PHASE 1 (this file today): DRY RUN. Nothing on the listing changes. What
 * would have changed is kept on the message (chat_messages.metadata
 * .listingUpdate) so the team can see it in Admin > Conversations, and the
 * replay tool can run the same read over past chats.
 *
 * Left alone on purpose:
 *   - anything true only for this student ("won't work for 3 people",
 *     "another application is pending", "filled for your dates")
 *   - other properties the landlord mentions (a lead, not a change)
 *   - "taken" on a listing with several offerings when the message does not
 *     say which one
 *   - hedged statements ("might", "probably", "I think")
 *   - messages from anyone but an owner of the listing
 */
import { z } from "zod";
import supabase from "@/lib/supabase";
import { parseStructured, SONNET } from "./model";
import { agentIsLive } from "./flags";
import { money, shortDate, todayChicago } from "./sections";

export const MODE = "dry_run";
const FRESH_MS = 14 * 24 * 3600 * 1000;
const MAX_LEASES = 80;

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
  const [{ data: owners }, { data: agent }, { data: units }] = await Promise.all([
    supabase.from("listing_landlords").select("user_id").eq("listing_id", thread.listing_id),
    supabase.from("listing_agents").select("status").eq("listing_id", thread.listing_id).maybeSingle(),
    supabase.from("listing_units").select("id").eq("listing_id", thread.listing_id).is("deleted_at", null),
  ]);
  const unitIds = (units ?? []).map((u) => u.id);
  const { data: leaseRows } = unitIds.length
    ? await supabase.from("unit_leases")
      .select("id, unit_id, rent, rent_is_per_person, available_from, unavailable, is_active, owner_id, listing_units!unit_id(name, title, bedrooms, bathrooms)")
      .in("unit_id", unitIds).is("deleted_at", null).order("created_at", { ascending: true }).limit(MAX_LEASES)
    : { data: [] };
  const leases = (leaseRows ?? []).map((l, i) => ({ ...l, code: `O${i + 1}` }));
  return { thread, listing: thread.listing, ownerIds: (owners ?? []).map((o) => o.user_id), agent: agent ?? null, leases };
}

const norm = (s) => String(s ?? "").toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, "\"").replace(/\s+/g, " ").trim();

function parseValue(field, raw) {
  const v = String(raw ?? "").trim();
  if (field === "unavailable") return /^(true|yes|1)$/i.test(v) ? true : /^(false|no|0)$/i.test(v) ? false : undefined;
  if (field === "available_from") return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
  if (field === "rent") {
    const n = Number(v.replace(/[$,\s]/g, ""));
    return Number.isFinite(n) && n >= 100 && n <= 20000 ? n : undefined;
  }
  return undefined;
}

const onMarket = (l) => !l.unavailable && l.is_active !== false;

/*
 * Turn the model's reading into concrete changes against the offerings.
 * Pure: no database, no model. Returns { changes, skipped } where skipped
 * says why nothing applies.
 */
export function planChanges({ reading, text, leases, ownerLeaseIds = null }) {
  if (!reading) return { changes: [], skipped: "could not read the message" };
  if (reading.about !== "listing_change") return { changes: [], skipped: reading.about };
  if (!reading.changes?.length) return { changes: [], skipped: "unclear which offering" };
  if (!reading.quote || !norm(text).includes(norm(reading.quote))) return { changes: [], skipped: "quote not found in the message" };
  const byCode = new Map(leases.map((l) => [l.code, l]));
  const out = [];
  const seen = new Set();
  for (const c of reading.changes) {
    const value = parseValue(c.field, c.value);
    if (value === undefined) continue;
    let targets;
    if (String(c.offering).toUpperCase() === "ALL") {
      // "Nothing available" withdraws what is on the market; other fields need a named offering.
      if (c.field !== "unavailable" || value !== true) continue;
      targets = leases.filter(onMarket);
    } else {
      const l = byCode.get(String(c.offering).toUpperCase());
      targets = l ? [l] : [];
    }
    for (const l of targets) {
      if (ownerLeaseIds && !ownerLeaseIds.has(l.id)) continue;
      const key = `${l.id}:${c.field}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const current = c.field === "unavailable" ? !onMarket(l) : c.field === "available_from" ? (l.available_from ? String(l.available_from).slice(0, 10) : null) : l.rent == null ? null : Number(l.rent);
      if (current === value) continue;
      out.push({
        leaseId: l.id,
        offering: l.code,
        unit: l.listing_units?.name || l.listing_units?.title || null,
        field: c.field,
        from: current,
        to: value,
      });
    }
  }
  return out.length ? { changes: out, skipped: null } : { changes: [], skipped: "already matches the listing" };
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

async function recentMessages(thread, beforeIso, limit = 6) {
  const { data } = await supabase.from("chat_messages").select("sender_id, body, created_at")
    .eq("thread_id", thread.id).is("deleted_at", null).lt("created_at", beforeIso)
    .order("created_at", { ascending: false }).limit(limit);
  return (data ?? []).reverse().map((m) => ({ ...m, side: m.sender_id === thread.landlord_id ? "Landlord" : "Student" }));
}

/*
 * The whole read for one message, with every check, and no writes.
 * Returns { eligible, reason?, reading?, changes?, skipped? }.
 * Options: requirePilot (live use), requireFresh (live use).
 */
export async function evaluateMessage({ threadId, messageId, senderId, body, createdAt = null, requirePilot = true, requireFresh = true }) {
  const text = String(body ?? "").trim();
  if (!threadId || !messageId || !senderId || text.length < 8) return { eligible: false, reason: "empty" };
  if (requireFresh && createdAt && Date.now() - Date.parse(createdAt) > FRESH_MS) return { eligible: false, reason: "old message" };
  const ctx = await loadContext(threadId);
  if (!ctx) return { eligible: false, reason: "no listing" };
  if (senderId !== ctx.thread.landlord_id || !ctx.ownerIds.includes(senderId)) return { eligible: false, reason: "not an owner" };
  if (requirePilot && !agentIsLive(ctx.agent)) return { eligible: false, reason: "not a pilot listing" };
  if (!ctx.leases.length) return { eligible: false, reason: "no offerings" };

  // Co-landlords: an owner changes only their own leases (unowned leases fall to the primary).
  const ownLeases = new Set(ctx.leases.filter((l) => !l.owner_id || l.owner_id === senderId).map((l) => l.id));
  const recent = await recentMessages(ctx.thread, createdAt ?? new Date().toISOString());
  // A replayed old message is read as of the day it was sent.
  const today = createdAt ? new Date(createdAt).toLocaleDateString("en-CA", { timeZone: "America/Chicago" }) : null;
  const reading = await readMessage({ text, ctx, recent, today });
  const { changes, skipped } = planChanges({ reading, text, leases: ctx.leases, ownerLeaseIds: ownLeases });
  return { eligible: true, listingId: ctx.listing.id, listing: ctx.listing.title, reading, changes, skipped };
}

/*
 * Hook: called after a message is posted (app send route and email relay).
 * Phase 1 records what would change on the message and changes nothing on
 * the listing. Never throws.
 */
export async function detectListingUpdate({ threadId, messageId, senderId, body, createdAt = null, requirePilot = true, requireFresh = true }) {
  try {
    const r = await evaluateMessage({ threadId, messageId, senderId, body, createdAt, requirePilot, requireFresh });
    if (!r.eligible || !r.reading || r.reading.about === "nothing") return r;
    const record = {
      mode: MODE,
      at: new Date().toISOString(),
      about: r.reading.about,
      quote: r.reading.quote || null,
      reason: r.reading.reason || null,
      changes: r.changes,
      skipped: r.skipped,
    };
    const { data: msg } = await supabase.from("chat_messages").select("metadata").eq("id", messageId).maybeSingle();
    await supabase.from("chat_messages").update({ metadata: { ...(msg?.metadata ?? {}), listingUpdate: record } }).eq("id", messageId);
    return { ...r, record };
  } catch (err) {
    console.error("chatListingUpdates: detect failed:", err?.message ?? err);
    return { eligible: false, reason: "error" };
  }
}

/* Plain words for one change, for the admin view and reports. */
export function changeLabel(c) {
  const what = c.unit ? `${c.unit}` : "offering";
  if (c.field === "unavailable") return c.to ? `${what}: take off the market` : `${what}: put back on the market`;
  if (c.field === "available_from") return `${what}: available from ${c.from ? shortDate(c.from) : "now"} to ${shortDate(c.to)}`;
  if (c.field === "rent") return `${what}: rent ${c.from == null ? "none" : money(c.from)} to ${money(c.to)}`;
  return `${what}: ${c.field}`;
}
