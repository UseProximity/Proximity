/*
 * Saving shadow scores (shadow.js) for one sync run. Best effort: a failure
 * is logged and never touches the sync. Off with SYNC_SHADOW_SCORES=false.
 */

import { randomUUID } from "node:crypto";
import supabase from "@/lib/supabase";
import { shadowRows } from "./shadow.js";
import { jevPass } from "./jevPass.js";

export const shadowScoresOn = () => String(process.env.SYNC_SHADOW_SCORES ?? "").toLowerCase() !== "false";

/*
 * The switch (stage 3): when on, the ledger's verdict decides each change of
 * a daily sync in place of the rules in syncPolicy.js and the churn guard.
 * Off unless SYNC_LEDGER_DECIDES=true.
 */
export const ledgerDecides = () => shadowScoresOn() && String(process.env.SYNC_LEDGER_DECIDES ?? "").toLowerCase() === "true";

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
  /*
   * An Undo is that person's edit: they put their own value back. Applying a
   * website change by hand is not (the listing then says what the website
   * says); counting the team's launch-review approvals as landlord edits
   * once made a plain price move on 4321 Grove need to beat a "fresh edit".
   */
  const { data: acted } = await supabase.from("listing_source_events").select("detail").eq("listing_id", listingId).not("detail->undone", "is", null).limit(1000);
  for (const e of acted ?? []) {
    const scope = e.detail?.leaseId ?? e.detail?.unitId ?? null;
    if (scope && e.detail?.undone?.at) later(scope, e.detail.undone.at);
  }
  return out;
}

/*
 * Every row a query matches, up to `max`, in pages: PostgREST returns at most
 * 1000 rows a request whatever .limit() asks for (PR 483 review). The query
 * must be ordered so the pages do not overlap.
 */
const PAGE = 1000;
export async function allRows(query, max = 20000) {
  const rows = [];
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await query.range(from, Math.min(from + PAGE, max) - 1);
    if (error) return { data: rows, error };
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return { data: rows, error: null };
}

// A run that planned no changes is saved as one marker row, so it breaks a
// "seen N reads in a row" streak like any other run (PR 483 review).
export const RUN_MARKER = "run";

/* For each change key, how many of the listing's latest runs in a row planned it. */
async function priorRunsFor(listingId) {
  const { data, error } = await allRows(supabase.from("listing_sync_scores").select("run_id, run_at, change_key, lease_id, unit_id, field, new_value")
    .eq("listing_id", listingId).gte("run_at", new Date(Date.now() - 21 * 86400000).toISOString())
    .order("run_at", { ascending: false }).order("id"), 5000);
  if (error) throw new Error(`prior runs: ${error.message}`);
  const runs = [];
  const keysBy = new Map();
  for (const r of data ?? []) {
    if (!keysBy.has(r.run_id)) {
      keysBy.set(r.run_id, new Set());
      runs.push(r.run_id);
    }
    if (r.change_key !== RUN_MARKER) keysBy.get(r.run_id).add(r.change_key);
  }
  const out = new Map();
  const all = new Set((data ?? []).map((r) => r.change_key).filter((k) => k !== RUN_MARKER));
  for (const key of all) {
    let n = 0;
    for (const run of runs) {
      if (!keysBy.get(run).has(key)) break;
      n += 1;
    }
    if (n) out.set(key, n);
  }
  // What the website has said before about each lease or unit (shadow.js saidOtherwiseBefore).
  const priorValues = new Map();
  for (const r of data ?? []) {
    if (r.change_key === RUN_MARKER) continue;
    const k = r.lease_id ?? r.unit_id ?? "";
    if (!priorValues.has(k)) priorValues.set(k, []);
    priorValues.get(k).push({ field: r.field ?? null, value: r.new_value ?? null });
  }
  return { priorRuns: out, priorRunsSeen: runs.length > 0, priorValues };
}

async function saveRunMarker(listingId, monitorId) {
  const { error } = await supabase.from("listing_sync_scores").insert({
    run_id: randomUUID(), run_at: new Date().toISOString(), listing_id: listingId, monitor_id: monitorId ?? null,
    change_key: RUN_MARKER, kind: RUN_MARKER, action: "none", source: RUN_MARKER, platform: RUN_MARKER,
    trust: 0, read_quality: 0, right_thing: 0, freshness: 0, score: 0, current_score: 0, need: 0, bar: 0,
    ledger_apply: false, policy_apply: false,
  });
  if (error) console.error(`[source-sync] run marker for ${listingId}: ${error.message}`);
}

/*
 * Whether the listing's latest scored run left a withdrawal waiting for its
 * second read. The sync then scores an unchanged page again rather than
 * stopping at "unchanged", or the second read would never come (PR 483 review).
 */
export async function awaitingSecondRead(listingId) {
  if (!ledgerDecides()) return false;
  const { data, error } = await supabase.from("listing_sync_scores").select("run_id, action, ledger_apply, reads_in_row, score, need")
    .eq("listing_id", listingId).order("run_at", { ascending: false }).limit(300);
  if (error || !data?.length) return false;
  const latest = data[0].run_id;
  return data.some((r) => r.run_id === latest && r.action === "withdraw" && !r.ledger_apply && Number(r.reads_in_row) < 2 && Number(r.score) >= Number(r.need));
}

export async function saveShadowScores({ listingId, monitorId, changes, snapshot, state, learnings, syncBlanks, holdReason, save = true, jevDeadline = null }) {
  if (!shadowScoresOn()) return [];
  if (!changes?.some((c) => c.kind !== "missing_unit")) {
    if (save) await saveRunMarker(listingId, monitorId).catch(() => {});
    return [];
  }
  try {
    const [landlordEdits, { priorRuns, priorRunsSeen, priorValues }] = await Promise.all([landlordEditTimes(listingId), priorRunsFor(listingId)]);
    const scored = shadowRows({ changes, snapshot, state, learnings, landlordEdits, syncBlanks, priorRuns, priorRunsSeen, priorValues, holdReason });
    if (!scored.length) return [];
    const full = await jevPass({ rows: scored, snapshot, state, runDeadline: jevDeadline });
    const rows = full.map(({ _in, _i, ...r }) => ({ ...r, jev: r.jev ?? null }));
    const runId = randomUUID();
    const runAt = new Date().toISOString();
    // A dry run scores and returns, saving nothing.
    if (!save) return full.map(({ _in, ...r }) => r);
    const { error } = await supabase.from("listing_sync_scores").insert(rows.map((r) => ({ ...r, run_id: runId, run_at: runAt, listing_id: listingId, monitor_id: monitorId ?? null })));
    if (error) throw new Error(error.message);
    // Each row with the index of the change it scored, for the ledger to decide by.
    return full.map(({ _in, ...r }) => r);
  } catch (err) {
    console.error(`[source-sync] shadow scores for ${listingId}: ${err?.message ?? err}`);
    return [];
  }
}

