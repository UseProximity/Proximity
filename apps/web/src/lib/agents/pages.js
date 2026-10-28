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
 *
 * Two depths (Wyatt, 2026-10-27, round 6):
 *   readWholeSite   the first import and every landlord-triggered sync:
 *                   crawl the whole site (up to 50 pages), read the changed
 *                   pages in batches, each fact credited to its own page
 *   synthesizePages the daily sync: only the pages already known
 */
import { createHash } from "crypto";
import supabase from "@/lib/supabase";
import { fetchPageSmart, htmlToText } from "@/lib/listingDraft/fetchSite";
import { findOrCreateSource, ensureAgent } from "./store";
import { synthesizeKnowledge } from "./synthesize";
import { crawlSite, MAX_CRAWL_PAGES } from "./crawl";

const MAX_PAGES = 4;
const MAX_CHARS = 24000;

export async function synthesizePages({ listingId, urls, cause = "sync", actorId = null, force = false, checkIntervalDays = 1, maxPages = MAX_PAGES }) {
  await ensureAgent(listingId);
  const results = [];
  const seen = new Set();
  for (const url of (urls ?? []).filter(Boolean)) {
    if (seen.has(url) || seen.size >= maxPages) continue;
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

const BATCH_CHARS = 36000;
const PAGE_CHARS = 9000;

export async function readWholeSite({ listingId, startUrl, cause = "sync", actorId = null, force = false, onStep = () => {} }) {
  await ensureAgent(listingId);
  const started = Date.now();
  onStep("Finding every page on the site");
  const pages = await crawlSite(startUrl, { max: MAX_CRAWL_PAGES, onPage: (n) => onStep(`Reading the site (${n} pages)`) });
  const changed = [];
  for (const p of pages) {
    const text = htmlToText(p.html).trim().slice(0, PAGE_CHARS);
    const source = await findOrCreateSource({ listingId, kind: "page", url: p.url, label: p.url, checkIntervalDays: 1 });
    if (text.length < 80) continue;
    const hash = createHash("sha256").update(text).digest("hex").slice(0, 32);
    if (!force && source.last_fingerprint === hash) {
      await supabase.from("listing_sources").update({ last_checked_at: new Date().toISOString(), last_status: "unchanged", last_error: null, consecutive_failures: 0 }).eq("id", source.id);
      continue;
    }
    changed.push({ url: p.url, text, hash, source });
  }
  // Pages into batches the model can read at once.
  const batches = [];
  let cur = [];
  let size = 0;
  for (const p of changed) {
    if (cur.length && size + p.text.length > BATCH_CHARS) { batches.push(cur); cur = []; size = 0; }
    cur.push(p); size += p.text.length;
  }
  if (cur.length) batches.push(cur);
  const totals = { pages: pages.length, read: changed.length, written: 0, held: 0, unchanged: 0 };
  let done = 0;
  const runBatch = async (batch) => {
    const text = batch.map((p, i) => `=== PAGE ${i + 1}: ${p.url} ===\n${p.text}`).join("\n\n");
    const pageSources = batch.map((p, i) => ({ n: i + 1, url: p.url, sourceId: p.source.id }));
    const r = await synthesizeKnowledge({ listingId, text, sourceKind: "page", sourceId: batch[0].source.id, sourceRef: batch[0].url, cause, actorId, pageSources });
    totals.written += r.written ?? 0; totals.held += r.held ?? 0; totals.unchanged += r.unchanged ?? 0;
    const now = new Date().toISOString();
    for (const p of batch) {
      await supabase.from("listing_sources").update({ last_checked_at: now, last_status: "changed", last_error: null, consecutive_failures: 0, last_fingerprint: p.hash, next_check_at: new Date(Date.now() + 86400000).toISOString() }).eq("id", p.source.id);
    }
    done++;
    onStep(`Saving what the site says (${done} of ${batches.length})`);
  };
  // Three batches at a time keeps a 50-page site to a couple of minutes.
  for (let i = 0; i < batches.length; i += 3) await Promise.all(batches.slice(i, i + 3).map(runBatch));
  totals.seconds = Math.round((Date.now() - started) / 1000);
  return totals;
}

/* The daily read: every page this listing already knows, re-read if changed. */
export async function knownPageUrls(listingId) {
  const { data } = await supabase.from("listing_sources").select("url").eq("listing_id", listingId).eq("kind", "page").eq("enabled", true).not("url", "is", null).limit(MAX_CRAWL_PAGES);
  return (data ?? []).map((r) => r.url);
}
