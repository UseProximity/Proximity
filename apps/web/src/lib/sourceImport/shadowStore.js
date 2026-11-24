/*
 * Saving shadow scores (shadow.js) for one sync run. Best effort: a failure
 * is logged and never touches the sync. Off with SYNC_SHADOW_SCORES=false.
 */

import { randomUUID } from "node:crypto";
import supabase from "@/lib/supabase";
import { shadowRows } from "./shadow.js";
import { jevPass } from "./jevPass.js";

export const shadowScoresOn = () => String(process.env.SYNC_SHADOW_SCORES ?? "").toLowerCase() !== "false";

/* When the landlord last set each lease, unit and property field, by scope id. */
async function landlordEditTimes(listingId) {
  const { data, error } = await supabase.from("listing_facts").select("field_key, scope_level, scope_id, updated_at")
    .eq("listing_id", listingId).eq("section", "core").eq("landlord_set", true).eq("is_current", true).limit(2000);
  if (error) throw new Error(`landlord edits: ${error.message}`);
  const out = new Map();
  const later = (k, t) => { if (!out.has(k) || out.get(k) < t) out.set(k, t); };
  for (const f of data ?? []) {
    if ((f.scope_level === "lease" || f.scope_level === "unit") && f.scope_id) later(f.scope_id, f.updated_at);
    else if (f.scope_level === "property" && f.field_key.startsWith("core.property.")) later(`property:${f.field_key.slice("core.property.".length)}`, f.updated_at);
  }
  return out;
}

/* For each change key, how many of the listing's latest runs in a row planned it. */
async function priorRunsFor(listingId) {
  const { data, error } = await supabase.from("listing_sync_scores").select("run_id, run_at, change_key")
    .eq("listing_id", listingId).gte("run_at", new Date(Date.now() - 21 * 86400000).toISOString())
    .order("run_at", { ascending: false }).limit(5000);
  if (error) throw new Error(`prior runs: ${error.message}`);
  const runs = [];
  const keysBy = new Map();
  for (const r of data ?? []) {
    if (!keysBy.has(r.run_id)) {
      keysBy.set(r.run_id, new Set());
      runs.push(r.run_id);
    }
    keysBy.get(r.run_id).add(r.change_key);
  }
  const out = new Map();
  const all = new Set((data ?? []).map((r) => r.change_key));
  for (const key of all) {
    let n = 0;
    for (const run of runs) {
      if (!keysBy.get(run).has(key)) break;
      n += 1;
    }
    if (n) out.set(key, n);
  }
  return { priorRuns: out, priorRunsSeen: runs.length > 0 };
}

export async function saveShadowScores({ listingId, monitorId, changes, snapshot, state, learnings, syncBlanks, holdReason }) {
  if (!shadowScoresOn() || !changes?.length) return 0;
  try {
    const [landlordEdits, { priorRuns, priorRunsSeen }] = await Promise.all([landlordEditTimes(listingId), priorRunsFor(listingId)]);
    const scored = shadowRows({ changes, snapshot, state, learnings, landlordEdits, syncBlanks, priorRuns, priorRunsSeen, holdReason });
    if (!scored.length) return 0;
    const rows = (await jevPass({ rows: scored, snapshot, state })).map(({ _in, ...r }) => r);
    const runId = randomUUID();
    const runAt = new Date().toISOString();
    const { error } = await supabase.from("listing_sync_scores").insert(rows.map((r) => ({ ...r, run_id: runId, run_at: runAt, listing_id: listingId, monitor_id: monitorId ?? null })));
    if (error) throw new Error(error.message);
    return rows.length;
  } catch (err) {
    console.error(`[source-sync] shadow scores for ${listingId}: ${err?.message ?? err}`);
    return 0;
  }
}

