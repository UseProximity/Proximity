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
 *
 * Facts are written with cause 'seed': this is part of filling the agents
 * before launch, and a seed change is never announced to students as a
 * correction.
 *
 * Found pages are read once here. They are not added to the daily sync of
 * imported listings (knownPageUrls leaves them out); re-reading them on a
 * schedule is a later decision. A re-run reads only pages not read yet, or
 * every page again with force.
 */
import { createHash } from "crypto";
import supabase from "@/lib/supabase";
import { fetchPageSmart, htmlToText } from "@/lib/listingDraft/fetchSite";
import { findOrCreateSource, ensureAgent } from "./store";
import { synthesizeKnowledge } from "./synthesize";

const SITE_RANK = { own_site: 2, company_site: 2, apartments_com: 3, zillow: 4 };
const LANDLORD_PAGE_RANK = 1;
const TOP_RANK = 0;

// Pages per listing (the most likely first) and how much of each is read.
const MAX_PAGES = 8;
const PAGE_CHARS = 9000;
const BATCH_CHARS = 36000;
// Found pages are not re-read on a schedule yet; this only spaces out a retry.
const CHECK_INTERVAL_DAYS = 30;

const PAGE_ORDER = { building: 0, unit: 1, home: 2 };

/* Every row of a query, a page at a time (the database caps one request at 1000 rows). */
async function allRows(build, what) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().order("id").range(from, from + 999);
    if (error) throw new Error(`${what}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

async function confirmedPages(listingIds) {
  const rows = [];
  for (let i = 0; i < listingIds.length; i += 50) {
    rows.push(...(await allRows(() => supabase.from("listing_found_sources")
      .select("id, listing_id, url, site, page_type, confidence")
      .in("listing_id", listingIds.slice(i, i + 50)).eq("status", "confirmed"), "found sources")));
  }
  const by = new Map();
  for (const r of rows) {
    if (!SITE_RANK[r.site]) continue;
    if (!by.has(r.listing_id)) by.set(r.listing_id, []);
    by.get(r.listing_id).push(r);
  }
  for (const list of by.values()) {
    list.sort((a, b) => SITE_RANK[a.site] - SITE_RANK[b.site]
      || (PAGE_ORDER[a.page_type] ?? 9) - (PAGE_ORDER[b.page_type] ?? 9)
      || Number(b.confidence ?? 0) - Number(a.confidence ?? 0));
    list.splice(MAX_PAGES);
  }
  return by;
}

/*
 * "<listing id> <url>" for every page already looked at. The database hands
 * back at most 1000 rows per request, so read in small groups and pages, or a
 * read listing looks unread and a run keeps picking it again.
 */
async function lookedAtPages(listingIds, since = null) {
  const looked = new Set();
  for (let i = 0; i < listingIds.length; i += 50) {
    for (let from = 0; ; from += 1000) {
      let q = supabase.from("listing_sources").select("listing_id, url").eq("kind", "page")
        .in("listing_id", listingIds.slice(i, i + 50)).not("last_checked_at", "is", null);
      if (since) q = q.gte("last_checked_at", new Date(since).toISOString());
      const { data, error } = await q.order("id").range(from, from + 999);
      if (error) throw new Error(`read pages: ${error.message}`);
      for (const s of data ?? []) looked.add(`${s.listing_id} ${s.url}`);
      if (!data || data.length < 1000) break;
    }
  }
  return looked;
}

/* The rank of every source this listing has, by source id. */
async function sourceRanks(listingId, foundSite) {
  const { data, error } = await supabase.from("listing_sources").select("id, kind, url").eq("listing_id", listingId);
  if (error) throw new Error(`sources: ${error.message}`);
  const ranks = new Map();
  for (const s of data ?? []) {
    if (s.kind !== "page") ranks.set(s.id, TOP_RANK);
    else if (s.kind === "page" && foundSite.has(s.url)) ranks.set(s.id, SITE_RANK[foundSite.get(s.url)]);
    else ranks.set(s.id, LANDLORD_PAGE_RANK);
  }
  return ranks;
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
 * Read one batch of pages into knowledge. A dense batch can need more facts
 * than one answer holds, which comes back cut off; split it in half and try
 * again. A single page that still fails is marked failed and skipped, so one
 * bad page never stops the listing or keeps a run retrying it.
 */
async function readBatch(listingId, batch, rank, foundSite, out) {
  const ranks = await sourceRanks(listingId, foundSite);
  const text = batch.map((p, i) => `=== PAGE ${i + 1}: ${p.url} ===\n${p.text}`).join("\n\n");
  const pageSources = batch.map((p, i) => ({ n: i + 1, url: p.url, sourceId: p.source.id }));
  let r;
  try {
    r = await synthesizeKnowledge({
      listingId, text, sourceKind: "page", sourceId: batch[0].source.id, sourceRef: batch[0].url,
      cause: "seed", pageSources, noRetire: true,
      // Replace only what came from a source at this rank or worse. A fact
      // with no recorded source is treated as the landlord's.
      canReplace: (fact) => (fact.source_id ? ranks.get(fact.source_id) ?? TOP_RANK : TOP_RANK) >= rank,
    });
  } catch (err) {
    const message = String(err?.message ?? err).slice(0, 300);
    if (!/parse structured output/i.test(message)) throw err;
    if (batch.length > 1) {
      const half = Math.ceil(batch.length / 2);
      await readBatch(listingId, batch.slice(0, half), rank, foundSite, out);
      await readBatch(listingId, batch.slice(half), rank, foundSite, out);
      return;
    }
    const p = batch[0];
    await supabase.from("listing_sources").update({
      last_checked_at: new Date().toISOString(), last_status: "parse_failed", last_error: message,
      consecutive_failures: (p.source.consecutive_failures ?? 0) + 1,
    }).eq("id", p.source.id);
    out.failed++;
    out.errors.push({ url: p.url, error: message });
    return;
  }
  out.written += r.written ?? 0; out.kept += r.kept ?? 0; out.held += r.held ?? 0;
  const now = new Date().toISOString();
  for (const p of batch) {
    await supabase.from("listing_sources").update({
      last_checked_at: now, last_status: "changed", last_error: null, consecutive_failures: 0, last_fingerprint: p.hash,
      next_check_at: new Date(Date.now() + CHECK_INTERVAL_DAYS * 86400000).toISOString(),
    }).eq("id", p.source.id);
  }
  out.read += batch.length;
}

/*
 * Read one listing's confirmed found pages. Returns
 * { listingId, pages, read, unchanged, failed, written, kept, held }.
 */
export async function readFoundPages(listingId, { force = false, pages = null } = {}) {
  await ensureAgent(listingId);
  const found = pages ?? (await confirmedPages([listingId])).get(listingId) ?? [];
  const out = { listingId, pages: found.length, read: 0, unchanged: 0, failed: 0, written: 0, kept: 0, held: 0, errors: [] };
  if (!found.length) return out;
  const foundSite = new Map(found.map((f) => [f.url, f.site]));

  // Fetch every page first; group what changed by rank.
  const groups = new Map();
  for (const f of found) {
    const source = await findOrCreateSource({ listingId, kind: "page", url: f.url, label: f.url, checkIntervalDays: CHECK_INTERVAL_DAYS });
    const now = new Date().toISOString();
    try {
      const text = await fetchText(f.url);
      if (text.length < 80) {
        await supabase.from("listing_sources").update({ last_checked_at: now, last_status: "parse_failed", last_error: "no readable text", consecutive_failures: (source.consecutive_failures ?? 0) + 1 }).eq("id", source.id);
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
      await supabase.from("listing_sources").update({ last_checked_at: now, last_status: "fetch_failed", last_error: message, consecutive_failures: (source.consecutive_failures ?? 0) + 1 }).eq("id", source.id);
      out.failed++;
      out.errors.push({ url: f.url, error: message });
    }
  }

  // Best rank first, so a lower source sees what a better one stored.
  for (const rank of [...groups.keys()].sort((a, b) => a - b)) {
    for (const batch of batchesOf(groups.get(rank))) await readBatch(listingId, batch, rank, foundSite, out);
  }
  return out;
}

/*
 * One batch of the launch read: listings with a confirmed found page that has
 * not been looked at yet (or every one, with force). `remaining` > 0: call
 * again. A page that failed counts as looked at, so a dead page cannot keep a
 * run going; force retries it.
 */
export async function readFoundBatch({ limit = 4, concurrency = 4, force = false, since = null, listingId = null } = {}) {
  const { data: listings, error } = listingId
    ? await supabase.from("listings").select("id").eq("id", listingId)
    : await supabase.from("listings").select("id").not("published_at", "is", null).is("deleted_at", null).order("created_at", { ascending: true }).limit(5000);
  if (error) throw new Error(`listings: ${error.message}`);
  const pagesBy = await confirmedPages((listings ?? []).map((l) => l.id));
  const withPages = [...pagesBy.keys()];

  // Which found pages were already looked at (since the run started, with force).
  const looked = await lookedAtPages(withPages, force && since ? since : null);
  const todo = withPages.filter((id) => (force && !since) || pagesBy.get(id).some((p) => !looked.has(`${id} ${p.url}`)));
  const batch = todo.slice(0, limit);

  const results = [];
  let next = 0;
  async function worker() {
    while (next < batch.length) {
      const id = batch[next++];
      try {
        results.push(await readFoundPages(id, { force, pages: pagesBy.get(id) }));
      } catch (err) {
        results.push({ listingId: id, error: String(err?.message ?? err).slice(0, 200) });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, batch.length || 1) }, worker));
  const sum = (k) => results.reduce((n, r) => n + (r[k] ?? 0), 0);
  return {
    listings: results.filter((r) => !r.error).length,
    pages: sum("read"), unchanged: sum("unchanged"), failedPages: sum("failed"),
    written: sum("written"), kept: sum("kept"), held: sum("held"),
    failed: results.filter((r) => r.error),
    remaining: todo.length - batch.length,
    total: withPages.length,
  };
}

/* For the admin view: listings with confirmed pages, and how many are read. */
export async function foundReadOverview() {
  const data = await allRows(() => supabase.from("listing_found_sources").select("id, listing_id, url").eq("status", "confirmed"), "found read overview");
  const listings = new Set((data ?? []).map((r) => r.listing_id));
  const ids = [...listings];
  const read = await lookedAtPages(ids);
  const pagesRead = (data ?? []).filter((r) => read.has(`${r.listing_id} ${r.url}`)).length;
  return { listings: listings.size, pages: data?.length ?? 0, pagesRead };
}

/* Found pages are read once at launch, not by the daily sync. */
export async function foundUrlSet(listingId) {
  const { data } = await supabase.from("listing_found_sources").select("url").eq("listing_id", listingId).limit(500);
  return new Set((data ?? []).map((r) => r.url));
}
