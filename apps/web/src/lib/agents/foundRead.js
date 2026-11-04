/*
 * Found pages into knowledge (Wyatt, 2026-11-02).
 *
 * Source search (discover.js) saves the pages that describe a listing
 * elsewhere to listing_found_sources. This reads the confirmed ones into the
 * listing's knowledge, the same way a landlord's own pages are read
 * (synthesizeKnowledge), so a listing has up to date facts before its agent is
 * switched on. Pages waiting for review, and rejected ones, are never read.
 *
 * Precedence, best first (Wyatt: several sources per listing, in this order;
 * settling real conflicts comes later):
 *
 *   0  what the landlord said or set, their description and documents, the
 *      team's notes, old landlord chats
 *   1  pages the landlord gave us (imported site, Agent tab links)
 *   2  the property's own site or its management company's site (found)
 *   3  Apartments.com (found)
 *   4  Zillow (found)
 *
 * A fact is only replaced by a source at the same rank or better: a Zillow
 * page fills in what nothing else says, and never overwrites what the own site
 * or the landlord said. The groups are read best first, so a lower source
 * sees what the better ones already stored. Found pages never retire a fact:
 * one portal leaving something out is not evidence it stopped being true.
 * Which page is found and which is the landlord's is decided in foundUrls.js
 * (isFoundSource): a landlord page that search also turned up stays the
 * landlord's.
 *
 * Facts are written with cause 'seed': this is part of filling the agents
 * before launch, and a seed change is never announced to students as a
 * correction.
 *
 * Found pages are read once here. They are not added to the daily sync of
 * imported listings (knownPageUrls leaves them out); re-reading them on a
 * schedule is a later decision. A run reads only pages not looked at yet. A
 * page whose fetch or AI read failed is stamped as looked at too (last_error
 * says why), so a run always ends; a forced run with `since` retries them.
 *
 * Every list here is read in pages of 1000 rows (the API's cap on one
 * response), so the counts stay right however many pages there are.
 */
import { createHash } from "crypto";
import supabase from "@/lib/supabase";
import { fetchPageSmart, htmlToText } from "@/lib/listingDraft/fetchSite";
import { findOrCreateSource, ensureAgent } from "./store";
import { synthesizeKnowledge } from "./synthesize";
import { SITE_RANK, TOP_RANK, FOUND_CHECK_INTERVAL_DAYS, isFoundSource, sourceRank, pagesToRead, pageLooked } from "./foundUrls";

const PAGE_CHARS = 9000;
const BATCH_CHARS = 36000;
const ID_CHUNK = 200;

/* Every row of a query, 1000 at a time, in a stable order. */
async function allRows(build, label) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().order("id", { ascending: true }).range(from, from + 999);
    if (error) throw new Error(`${label}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

/* Rows for many listing ids, in chunks so the request stays short. */
async function rowsForListings(ids, build, label, column = "listing_id") {
  const out = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    out.push(...(await allRows(() => build().in(column, chunk), label)));
  }
  return out;
}

function groupBy(rows, key) {
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r[key])) by.set(r[key], []);
    by.get(r[key]).push(r);
  }
  return by;
}

const FOUND_COLUMNS = "id, listing_id, url, site, page_type, status, confidence, found_by";
const SOURCE_COLUMNS = "id, listing_id, kind, url, check_interval_days, last_checked_at, last_status";

/*
 * The pages the reader reads, per listing, and the page sources it already
 * has. Only published, live listings (or the one asked for).
 * Returns Map listingId -> { pages, sourceByUrl }.
 */
async function readablePages({ listingId = null } = {}) {
  const found = listingId
    ? await allRows(() => supabase.from("listing_found_sources").select(FOUND_COLUMNS).eq("listing_id", listingId).eq("status", "confirmed"), "found sources")
    : await allRows(() => supabase.from("listing_found_sources").select(FOUND_COLUMNS).eq("status", "confirmed"), "found sources");
  const foundBy = groupBy(found, "listing_id");
  const ids = [...foundBy.keys()];
  if (!ids.length) return new Map();

  const live = listingId
    ? new Set(ids)
    : new Set((await rowsForListings(ids, () => supabase.from("listings").select("id").not("published_at", "is", null).is("deleted_at", null), "listings", "id")).map((l) => l.id));
  const liveIds = ids.filter((id) => live.has(id));
  const sources = await rowsForListings(liveIds, () => supabase.from("listing_sources").select(SOURCE_COLUMNS).eq("kind", "page").not("url", "is", null), "page sources");
  const sourcesBy = groupBy(sources, "listing_id");

  const out = new Map();
  for (const id of liveIds) {
    const sourceByUrl = new Map((sourcesBy.get(id) ?? []).map((s) => [s.url, s]));
    const pages = pagesToRead(foundBy.get(id), sourceByUrl);
    if (pages.length) out.set(id, { pages, sourceByUrl });
  }
  return out;
}

/* The rank of every source this listing has, by source id. */
async function sourceRanks(listingId) {
  const [{ data: sources, error }, { data: found, error: e2 }] = await Promise.all([
    supabase.from("listing_sources").select("id, kind, url, check_interval_days").eq("listing_id", listingId).limit(1000),
    supabase.from("listing_found_sources").select("url, site, found_by").eq("listing_id", listingId).limit(1000),
  ]);
  if (error) throw new Error(`sources: ${error.message}`);
  if (e2) throw new Error(`found sources: ${e2.message}`);
  const foundByUrl = new Map((found ?? []).map((f) => [f.url, f]));
  return new Map((sources ?? []).map((s) => [s.id, sourceRank(s, foundByUrl.get(s.url))]));
}

async function fetchText(url) {
  const page = await fetchPageSmart(url);
  return htmlToText(page?.html ?? "").trim().slice(0, PAGE_CHARS);
}

function batchesOf(pages) {
  const out = [];
  let cur = [];
  let size = 0;
  for (const p of pages) {
    if (cur.length && size + p.text.length > BATCH_CHARS) { out.push(cur); cur = []; size = 0; }
    cur.push(p); size += p.text.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

/*
 * Stamp a page as looked at but not read. last_status only allows the sync's
 * own values (a check constraint), so a failed AI read is a parse_failed with
 * the reason in last_error. A stamp that does not save is an error: a page
 * left unstamped would be picked again by every batch.
 */
const AI_READ_FAILED = "AI read failed";

async function stampFailed(source, status, message) {
  const { error } = await supabase.from("listing_sources").update({
    last_checked_at: new Date().toISOString(), last_status: status, last_error: String(message).slice(0, 300),
    consecutive_failures: (source.consecutive_failures ?? 0) + 1,
  }).eq("id", source.id);
  if (error) throw new Error(`stamp page: ${error.message}`);
}

/*
 * Read one batch of pages into knowledge. A dense batch can need more facts
 * than one answer holds, which comes back cut off: split it in half and try
 * again. Any other failure, or a single page still cut off, stamps the pages
 * as failed (no fingerprint, so a forced run reads them again) and the
 * listing's other batches go on.
 */
async function readBatch(listingId, batch, rank, out) {
  try {
    const ranks = await sourceRanks(listingId);
    const text = batch.map((p, i) => `=== PAGE ${i + 1}: ${p.url} ===\n${p.text}`).join("\n\n");
    const pageSources = batch.map((p, i) => ({ n: i + 1, url: p.url, sourceId: p.source.id }));
    const r = await synthesizeKnowledge({
      listingId, text, sourceKind: "page", sourceId: batch[0].source.id, sourceRef: batch[0].url,
      cause: "seed", pageSources, noRetire: true,
      // Replace only what came from a source at this rank or worse. A fact
      // with no recorded source is treated as the landlord's.
      canReplace: (fact) => (fact.source_id ? ranks.get(fact.source_id) ?? TOP_RANK : TOP_RANK) >= rank,
    });
    out.written += r.written ?? 0; out.kept += r.kept ?? 0; out.held += r.held ?? 0;
    const now = new Date().toISOString();
    for (const p of batch) {
      await supabase.from("listing_sources").update({
        last_checked_at: now, last_status: "changed", last_error: null, consecutive_failures: 0, last_fingerprint: p.hash,
        next_check_at: new Date(Date.now() + FOUND_CHECK_INTERVAL_DAYS * 86400000).toISOString(),
      }).eq("id", p.source.id);
    }
    out.read += batch.length;
  } catch (err) {
    const message = String(err?.message ?? err).slice(0, 300);
    if (batch.length > 1 && /parse structured output/i.test(message)) {
      const half = Math.ceil(batch.length / 2);
      await readBatch(listingId, batch.slice(0, half), rank, out);
      await readBatch(listingId, batch.slice(half), rank, out);
      return;
    }
    for (const p of batch) {
      await stampFailed(p.source, "parse_failed", `${AI_READ_FAILED}: ${message}`);
      out.errors.push({ url: p.url, error: message });
    }
    out.failed += batch.length;
  }
}

/*
 * Read one listing's confirmed found pages. Returns
 * { listingId, pages, read, unchanged, failed, written, kept, held, errors }.
 * A page that cannot be fetched or read is stamped with why and counted in
 * `failed`; one failed AI read does not stop the listing's other sites.
 */
export async function readFoundPages(listingId, { force = false, pages = null } = {}) {
  await ensureAgent(listingId);
  const found = pages ?? (await readablePages({ listingId })).get(listingId)?.pages ?? [];
  const out = { listingId, pages: found.length, read: 0, unchanged: 0, failed: 0, written: 0, kept: 0, held: 0, errors: [] };
  if (!found.length) return out;

  // Fetch every page first; group what changed by rank.
  const groups = new Map();
  for (const f of found) {
    const source = await findOrCreateSource({ listingId, kind: "page", url: f.url, label: f.url, checkIntervalDays: FOUND_CHECK_INTERVAL_DAYS });
    // A landlord page made since the list was read stays the landlord's.
    if (!isFoundSource(source, f)) continue;
    const now = new Date().toISOString();
    try {
      const text = await fetchText(f.url);
      if (text.length < 80) {
        await stampFailed(source, "parse_failed", "no readable text");
        out.failed++;
        continue;
      }
      const hash = createHash("sha256").update(text).digest("hex").slice(0, 32);
      if (!force && source.last_fingerprint === hash) {
        await supabase.from("listing_sources").update({ last_checked_at: now, last_status: "unchanged", last_error: null, consecutive_failures: 0 }).eq("id", source.id);
        out.unchanged++;
        continue;
      }
      const rank = SITE_RANK[f.site];
      if (!groups.has(rank)) groups.set(rank, []);
      groups.get(rank).push({ url: f.url, text, hash, source });
    } catch (err) {
      const message = String(err?.message ?? err).slice(0, 300);
      await stampFailed(source, "fetch_failed", message);
      out.failed++;
      out.errors.push({ url: f.url, error: message });
    }
  }

  // Best rank first, so a lower source sees what a better one stored.
  for (const rank of [...groups.keys()].sort((a, b) => a - b)) {
    for (const batch of batchesOf(groups.get(rank))) await readBatch(listingId, batch, rank, out);
  }
  return out;
}

/*
 * A listing that failed before any page was stamped (its agent could not be
 * made, say): stamp its pages so the next batch moves on. Best effort.
 */
async function stampListingFailed(pages, message) {
  for (const f of pages) {
    try {
      const source = await findOrCreateSource({ listingId: f.listing_id, kind: "page", url: f.url, label: f.url, checkIntervalDays: FOUND_CHECK_INTERVAL_DAYS });
      if (isFoundSource(source, f)) await stampFailed(source, "parse_failed", `${AI_READ_FAILED}: ${message}`);
    } catch {
      // Nothing more to do; the panel stops a run that makes no progress.
    }
  }
}

/*
 * One batch of the launch read: listings with a readable found page not
 * looked at yet. With force, `since` is required (the run's start), and a
 * page counts as looked at once it was looked at after it; a forced run with
 * no start would read the same listings for ever. `remaining` > 0: call again.
 */
export async function readFoundBatch({ limit = 4, concurrency = 4, force = false, since = null, listingId = null } = {}) {
  if (force && !since && !listingId) throw new Error("A forced read needs since (when the run started).");
  const readable = await readablePages({ listingId });
  const todo = [...readable.keys()].filter((id) => {
    const { pages, sourceByUrl } = readable.get(id);
    if (force && listingId) return true;
    return pages.some((p) => !pageLooked(sourceByUrl.get(p.url), force ? since : null));
  });
  const batch = todo.slice(0, limit);

  const results = [];
  let next = 0;
  async function worker() {
    while (next < batch.length) {
      const id = batch[next++];
      try {
        results.push(await readFoundPages(id, { force, pages: readable.get(id).pages }));
      } catch (err) {
        const message = String(err?.message ?? err).slice(0, 200);
        await stampListingFailed(readable.get(id).pages, message);
        results.push({ listingId: id, error: message });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, batch.length || 1) }, worker));
  const sum = (k) => results.reduce((n, r) => n + (r[k] ?? 0), 0);
  return {
    listings: results.filter((r) => !r.error).length,
    listingIds: batch,
    pages: sum("read"), unchanged: sum("unchanged"), failedPages: sum("failed"),
    written: sum("written"), kept: sum("kept"), held: sum("held"),
    failed: results.filter((r) => r.error),
    remaining: todo.length - batch.length,
    total: readable.size,
  };
}

/* For the admin view: the pages the reader will read, and how many it has looked at. */
export async function foundReadOverview() {
  const readable = await readablePages();
  let pages = 0;
  let pagesRead = 0;
  let pagesFailed = 0;
  for (const { pages: list, sourceByUrl } of readable.values()) {
    for (const p of list) {
      pages++;
      const s = sourceByUrl.get(p.url);
      if (pageLooked(s)) pagesRead++;
      if (s?.last_status?.endsWith("_failed")) pagesFailed++;
    }
  }
  return { listings: readable.size, pages, pagesRead, pagesFailed };
}

/*
 * The daily sync's view: urls of this listing's page sources that the found
 * reader made (read once at launch, not synced). Landlord pages are never in it.
 */
export async function foundUrlSet(listingId) {
  const [{ data: sources }, { data: found }] = await Promise.all([
    supabase.from("listing_sources").select("url, check_interval_days").eq("listing_id", listingId).eq("kind", "page").not("url", "is", null).limit(1000),
    supabase.from("listing_found_sources").select("url, found_by").eq("listing_id", listingId).limit(1000),
  ]);
  const foundByUrl = new Map((found ?? []).map((f) => [f.url, f]));
  return new Set((sources ?? []).filter((s) => isFoundSource(s, foundByUrl.get(s.url))).map((s) => s.url));
}
