/*
 * What the website sync decided, for people to read and overrule (Wyatt,
 * 2026-11-22 and 11-24): every change of the last few days with the source
 * and score behind it, whether it applied, and why. An applied change can be
 * undone; one the sync left unapplied can be applied now. Both count as that
 * person's edit. Read by the admin Agents page and the landlord's Agent tab.
 */

import supabase from "@/lib/supabase";
import { applyEvents, undoEvents } from "./apply.js";

const money = (n) => `$${Math.round(Number(n)).toLocaleString("en-US")}`;
const FIELD = { rent: "Rent", rentIsPerPerson: "Rent basis", leaseTermMonths: "Lease lengths", availableFrom: "Move-in date", apartments: "Apartments", unavailable: "Availability", area: "Size", bedrooms: "Bedrooms", bathrooms: "Bathrooms", name: "Name" };

function say(key, v) {
  if (v == null || v === "") return "none";
  if (key === "rent") return money(v);
  if (key === "rentIsPerPerson") return v ? "per person" : "whole unit";
  if (key === "leaseTermMonths") return (v ?? []).length ? `${v.join(", ")} months` : "none";
  if (key === "area") return `${Number(v).toLocaleString("en-US")} sq ft`;
  if (key === "unavailable") return v ? "unavailable" : "available";
  if (Array.isArray(v)) return v.join(", ") || "none";
  return String(v);
}

/* One change in words: { title, rows: [{ label, before, after }] }. */
export function changeInWords(e) {
  const unit = e.detail?.label ?? e.unit_key?.replace(/^n:/, "") ?? "The listing";
  const o = e.old_value && typeof e.old_value === "object" ? e.old_value : {};
  const n = e.new_value && typeof e.new_value === "object" ? e.new_value : {};
  const pairs = (keys) => keys.filter((k) => FIELD[k]).map((k) => ({ label: FIELD[k], before: k in o ? say(k, o[k]) : null, after: say(k, n[k]) }));
  switch (e.kind) {
    case "rent_change":
    case "lease_updated":
    case "spec_mismatch":
    case "unit_updated":
      return { title: `${unit}: ${e.kind === "rent_change" ? "rent change" : e.kind === "spec_mismatch" ? "unit details differ from the website" : "update"}`, rows: pairs(Object.keys(n)) };
    case "lease_new":
      return { title: `${unit}: new lease`, rows: pairs(["rent", "leaseTermMonths", "availableFrom"].filter((k) => n[k] != null && !(Array.isArray(n[k]) && !n[k].length))) };
    case "lease_withdrawn":
      return { title: `${unit}: lease no longer on the website`, rows: [{ label: "Availability", before: "available", after: "unavailable" }] };
    case "unit_relisted":
      return { title: `${unit}: back on the website`, rows: [{ label: "Availability", before: "unavailable", after: "available" }] };
    case "unit_new":
      return { title: `New unit: ${n.name ?? unit}`, rows: pairs(["bedrooms", "bathrooms", "area"].filter((k) => n[k] != null)) };
    case "photos_added":
      return { title: `${unit}: ${typeof e.new_value === "number" ? e.new_value : ""} photos added`.replace("  ", " "), rows: [] };
    case "property_updated":
      return { title: "Property description or specials", rows: [] };
    default:
      return { title: `${unit}: ${e.kind.replace(/_/g, " ")}`, rows: [] };
  }
}

const SOURCE = { feed: "the platform's data feed", portal: "the leasing portal", unit_page: "the unit's own page", structured: "data embedded in the page", recipe: "the page, read by code (recipe)", pattern: "the page, read by code (patterns)", model: "the page, read by Haiku" };
const key = (kind, unitKey, leaseId, field, value) => `${kind}|${unitKey ?? ""}|${leaseId ?? ""}|${field ?? ""}|${JSON.stringify(value ?? null)}`;

/*
 * The last `days` of sync decisions.
 *   listingId  one listing, or null for all
 * Returns [{ id, listingId, listing, at, status: "applied" | "not_applied" | "undone",
 *   change: { title, rows }, source, score, need, borderline, reason, rules, canUndo, canApply }].
 */
export async function recentDecisions({ listingId = null, days = 2, limit = 1500 } = {}) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  let events = supabase.from("listing_source_events")
    .select("id, listing_id, kind, unit_key, field, old_value, new_value, status, applied, verdict_by, verdict_at, detail, created_at, listings(title, address)")
    .gte("created_at", since).in("status", ["applied", "rejected"]).order("created_at", { ascending: false }).limit(limit);
  let scores = supabase.from("listing_sync_scores")
    .select("listing_id, kind, unit_key, lease_id, field, new_value, source, platform, trust, read_quality, right_thing, freshness, score, need, bar, current_score, reads_in_row, borderline, ledger_apply, ledger_reason, policy_apply, policy_reason, run_at")
    .gte("run_at", since).order("run_at", { ascending: false }).limit(limit * 2);
  if (listingId) {
    events = events.eq("listing_id", listingId);
    scores = scores.eq("listing_id", listingId);
  }
  const [{ data: ev, error }, { data: sc }] = await Promise.all([events, scores]);
  if (error) throw new Error(error.message);
  // The newest score for each change.
  const scoreBy = new Map();
  for (const s of sc ?? []) {
    const k = `${s.listing_id}|${key(s.kind, s.unit_key, s.lease_id, s.field, s.new_value)}`;
    if (!scoreBy.has(k)) scoreBy.set(k, s);
  }
  const out = [];
  for (const e of ev ?? []) {
    if (e.detail?.op === "none") continue;
    // A change a person rejected is theirs, not the sync's decision.
    if (e.status === "rejected" && (e.verdict_by || !e.detail?.autoDenied)) continue;
    const s = scoreBy.get(`${e.listing_id}|${key(e.kind, e.unit_key, e.detail?.leaseId, e.field, e.new_value)}`) ?? null;
    const led = e.detail?.ledger ?? null;
    const undone = e.detail?.undone ?? null;
    const status = undone ? "undone" : e.applied ? "applied" : "not_applied";
    out.push({
      id: e.id,
      listingId: e.listing_id,
      listing: e.listings?.title ?? e.listings?.address ?? "A listing",
      at: e.created_at,
      status,
      change: changeInWords(e),
      source: SOURCE[led?.source ?? s?.source] ?? null,
      platform: led?.platform ?? s?.platform ?? null,
      score: led?.score ?? s?.score ?? null,
      need: led?.need ?? s?.need ?? null,
      parts: s || led ? { trust: led?.trust ?? s?.trust, readQuality: led?.readQuality ?? s?.read_quality, rightThing: led?.rightThing ?? s?.right_thing, freshness: led?.freshness ?? s?.freshness, readsInRow: led?.readsInRow ?? s?.reads_in_row } : null,
      borderline: !!(led?.borderline ?? s?.borderline),
      // Why, in the sync's own words: its reason when it did not apply.
      reason: undone ? `Undone on ${String(undone.at).slice(0, 10)}` : e.applied ? e.detail?.note ?? null : e.detail?.autoDenied ?? null,
      // What the other version would have done with the same change.
      rules: e.detail?.rules ?? (s ? { apply: s.policy_apply, reason: s.policy_reason } : null),
      scoring: s ? { apply: s.ledger_apply, reason: s.ledger_reason } : null,
      decidedBy: led ? "scores" : "rules",
      byPerson: !!e.verdict_by,
      canUndo: e.applied && !undone && !!e.detail?.undo,
      canApply: !e.applied && !undone,
    });
  }
  return out;
}

/* Undo an applied change. Returns { ok, note } or { error }. */
export async function undoChange({ listingId, eventId, userId }) {
  const [r] = await undoEvents({ listingId, eventIds: [eventId], userId });
  if (!r) return { error: "That change is no longer there." };
  return r.ok ? { ok: true, note: r.note } : { error: r.error };
}

/* Apply now a change the sync left unapplied. Returns { ok, note } or { error }. */
export async function applyNow({ listingId, eventId, userId, isAdmin = false }) {
  const [r] = await applyEvents({ listingId, eventIds: [eventId], userId: isAdmin ? null : userId, verdictBy: userId, allowUnapplied: true });
  if (!r) return { error: "That change is no longer there, or was already decided." };
  return r.ok ? { ok: true, note: r.note } : { error: r.error };
}
