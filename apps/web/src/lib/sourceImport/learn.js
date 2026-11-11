/*
 * Loading and saving what the sync learns about a listing
 * (listing_sync_learnings, migration 202611110001). The rules themselves are
 * in learnRules.js.
 *
 * Fails open: a missing table or a failed read means the sync runs without
 * what it learned, exactly as it did before, never that it stops.
 */
import supabase from "@/lib/supabase";
import { syncedLeaseValues } from "./learnRules.js";

export const emptyLearnings = () => ({ synced: new Map(), aliases: new Map(), rentBasis: null, ok: false });

export async function loadLearnings(listingId) {
  const { data, error } = await supabase.from("listing_sync_learnings").select("kind, source_key, unit_id, lease_id, value").eq("listing_id", listingId).limit(5000);
  if (error) {
    console.error(`[source-sync] learnings for ${listingId}: ${error.message}`);
    return emptyLearnings();
  }
  const out = { ...emptyLearnings(), ok: true };
  for (const r of data ?? []) {
    if (r.kind === "synced") out.synced.set(r.source_key, r.value ?? {});
    else if (r.kind === "unit_alias" && r.unit_id) out.aliases.set(r.source_key, r.unit_id);
    else if (r.kind === "rent_basis") out.rentBasis = r.value?.basis ?? null;
  }
  return out;
}

export async function saveLearnings(listingId, rows) {
  if (!rows.length) return;
  // One row per key: the last word in this run wins.
  const byKey = new Map(rows.map((r) => [`${r.kind}|${r.source_key}`, r]));
  const now = new Date().toISOString();
  const { error } = await supabase.from("listing_sync_learnings").upsert(
    [...byKey.values()].map((r) => ({ listing_id: listingId, unit_id: null, lease_id: null, learned_from: null, ...r, updated_at: now })),
    { onConflict: "listing_id,kind,source_key" }
  );
  if (error) console.error(`[source-sync] saving learnings for ${listingId}: ${error.message}`);
}

/*
 * What the applied changes wrote, as 'synced' rows: the lease values from the
 * website, and each new unit under the website's name. executeChange leaves
 * them on the change (change.written).
 */
export function writtenRows(changes, { learnings, state }) {
  const leases = new Map(state.listing_units.flatMap((u) => u.unit_leases).map((l) => [l.id, l]));
  const rows = [];
  for (const c of changes) {
    const w = c.written;
    if (!w) continue;
    for (const l of w.leases ?? []) {
      // An update writes some fields: the rest are what was there.
      const before = learnings.synced.get(`lease:${l.id}`) ?? syncedLeaseValues(leases.get(l.id));
      rows.push({ kind: "synced", source_key: `lease:${l.id}`, lease_id: l.id, value: { ...before, ...syncedLeaseValues(l.values) }, learned_from: c.kind });
    }
    if (w.unit) {
      rows.push({ kind: "synced", source_key: `unit:${w.unit.id}`, unit_id: w.unit.id, value: { name: w.unit.name ?? null, siteKey: w.unit.siteKey ?? null }, learned_from: c.kind });
    }
  }
  return rows;
}
