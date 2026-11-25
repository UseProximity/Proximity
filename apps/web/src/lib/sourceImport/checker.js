/*
 * The rare Claude checker (Wyatt, 2026-11-22). Code and Jev decide every
 * change. A change that has missed what it needs by a little, read after
 * read, is the one case Claude is asked about, for two jobs:
 *   1. make the sync correct: its verdict settles the change today;
 *   2. open a fix item (sync_fix_items) saying what code should have caught,
 *      so the case is fixed in code and Claude is not asked about it again.
 * Each change is asked about once. Off unless SYNC_CHECKER=true, and capped
 * at CHECKS_PER_DAY across all listings.
 */

import supabase from "@/lib/supabase";
import { checkStuckChange, SONNET } from "./model.js";
import { changeInWords } from "./decisions.js";

export const CHECKS_PER_DAY = 25;
// Asked about only after this many reads in a row, and only within this of what it needed.
export const STUCK_READS = 3;
export const NEAR_MISS = 0.15;

export const checkerOn = () => String(process.env.SYNC_CHECKER ?? "").toLowerCase() === "true";

/* Pure: the scored rows worth a check. */
export function stuckRows(rows) {
  return (rows ?? []).filter((r) =>
    !r.ledger_apply && !r.ledger_hidden && r.reads_in_row >= STUCK_READS && r.score < r.need && r.need - r.score <= NEAR_MISS && r.score > 0 &&
    ["model", "pattern", "recipe", "portalSite"].includes(r.source) && r.kind !== "property_updated" && !/landlord|undone|publish|weekly/.test(r.ledger_reason ?? ""));
}

/*
 * Check the stuck changes of one run. Returns Map(change index -> { verdict,
 * reason }) for the caller to apply. Never throws.
 */
export async function checkStuck({ listingId, listingLabel, rows, changes }) {
  const out = new Map();
  if (!checkerOn()) return out;
  try {
    const stuck = stuckRows(rows);
    if (!stuck.length) return out;
    const dayStart = new Date(new Date().toISOString().slice(0, 10)).toISOString();
    const [{ count: today }, { data: asked }] = await Promise.all([
      supabase.from("sync_fix_items").select("id", { count: "exact", head: true }).gte("created_at", dayStart),
      supabase.from("sync_fix_items").select("change_key, verdict, reason").eq("listing_id", listingId).in("change_key", stuck.map((r) => r.change_key)),
    ]);
    const before = new Map((asked ?? []).map((a) => [a.change_key, a]));
    let left = CHECKS_PER_DAY - (today ?? 0);
    for (const r of stuck) {
      // Asked before: the same answer stands, and nothing is spent.
      const prior = before.get(r.change_key);
      if (prior) {
        out.set(r._i, { verdict: prior.verdict, reason: `Claude checker (earlier): ${prior.reason}` });
        continue;
      }
      if (left <= 0) break;
      const c = changes[r._i];
      const words = changeInWords({ kind: r.kind, unit_key: r.unit_key, old_value: c?.old ?? null, new_value: r.new_value, detail: c?.detail ?? {} });
      const text = `${words.title}. ${words.rows.map((x) => `${x.label}: ${x.before ?? "none"} to ${x.after}`).join("; ")}`;
      const answer = await checkStuckChange({ listingLabel, change: text, evidence: r.jev?.text ?? "", why: r.ledger_reason ?? "its score is under what it needs" });
      if (!answer) continue;
      left -= 1;
      await supabase.from("sync_fix_items").insert({
        listing_id: listingId, change_key: r.change_key, kind: r.kind, change: words, evidence: (r.jev?.text ?? "").slice(0, 4000), score: r.score, need: r.need,
        verdict: answer.verdict, reason: answer.reason, suggested_fix: answer.fix, model: SONNET, cost_usd: answer.cost ?? null,
      });
      out.set(r._i, { verdict: answer.verdict, reason: `Claude checker: ${answer.reason}` });
    }
  } catch (err) {
    console.error(`[source-sync] checker for ${listingId}: ${err?.message ?? err}`);
  }
  return out;
}
