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
 * the source row), so re-reading an unchanged site costs only the fetches.
 *
 * When (Wyatt, 2026-11-12):
 *   readWholeSite   weekly, on Monday, for every listing with a website
 *                   (lib/agents/sync.js runWeeklyKnowledge), plus the first
 *                   import and every landlord-triggered sync: crawl the whole
 *                   site (up to 50 pages), read the changed pages in batches,
 *                   each fact credited to its own page, and take out facts a
 *                   page has stopped saying for two weekly reads in a row
 *   syncSpecials    daily, inside the website sync: only the specials
 */
import { createHash } from "crypto";
import supabase from "@/lib/supabase";
import { fetchPageSmart, htmlToText } from "@/lib/listingDraft/fetchSite";
import { findOrCreateSource, ensureAgent, retireFact } from "./store";
import { synthesizeKnowledge } from "./synthesize";
import { crawlSite, MAX_CRAWL_PAGES } from "./crawl";
import { foundUrlSet } from "./foundRead";
import { MAX_FOUND_PAGES } from "./foundUrls";
import { givenUrlsFor, givenSiteFilter } from "@/lib/sourceSync/givenSites";
import { sameSpecial } from "@/lib/sourceImport/apply";

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

/*
 * A fact a page stops saying is taken out after this many weekly reads in a
 * row (Wyatt, 2026-11-12): one bad week on a website removes nothing.
 * Facts the landlord set, and anything not from a page we read, are never
 * touched this way.
 */
export const MISSED_READS_TO_RETIRE = 2;
// Known pages the crawl did not reach are fetched on their own, up to this
// many, so a page is only called gone when it really is.
const MAX_RECHECKS = 15;
const GONE_CODES = new Set(["http_404", "http_410"]);
// The weekly read leaves this much of a five-minute function for saving.
const READ_DEADLINE_MS = 150000;

/*
 * The whole-site read: the first import, every landlord-triggered sync, and
 * the Monday knowledge read (Wyatt, 2026-11-12). Crawls the site the landlord
 * gave us (up to 50 pages), re-checks pages the agent already knows that the
 * crawl did not reach, reads every changed page into knowledge, and keeps
 * track of facts a re-read page no longer says.
 *
 * Returns { pages, read, written, held, unchanged, retired, missed, gone, seconds }.
 */
export async function readWholeSite({ listingId, startUrl, cause = "sync", actorId = null, force = false, onStep = () => {} }) {
  await ensureAgent(listingId);
  const started = Date.now();
  onStep("Finding every page on the site");
  // Only the sites the landlord gave us (Wyatt, 2026-11-07).
  const given = await givenUrlsFor(listingId);
  const allowUrl = givenSiteFilter(given);
  if (!allowUrl(startUrl)) {
    console.log(`[agents] whole-site read for ${listingId} skipped: ${startUrl} is not a site the landlord gave us`);
    return { pages: 0, read: 0, written: 0, held: 0, unchanged: 0, retired: 0, missed: 0, gone: 0, seconds: 0, skipped: "not a given site" };
  }
  const pages = await crawlSite(startUrl, { max: MAX_CRAWL_PAGES, allowUrl, onPage: (n) => onStep(`Reading the site (${n} pages)`) });

  // Pages the agent knows from earlier reads that this crawl did not reach.
  const crawled = new Set(pages.map((p) => sameUrl(p.url)));
  const known = await knownPageUrls(listingId).catch(() => []);
  const gonePages = [];
  for (const url of known.filter((u) => !crawled.has(sameUrl(u))).slice(0, MAX_RECHECKS)) {
    if (Date.now() - started > READ_DEADLINE_MS) break;
    try {
      const page = await fetchPageSmart(url);
      if (page?.html) pages.push({ url, html: page.html });
    } catch (err) {
      if (GONE_CODES.has(err?.code)) gonePages.push(url);
    }
  }

  const changed = [];
  const unchangedIds = [];
  for (const p of pages) {
    const text = htmlToText(p.html).trim().slice(0, PAGE_CHARS);
    const source = await findOrCreateSource({ listingId, kind: "page", url: p.url, label: p.url, checkIntervalDays: 7 });
    if (text.length < 80) continue;
    const hash = createHash("sha256").update(text).digest("hex").slice(0, 32);
    if (!force && source.last_fingerprint === hash) {
      await supabase.from("listing_sources").update({ last_checked_at: new Date().toISOString(), last_status: "unchanged", last_error: null, consecutive_failures: 0 }).eq("id", source.id);
      unchangedIds.push(source.id);
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
  const totals = { pages: pages.length, read: changed.length, written: 0, held: 0, unchanged: 0, retired: 0, missed: 0, gone: gonePages.length };
  const touched = new Set();
  const readIds = [];
  let done = 0;
  const runBatch = async (batch) => {
    const text = batch.map((p, i) => `=== PAGE ${i + 1}: ${p.url} ===\n${p.text}`).join("\n\n");
    const pageSources = batch.map((p, i) => ({ n: i + 1, url: p.url, sourceId: p.source.id }));
    const r = await synthesizeKnowledge({ listingId, text, sourceKind: "page", sourceId: batch[0].source.id, sourceRef: batch[0].url, cause, actorId, pageSources });
    totals.written += r.written ?? 0; totals.held += r.held ?? 0; totals.unchanged += r.unchanged ?? 0; totals.retired += r.retired ?? 0;
    for (const id of r.touched ?? []) touched.add(id);
    // A batch the model could not read says nothing about what is missing,
    // and its pages are read again next week.
    if (r.failed) return;
    const now = new Date().toISOString();
    for (const p of batch) {
      readIds.push(p.source.id);
      await supabase.from("listing_sources").update({ last_checked_at: now, last_status: "changed", last_error: null, consecutive_failures: 0, last_fingerprint: p.hash, next_check_at: new Date(Date.now() + 7 * 86400000).toISOString() }).eq("id", p.source.id);
    }
    done++;
    onStep(`Saving what the site says (${done} of ${batches.length})`);
  };
  // Three batches at a time keeps a 50-page site to a couple of minutes.
  for (let i = 0; i < batches.length; i += 3) await Promise.all(batches.slice(i, i + 3).map(runBatch));

  // Gone pages: their source rows are marked so the facts' page reads as gone.
  let goneIds = [];
  if (gonePages.length) {
    const { data } = await supabase.from("listing_sources").select("id").eq("listing_id", listingId).eq("kind", "page").in("url", gonePages);
    goneIds = (data ?? []).map((r) => r.id);
    if (goneIds.length) await supabase.from("listing_sources").update({ last_checked_at: new Date().toISOString(), last_status: "fetch_failed", last_error: "page gone" }).in("id", goneIds);
  }
  const missing = await noteMissingFacts({ listingId, touched, readIds, unchangedIds, goneIds, cause, actorId });
  totals.missed = missing.missed;
  totals.retired += missing.retired;

  totals.seconds = Math.round((Date.now() - started) / 1000);
  const now = new Date().toISOString();
  await supabase.from("listing_agents").update({ last_sync_at: now }).eq("listing_id", listingId);
  return totals;
}

const sameUrl = (u) => String(u ?? "").trim().replace(/[#?].*$/, "").replace(/\/+$/, "").toLowerCase();

/*
 * After a read: a fact whose page was re-read (or is gone) and did not say it
 * again has missed a read; at MISSED_READS_TO_RETIRE in a row it is taken out.
 * A fact its page still says, or whose page is unchanged, starts over at 0.
 * Pure bookkeeping on listing_facts.missed_reads; never touches what the
 * landlord set or core facts.
 */
export async function noteMissingFacts({ listingId, touched, readIds = [], unchangedIds = [], goneIds = [], cause = "sync", actorId = null }) {
  const out = { missed: 0, retired: 0 };
  const ids = [...new Set([...readIds, ...unchangedIds, ...goneIds])];
  if (!ids.length) return out;
  const { data: facts, error } = await supabase.from("listing_facts")
    .select("id, section, field_key, summary, source_id, landlord_set, missed_reads")
    .eq("listing_id", listingId).eq("is_current", true).in("source_id", ids);
  if (error) {
    console.error("[agents] missing facts:", error.message);
    return out;
  }
  const unchanged = new Set(unchangedIds);
  const reset = [];
  for (const f of facts ?? []) {
    if (f.landlord_set || f.section === "core") continue;
    if (touched.has(f.id) || unchanged.has(f.source_id)) {
      if (f.missed_reads) reset.push(f.id);
      continue;
    }
    const missed = (f.missed_reads ?? 0) + 1;
    out.missed++;
    if (missed >= MISSED_READS_TO_RETIRE) {
      await retireFact({ factId: f.id, cause, actorId, detail: { reason: `not on its page for ${missed} weekly reads in a row` } });
      out.retired++;
    } else {
      await supabase.from("listing_facts").update({ missed_reads: missed }).eq("id", f.id);
    }
  }
  if (reset.length) await supabase.from("listing_facts").update({ missed_reads: 0 }).in("id", reset);
  return out;
}

/*
 * The daily specials check (Wyatt, 2026-11-12): specials come and go faster
 * than a weekly read, so each day's sync hands the specials its read found on
 * the website to Proxy, specials section only. Only when they differ from the
 * last ones it handed over (a hash on the listing's site_data source), and
 * never when the read found none: a special missing from one day's read is
 * left to the weekly read and its two-week rule.
 *
 * Returns a page-like result for the sync's digest row, or null when there
 * was nothing to do.
 */
export async function syncSpecials({ listingId, concessions, sourceUrl, actorId = null }) {
  const list = [...new Set((concessions ?? []).map((c) => String(c ?? "").trim()).filter(Boolean))].sort();
  if (!list.length) return null;
  const hash = createHash("sha256").update(list.join("\n")).digest("hex").slice(0, 32);
  const source = await findOrCreateSource({ listingId, kind: "site_data", label: "Website specials" });
  if (source.last_fingerprint === hash) return null;
  /*
   * Websites reword the same special between reads ("2 months free" one day,
   * "Receive two months of free rent" the next). When every special on the
   * site matches one the agent already knows, and the other way round,
   * nothing changed: no model call, and no correction sent to students.
   */
  const { data: known } = await supabase.from("listing_facts").select("summary, excerpt")
    .eq("listing_id", listingId).eq("section", "specials").eq("is_current", true);
  const matches = (c, f) => sameSpecial(c, f.excerpt ?? "") || sameSpecial(c, f.summary ?? "");
  const allKnown = (known ?? []).length > 0 && list.every((c) => known.some((f) => matches(c, f))) && known.every((f) => list.some((c) => matches(c, f)));
  if (allKnown) {
    await supabase.from("listing_sources").update({ last_checked_at: new Date().toISOString(), last_status: "unchanged", last_fingerprint: hash }).eq("id", source.id);
    return null;
  }
  const started = Date.now();
  const text = `The specials the listing's website shows today:\n${list.map((c) => `- ${c}`).join("\n")}\n\nA special the knowledge base has that is not in this list has ended: retire it.`;
  const r = await synthesizeKnowledge({ listingId, text, sourceKind: "page", sourceId: source.id, sourceRef: sourceUrl, cause: "sync", actorId, onlySections: ["specials"] });
  if (!r.failed) {
    await supabase.from("listing_sources").update({ last_checked_at: new Date().toISOString(), last_status: "changed", last_error: null, last_fingerprint: hash }).eq("id", source.id);
  }
  return { url: sourceUrl, specials: list.length, written: r.written ?? 0, retired: r.retired ?? 0, held: r.held ?? 0, seconds: Math.round((Date.now() - started) / 1000) };
}

/*
 * The daily read: every page this listing already knows, re-read if changed.
 * Pages the found reader made are left out: they are read once at launch
 * (lib/agents/foundRead.js), and re-reading them is a later decision. A
 * landlord page that source search also turned up stays in (foundUrls.js,
 * isFoundSource), as long as it is on a site the landlord gave us.
 */
export async function knownPageUrls(listingId) {
  const [{ data }, found, given] = await Promise.all([
    supabase.from("listing_sources").select("url").eq("listing_id", listingId).eq("kind", "page").eq("enabled", true).not("url", "is", null)
      .order("created_at", { ascending: true }).limit(MAX_CRAWL_PAGES + MAX_FOUND_PAGES),
    foundUrlSet(listingId),
    givenUrlsFor(listingId),
  ]);
  // And only pages on the sites the landlord gave us (Wyatt, 2026-11-07).
  const allowUrl = givenSiteFilter(given);
  return (data ?? []).map((r) => r.url).filter((u) => !found.has(u) && allowUrl(u)).slice(0, MAX_CRAWL_PAGES);
}
