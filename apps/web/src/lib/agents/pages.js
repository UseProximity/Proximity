/*
 * Pages into knowledge (PRD v3, milestone 6).
 *
 * The importer reads a landlord's site for the displayed fields (units,
 * leases, photos) and writes them through apply.js. Everything else the
 * pages say, fees, policies, specials, parking, package rooms, goes through
 * Proxy's synthesis here: each page becomes a 'page' source and the model
 * decides what to store (lib/agents/synthesize.js).
 *
 * A page is only re-read into knowledge when its text changed (a hash on
 * the source row), so a daily sync of an unchanged site costs nothing here.
 */
import { createHash } from "crypto";
import supabase from "@/lib/supabase";
import { fetchPageSmart, htmlToText } from "@/lib/listingDraft/fetchSite";
import { findOrCreateSource, ensureAgent } from "./store";
import { synthesizeKnowledge } from "./synthesize";

const MAX_PAGES = 4;
const MAX_CHARS = 24000;

export async function synthesizePages({ listingId, urls, cause = "sync", actorId = null, force = false, checkIntervalDays = 1 }) {
  await ensureAgent(listingId);
  const results = [];
  const seen = new Set();
  for (const url of (urls ?? []).filter(Boolean)) {
    if (seen.has(url) || seen.size >= MAX_PAGES) continue;
    seen.add(url);
    const started = Date.now();
    let source = null;
    try {
      source = await findOrCreateSource({ listingId, kind: "page", url, label: url, checkIntervalDays });
      const page = await fetchPageSmart(url);
      const text = htmlToText(page?.html ?? "").trim().slice(0, MAX_CHARS);
      if (text.length < 80) {
        await supabase.from("listing_sources").update({ last_checked_at: new Date().toISOString(), last_status: "parse_failed", last_error: "no readable text", consecutive_failures: (source.consecutive_failures ?? 0) + 1 }).eq("id", source.id);
        results.push({ url, skipped: "no readable text" });
        continue;
      }
      const hash = createHash("sha256").update(text).digest("hex").slice(0, 32);
      if (!force && source.last_fingerprint === hash) {
        await supabase.from("listing_sources").update({ last_checked_at: new Date().toISOString(), last_status: "unchanged", last_error: null, consecutive_failures: 0, next_check_at: new Date(Date.now() + checkIntervalDays * 86400000).toISOString() }).eq("id", source.id);
        results.push({ url, unchanged: true });
        continue;
      }
      const synthesis = await synthesizeKnowledge({ listingId, text, sourceKind: "page", sourceId: source.id, sourceRef: url, cause, actorId });
      await supabase.from("listing_sources").update({
        last_checked_at: new Date().toISOString(), last_status: "changed", last_error: null, consecutive_failures: 0, last_fingerprint: hash,
        next_check_at: new Date(Date.now() + checkIntervalDays * 86400000).toISOString(),
      }).eq("id", source.id);
      results.push({ url, written: synthesis.written, held: synthesis.held, retired: synthesis.retired, coreChanges: synthesis.coreChanges?.length ?? 0, seconds: Math.round((Date.now() - started) / 1000) });
    } catch (err) {
      const message = String(err?.message ?? err).slice(0, 300);
      if (source) {
        await supabase.from("listing_sources").update({ last_checked_at: new Date().toISOString(), last_status: "fetch_failed", last_error: message, consecutive_failures: (source.consecutive_failures ?? 0) + 1 }).eq("id", source.id);
      }
      results.push({ url, error: message });
    }
  }
  return results;
}

/*
 * After repeated failures a page's facts are stale: Proxy stops quoting them
 * and the landlord is asked to confirm (PRD: "Failure handling").
 */
export const STALE_AFTER_FAILURES = 3;

export async function markStaleSources(listingId) {
  const { data } = await supabase.from("listing_sources").select("id, consecutive_failures, last_status").eq("listing_id", listingId).eq("kind", "page");
  let stale = 0;
  for (const s of data ?? []) {
    if ((s.consecutive_failures ?? 0) >= STALE_AFTER_FAILURES && s.last_status !== "stale") {
      await supabase.from("listing_sources").update({ last_status: "stale" }).eq("id", s.id);
      stale++;
    }
  }
  return stale;
}
