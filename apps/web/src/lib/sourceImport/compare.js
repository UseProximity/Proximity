/*
 * Old version next to new version, for one listing, writing nothing (the
 * replay tool of the sync confidence ledger; Wyatt, 2026-11-24: assess the
 * whole thing once it is built, change by change, with what each version did
 * and why).
 *
 *   old   the site read the way production reads it today (platform readers,
 *         then the model), each change decided by the rules in syncPolicy.js
 *         and the churn guard
 *   new   the site read by code alone (platform readers, then the listing's
 *         recipe), each change decided by its score
 *
 * Both are planned against the listing exactly as it is now. Returns
 * { listing, old: { reader, cost, held, changes }, new: {...}, pairs } where
 * pairs lines the two versions up change by change.
 */

import supabase from "@/lib/supabase";
import { givenSiteFilterFor } from "@/lib/sourceSync/givenSites";
import { readProperty } from "./read.js";
import { applySnapshot } from "./apply.js";
import { loadRecipes } from "./recipeStore.js";
import { changeInWords } from "./decisions.js";

const READ_MS = 120000;
const keyOf = (r) => `${r.kind}|${r.unit_key ?? ""}|${r.lease_id ?? ""}|${r.field ?? ""}|${JSON.stringify(r.new_value ?? null)}`;

async function oneVersion({ listing, monitor, allowUrl, version }) {
  const started = Date.now();
  const snapshot = await readProperty({
    allowUrl,
    pastedUrl: monitor.index_url ?? monitor.source_url,
    target: { name: listing.title ?? listing.address, address: listing.address, url: monitor.source_url, levelUrl: monitor.index_url },
    knownPortal: monitor.portal ?? null,
    deep: false,
    deadline: started + READ_MS,
    stopWhenPending: true,
    ...(version === "new" ? { daily: true, recipeFor: (platformKey) => loadRecipes(listing.id, platformKey) } : {}),
  });
  const base = { reader: snapshot.trace?.reader ?? snapshot.platform, model: snapshot.trace?.model ?? null, costUsd: snapshot.trace?.modelCostUsd ?? 0, codeOnly: !!snapshot.trace?.codeOnly, units: snapshot.units.length, seconds: Math.round((Date.now() - started) / 1000), recipe: snapshot.recipe ? { used: snapshot.recipe.used, version: snapshot.recipe.version, found: snapshot.recipe.found, missing: snapshot.recipe.missing, added: snapshot.recipe.added, deepened: snapshot.recipe.deepened } : null };
  if (snapshot.portalPending) return { ...base, note: "leasing portal part read; nothing planned", changes: [] };
  if (snapshot.dailySkipped) return { ...base, note: "code cannot read this site; the daily sync leaves it for the weekly read", changes: [] };
  const run = await applySnapshot({ snapshot, listingId: listing.id, mode: "sync", monitorId: monitor.id, dryRun: true });
  const changes = (run.scored ?? []).map((r) => {
    const c = run.changes[r._i] ?? {};
    const held = version === "old" && run.holdReason;
    return {
      key: keyOf(r),
      kind: r.kind,
      words: changeInWords({ kind: r.kind, unit_key: r.unit_key, old_value: c.old ?? null, new_value: r.new_value, detail: c.detail ?? {} }),
      source: r.source,
      platform: r.platform,
      // What this version would do, and why.
      apply: version === "old" ? (held ? false : !!r.policy_apply) : !!r.ledger_apply,
      reason: version === "old" ? (held ? `the whole run was held: ${run.holdReason}` : r.policy_reason) : r.ledger_reason,
      waitsForSecondRead: version === "new" && !r.ledger_apply && /takes 2 in a row/.test(r.ledger_reason ?? "") && r.score >= r.need,
      hidden: !!r.ledger_hidden,
      score: version === "new" ? { score: r.score, need: r.need, bar: r.bar, current: r.current_score, trust: r.trust, readQuality: r.read_quality, rightThing: r.right_thing, freshness: r.freshness, borderline: r.borderline } : null,
      landlordEdited: r.landlord_edited,
      jev: version === "new" && r.jev ? { status: r.jev.status, model: r.jev.model, parts: (r.jev.parts ?? []).map((p) => ({ part: p.part, p: p.p, choice: p.choice ?? null, question: p.question ?? null })) } : null,
      evidence: r.jev?.text ?? null,
      evidenceUrl: r.jev?.url ?? null,
    };
  });
  return { ...base, held: run.holdReason ?? null, changes };
}

export async function compareListing(listingId) {
  const { data: monitor, error } = await supabase.from("listing_source_monitors").select("id, source_url, index_url, portal, listings(id, title, address)").eq("listing_id", listingId).maybeSingle();
  if (error || !monitor?.listings) throw new Error("This listing has no website to read.");
  const listing = monitor.listings;
  const allowUrl = await givenSiteFilterFor(listing.id);
  const run = async (version) => {
    try {
      return await oneVersion({ listing, monitor, allowUrl, version });
    } catch (err) {
      console.error(`[compare] ${version} version for ${listing.id}:`, err);
      return { error: "This version could not read the website", changes: [] };
    }
  };
  // One after the other: both read the same site, and the second reuses nothing.
  const oldV = await run("old");
  const newV = await run("new");
  const byKey = new Map();
  for (const c of oldV.changes) byKey.set(c.key, { key: c.key, old: c, new: null });
  for (const c of newV.changes) {
    const row = byKey.get(c.key) ?? { key: c.key, old: null, new: null };
    row.new = c;
    byKey.set(c.key, row);
  }
  return { listingId: listing.id, listing: listing.title ?? listing.address, url: monitor.index_url ?? monitor.source_url, old: { ...oldV, changes: undefined, count: oldV.changes.length }, new: { ...newV, changes: undefined, count: newV.changes.length }, pairs: [...byKey.values()] };
}
