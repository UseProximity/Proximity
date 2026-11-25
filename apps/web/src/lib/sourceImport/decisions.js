/*
 * What the website sync decided, for people to read and overrule (Wyatt,
 * 2026-11-22 and 11-24): every change of the last few days with the source
 * and score behind it, whether it applied, and why. An applied change can be
 * undone; one the sync left unapplied can be applied now. Both count as that
 * person's edit. Read by the admin Agents page and the landlord's Agent tab.
 */

import supabase from "@/lib/supabase";
import { updateAsUser } from "@/lib/supabaseWithUser";
import { applyEvents, undoEvents } from "./apply.js";
import { markLandlordSet } from "@/lib/agents/coreWrites";
import { HIDDEN_RENT_MAX_AGE_DAYS } from "@/lib/listings/hiddenRents";

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
    .select("listing_id, change_key, kind, unit_key, lease_id, field, new_value, source, platform, trust, read_quality, right_thing, freshness, score, need, bar, current_score, reads_in_row, borderline, ledger_apply, ledger_reason, policy_apply, policy_reason, run_at")
    .gte("run_at", since).neq("kind", "run").order("run_at", { ascending: false }).limit(limit * 2);
  if (listingId) {
    events = events.eq("listing_id", listingId);
    scores = scores.eq("listing_id", listingId);
  }
  const [{ data: ev, error }, { data: sc }] = await Promise.all([events, scores]);
  if (error) throw new Error(error.message);
  // The newest score for each change, by the key it was saved under (an
  // event made since PR 483 carries it; older ones are matched as before).
  const scoreBy = new Map();
  for (const s of sc ?? []) {
    for (const k of [`${s.listing_id}|ck|${s.change_key}`, `${s.listing_id}|${key(s.kind, s.unit_key, s.lease_id, s.field, s.new_value)}`]) {
      if (!scoreBy.has(k)) scoreBy.set(k, s);
    }
  }
  const out = [];
  for (const e of ev ?? []) {
    if (e.detail?.op === "none") continue;
    // A change a person rejected is theirs, not the sync's decision.
    if (e.status === "rejected" && (e.verdict_by || !e.detail?.autoDenied)) continue;
    const s = (e.detail?.changeKey ? scoreBy.get(`${e.listing_id}|ck|${e.detail.changeKey}`) : null) ?? scoreBy.get(`${e.listing_id}|${key(e.kind, e.unit_key, e.detail?.leaseId, e.field, e.new_value)}`) ?? null;
    const led = e.detail?.ledger ?? null;
    const undone = e.detail?.undone ?? null;
    const status = undone ? "undone" : e.applied ? "applied" : "not_applied";
    out.push({
      id: e.id,
      listingId: e.listing_id,
      leaseId: e.detail?.leaseId ?? null,
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

/*
 * The sync's reason, as a landlord reads it: the scores' figures are for the
 * team (PR 483 review). Plain reasons pass through unchanged.
 */
export function landlordReason(reason) {
  if (!reason) return null;
  const r = String(reason);
  if (/^score [\d.]+ is under the bar/.test(r) || /does not beat the current value/.test(r)) return "The website change was not certain enough to apply on its own. You can apply it now if it is right.";
  if (/takes \d+ in a row/.test(r)) return "Seen gone from the website once. It is taken down if the next read agrees.";
  if (/^Jev /.test(r)) return "The page could not be double-checked this time. The next read tries again.";
  return r;
}

/* The lease a saved website change is about, or null for a unit or property change. */
export async function eventLeaseId(listingId, eventId) {
  const { data } = await supabase.from("listing_source_events").select("detail").eq("id", eventId).eq("listing_id", listingId).maybeSingle();
  return data ? data.detail?.leaseId ?? null : undefined;
}

/* Of these leases, the ones this person owns (a co-landlord's or a subleaser's own offering). */
export async function leasesOwnedBy(userId, leaseIds) {
  const ids = [...new Set((leaseIds ?? []).filter(Boolean))];
  if (!userId || !ids.length) return new Set();
  const { data } = await supabase.from("unit_leases").select("id").in("id", ids).eq("owner_id", userId).is("deleted_at", null);
  return new Set((data ?? []).map((l) => l.id));
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

/*
 * How the sync is doing over the last `days` (Wyatt, 2026-11-24: track Jev,
 * each platform, and how often people overrule the sync, in a form a person
 * or an AI can read at a glance). Plain numbers, no judgement.
 * Returns { days, changes, byPlatform: [...], jev, overruled, recipes }.
 */
export async function syncHealth({ days = 7 } = {}) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const [{ data: sc }, { data: ev }, { data: rc }] = await Promise.all([
    supabase.from("listing_sync_scores").select("listing_id, change_key, platform, source, ledger_apply, policy_apply, borderline, read_quality, jev, run_at").gte("run_at", since).neq("kind", "run").order("run_at", { ascending: false }).limit(20000),
    supabase.from("listing_source_events").select("applied, status, verdict_by, verdict_at, detail, created_at").or(`created_at.gte.${since},verdict_at.gte.${since}`).limit(20000),
    supabase.from("source_recipes").select("scope, status, uses, failures, made_from, created_at").limit(5000),
  ]);
  // One row per change: the newest score.
  const seen = new Set();
  const rows = [];
  for (const r of sc ?? []) {
    const k = `${r.listing_id}|${r.change_key}`;
    if (seen.has(k)) continue;
    seen.add(k);
    rows.push(r);
  }
  const plat = new Map();
  for (const r of rows) {
    const p = plat.get(r.platform) ?? { platform: r.platform, source: r.source, changes: 0, scoringApplies: 0, rulesApply: 0, disagree: 0, borderline: 0, readQuality: 0 };
    p.changes += 1;
    p.scoringApplies += r.ledger_apply ? 1 : 0;
    p.rulesApply += r.policy_apply ? 1 : 0;
    p.disagree += r.ledger_apply !== r.policy_apply ? 1 : 0;
    p.borderline += r.borderline ? 1 : 0;
    p.readQuality += Number(r.read_quality ?? 0);
    plat.set(r.platform, p);
  }
  const asked = (sc ?? []).filter((r) => r.jev && r.jev.model !== "code");
  const by = (st) => asked.filter((r) => r.jev.status === st).length;
  const undone = (ev ?? []).filter((e) => e.detail?.undone && e.detail.undone.at >= since).length;
  const appliedByPerson = (ev ?? []).filter((e) => e.applied && e.verdict_by && e.detail?.autoDenied && e.verdict_at >= since).length;
  const applied = (ev ?? []).filter((e) => e.applied && e.created_at >= since).length;
  const active = (rc ?? []).filter((r) => r.status === "active");
  return {
    days,
    changes: { total: rows.length, scoringApplies: rows.filter((r) => r.ledger_apply).length, rulesApply: rows.filter((r) => r.policy_apply).length, disagree: rows.filter((r) => r.ledger_apply !== r.policy_apply).length, borderline: rows.filter((r) => r.borderline).length },
    byPlatform: [...plat.values()].map((p) => ({ ...p, readQuality: p.changes ? Math.round((p.readQuality / p.changes) * 100) / 100 : null })).sort((a, b) => b.changes - a.changes),
    jev: { asked: asked.length, answered: by("ok"), failed: by("failed"), noText: by("no_text"), failRate: asked.length ? Math.round((by("failed") / asked.length) * 1000) / 1000 : 0 },
    // How often people overrule the sync: a rising share means the scoring needs another look.
    overruled: { applied, undone, appliedByPerson, undoRate: applied ? Math.round((undone / applied) * 1000) / 1000 : 0 },
    recipes: { listings: active.filter((r) => r.scope === "listing").length, platforms: active.filter((r) => r.scope === "platform").length, retired: (rc ?? []).length - active.length, rebuiltThisWindow: (rc ?? []).filter((r) => r.made_from === "rebuild" && r.created_at >= since).length },
  };
}

/*
 * Prices the landlord's website shows for leases they chose to list with no
 * price (the hidden price store). The blank is theirs and never fades; this
 * is only so they can be asked "Show it?" (Wyatt, 2026-11-24). Server only:
 * the figure goes to the listing's own landlord and admins, nobody else.
 * Returns [{ leaseId, unit, rent, perPerson, seenAt }].
 */
export async function hiddenPricesFor(listingId) {
  const since = new Date(Date.now() - HIDDEN_RENT_MAX_AGE_DAYS * 86400000).toISOString();
  const { data, error } = await supabase.from("lease_hidden_rents").select("lease_id, rent, rent_is_per_person, seen_at, unit_leases!inner(id, rent, deleted_at, unavailable, listing_units!inner(name))")
    .eq("listing_id", listingId).gte("seen_at", since).limit(200);
  if (error) {
    console.error(`[source-sync] hidden prices for ${listingId}: ${error.message}`);
    return [];
  }
  return (data ?? []).filter((r) => r.unit_leases && r.unit_leases.rent == null && !r.unit_leases.deleted_at)
    .map((r) => ({ leaseId: r.lease_id, unit: r.unit_leases.listing_units?.name ?? "A unit", rent: Number(r.rent), perPerson: r.rent_is_per_person, seenAt: r.seen_at }));
}

/* The landlord chooses to show a hidden price: it becomes the lease's public rent, as their own edit. */
export async function showHiddenPrice({ listingId, leaseId, userId }) {
  // Only a price the website still shows: the same 30 days hiddenPricesFor lists.
  const since = new Date(Date.now() - HIDDEN_RENT_MAX_AGE_DAYS * 86400000).toISOString();
  const { data: row } = await supabase.from("lease_hidden_rents").select("rent, rent_is_per_person").eq("listing_id", listingId).eq("lease_id", leaseId).gte("seen_at", since).maybeSingle();
  if (!row) return { error: "Your website is no longer showing a price for this lease." };
  const { data: lease } = await supabase.from("unit_leases").select("id, rent, listing_units!inner(listing_id)").eq("id", leaseId).eq("listing_units.listing_id", listingId).maybeSingle();
  if (!lease) return { error: "This lease is no longer on the listing." };
  if (lease.rent != null) return { error: "This lease already has a price." };
  const fields = { rent: Number(row.rent), ...(row.rent_is_per_person == null ? {} : { rent_is_per_person: row.rent_is_per_person }) };
  // The landlord's own edit, recorded in action_log as theirs.
  const { data: savedRow, error } = await updateAsUser(supabase, { userId, table: "unit_leases", data: fields, rowId: leaseId });
  if (error) {
    console.error(`[source-sync] show hidden price ${leaseId}: ${error.message}`);
    return { error: "Could not show that price." };
  }
  const saved = savedRow ? [savedRow] : [];
  if (!saved.length) return { error: "Could not show that price." };
  await supabase.from("lease_hidden_rents").delete().eq("lease_id", leaseId);
  await markLandlordSet({ listingId, target: "lease", id: leaseId, fields, userId, cause: "dashboard", detail: { fromHiddenPrice: true }, old: { rent: null }, at: saved[0].updated_at });
  return { ok: true, note: `now showing $${Math.round(fields.rent).toLocaleString("en-US")}` };
}
