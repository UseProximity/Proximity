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
import { fetchPage, fetchPageSmart, htmlToText } from "@/lib/listingDraft/fetchSite";
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
// As much of one page as the old daily read gave the model, so a fact from
// the bottom of a long FAQ can still be read again.
const PAGE_CHARS = 24000;

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
// A page that answers with a "not found" page of its own instead of a 404.
const NOT_FOUND_TEXT = /\b(404|page not found|page cannot be found|page could not be found|page you (?:are|were|'re) looking for|no longer exists)\b/i;
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
  const failedPages = [];
  for (const url of known.filter((u) => !crawled.has(sameUrl(u))).slice(0, MAX_RECHECKS)) {
    if (Date.now() - started > READ_DEADLINE_MS) break;
    const r = await recheckPage(url);
    if (r.gone) gonePages.push(url);
    else if (r.failed) failedPages.push({ url, error: r.error });
    else pages.push({ url, html: r.html });
  }

  const changed = [];
  const unchangedIds = [];
  // Everything the site says this week, whole pages, changed or not: a fact
  // whose own words are still on the site has not gone (noteMissingFacts).
  const siteText = [];
  for (const p of pages) {
    const full = htmlToText(p.html).trim();
    const text = full.slice(0, PAGE_CHARS);
    const source = await findOrCreateSource({ listingId, kind: "page", url: p.url, label: p.url, checkIntervalDays: 7 });
    if (text.length < 80) continue;
    siteText.push(normText(full));
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
    // noRetire: a batch is a few pages of the site, so a fact it does not
    // mention may well be on another page. Taking facts out is left to the
    // missed-reads rule below, which sees the whole site.
    const r = await synthesizeKnowledge({ listingId, text, sourceKind: "page", sourceId: batch[0].source.id, sourceRef: batch[0].url, cause, actorId, pageSources, noRetire: true });
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

  // Known pages that failed for another reason: counted, so after
  // STALE_AFTER_FAILURES in a row their facts read as stale.
  for (const f of failedPages) {
    const source = await findOrCreateSource({ listingId, kind: "page", url: f.url, label: f.url, checkIntervalDays: 7 });
    await supabase.from("listing_sources").update({ last_checked_at: new Date().toISOString(), last_status: "fetch_failed", last_error: f.error, consecutive_failures: (source.consecutive_failures ?? 0) + 1 }).eq("id", source.id);
  }
  if (failedPages.length) await markStaleSources(listingId);

  // Gone pages: their source rows are marked so the facts' page reads as gone.
  let goneIds = [];
  if (gonePages.length) {
    const { data } = await supabase.from("listing_sources").select("id").eq("listing_id", listingId).eq("kind", "page").in("url", gonePages);
    goneIds = (data ?? []).map((r) => r.id);
    if (goneIds.length) await supabase.from("listing_sources").update({ last_checked_at: new Date().toISOString(), last_status: "fetch_failed", last_error: "page gone" }).in("id", goneIds);
  }
  const missing = await noteMissingFacts({ listingId, touched, readIds, unchangedIds, goneIds, siteText: siteText.join("\n"), cause, actorId });
  totals.missed = missing.missed;
  totals.retired += missing.retired;

  totals.seconds = Math.round((Date.now() - started) / 1000);
  const now = new Date().toISOString();
  await supabase.from("listing_agents").update({ last_sync_at: now }).eq("listing_id", listingId);
  return totals;
}

const sameUrl = (u) => String(u ?? "").trim().replace(/[#?].*$/, "").replace(/\/+$/, "").toLowerCase();

const normText = (t) => String(t ?? "").toLowerCase().replace(/[^a-z0-9$%]+/g, " ").trim();

/*
 * True when the words a fact was taken from are still somewhere on the site.
 * The excerpt is the model's quote of the page; an ellipsis splits it into
 * parts, and any part of 12 characters or more that is found counts.
 */
export function excerptOnSite(excerpt, siteText) {
  if (!excerpt || !siteText) return false;
  return String(excerpt).split(/\.{3}|\u2026|\n/).map(normText).filter((x) => x.length >= 12).some((x) => siteText.includes(x));
}

/*
 * One known page the crawl did not reach. A plain fetch first: a real 404 or
 * 410 is gone without paying for a render. Then the full fetch, and a page
 * that renders as a short "not found" page counts as gone too.
 */
async function recheckPage(url) {
  try {
    const page = await fetchPage(url);
    if (page?.html && htmlToText(page.html).length >= 800) return looksGone(page.html) ? { gone: true } : { html: page.html };
  } catch (err) {
    if (GONE_CODES.has(err?.code)) return { gone: true };
  }
  try {
    const page = await fetchPageSmart(url);
    if (!page?.html) return { failed: true, error: "no page" };
    return looksGone(page.html) ? { gone: true } : { html: page.html };
  } catch (err) {
    if (GONE_CODES.has(err?.code)) return { gone: true };
    return { failed: true, error: String(err?.code ?? err?.message ?? "fetch failed").slice(0, 300) };
  }
}

function looksGone(html) {
  const text = htmlToText(html);
  return text.length < 2500 && NOT_FOUND_TEXT.test(text.slice(0, 1500));
}

/*
 * After a read: a fact whose page was re-read (or is gone) and did not say it
 * again has missed a read; at MISSED_READS_TO_RETIRE in a row it is taken out.
 * A fact still counts as said when the model stated it again, when its own
 * words (the excerpt) are still anywhere on the site, or when its page is
 * unchanged; then it starts over at 0. Specials do not get the unchanged-page
 * pass: the daily check files them under the start page, which can stay the
 * same after a special on another page ends. The daily check resets the
 * specials it still sees (syncSpecials).
 * Pure bookkeeping on listing_facts.missed_reads; never touches what the
 * landlord set or core facts.
 */
export async function noteMissingFacts({ listingId, touched, readIds = [], unchangedIds = [], goneIds = [], siteText = "", cause = "sync", actorId = null }) {
  const out = { missed: 0, retired: 0 };
  const ids = [...new Set([...readIds, ...unchangedIds, ...goneIds])];
  if (!ids.length) return out;
  const { data: facts, error } = await supabase.from("listing_facts")
    .select("id, section, field_key, summary, excerpt, source_id, landlord_set, missed_reads")
    .eq("listing_id", listingId).eq("is_current", true).in("source_id", ids);
  if (error) {
    console.error("[agents] missing facts:", error.message);
    return out;
  }
  const unchanged = new Set(unchangedIds);
  const reset = [];
  for (const f of facts ?? []) {
    if (f.landlord_set || f.section === "core") continue;
    const stillSaid = touched.has(f.id) || excerptOnSite(f.excerpt, siteText) || (unchanged.has(f.source_id) && f.section !== "specials");
    if (stillSaid) {
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
 * than a weekly read, so each day's sync looks at the specials its read found
 * on the website. It only ever adds: the read's list of specials comes from
 * one look at the site and can miss one, so a special missing from it is
 * never taken out here. Ending a special is the weekly read's job and its
 * two-week rule (noteMissingFacts).
 *
 *   - a known special the read still shows has its missed reads reset, so
 *     the weekly rule never takes out a special the site still shows
 *   - a special the agent does not know yet goes to Proxy, specials only,
 *     filed under the website's start page so the weekly read covers it
 *
 * Websites reword the same special between reads ("2 months free" one day,
 * "Receive two months of free rent" the next): those match a known special
 * and change nothing, so no correction goes to students.
 *
 * Returns a page-like result for the sync's digest row, or null when there
 * was nothing to do.
 */
export async function syncSpecials({ listingId, concessions, sourceUrl, actorId = null }) {
  const list = [...new Set((concessions ?? []).map((c) => String(c ?? "").trim()).filter(Boolean))].sort();
  if (!list.length || !sourceUrl) return null;
  const { data: known } = await supabase.from("listing_facts").select("id, summary, excerpt, missed_reads")
    .eq("listing_id", listingId).eq("section", "specials").eq("is_current", true);
  const matches = (c, f) => sameSpecial(c, f.excerpt ?? "") || sameSpecial(c, f.summary ?? "");
  const seen = (known ?? []).filter((f) => f.missed_reads && list.some((c) => matches(c, f))).map((f) => f.id);
  if (seen.length) await supabase.from("listing_facts").update({ missed_reads: 0 }).in("id", seen);
  const fresh = list.filter((c) => !(known ?? []).some((f) => matches(c, f)));
  if (!fresh.length) return null;
  // The same new specials as yesterday that Proxy chose not to store (not
  // about this listing, say): no second model call. The marker lives on the
  // listing's one site_data source.
  const hash = createHash("sha256").update(fresh.join("\n")).digest("hex").slice(0, 32);
  const marker = await findOrCreateSource({ listingId, kind: "site_data", label: "Listing data on Proximity" });
  if (marker.last_fingerprint === hash) return null;
  const page = await findOrCreateSource({ listingId, kind: "page", url: sourceUrl, label: sourceUrl, checkIntervalDays: 7 });
  const started = Date.now();
  const text = `The specials the listing's website shows today:\n${list.map((c) => `- ${c}`).join("\n")}\n\nStore any special here that the knowledge base does not already have. Do not change or retire anything else.`;
  const r = await synthesizeKnowledge({ listingId, text, sourceKind: "page", sourceId: page.id, sourceRef: sourceUrl, cause: "sync", actorId, onlySections: ["specials"], noRetire: true });
  if (!r.failed) await supabase.from("listing_sources").update({ last_fingerprint: hash }).eq("id", marker.id);
  return { url: sourceUrl, specials: list.length, written: r.written ?? 0, retired: 0, held: r.held ?? 0, seconds: Math.round((Date.now() - started) / 1000) };
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
