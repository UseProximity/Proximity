/*
 * Finding each listing's sources of truth (Wyatt, 2026-10-31).
 *
 * Before the agents launch, every published listing is searched for the pages
 * that describe it elsewhere: its Zillow and Apartments.com pages (building
 * and per-apartment), the property's own website or its page on the
 * landlord's site, and the management company's site. The more references
 * the better; conflicts between them are settled later. This only RETRIEVES:
 * found pages are saved to listing_found_sources and nothing reads, syncs or
 * shows them yet.
 *
 * Where candidates come from, per listing:
 *   - the page it was imported from (listings.source_url) and the pages its
 *     agent already reads (listing_sources kind 'page')
 *   - links in its description
 *   - the contact email's domain, when it is a company's (not gmail etc.)
 *   - web searches (Tavily): the address on Zillow, on Apartments.com and on
 *     the open web; the building's name the same way when it has one; the
 *     address on the company's own domain
 *
 * How a page is judged:
 *   - the listing's exact address on the page (title, URL or text): confirmed
 *   - otherwise, a page that names the building or sits on the company's
 *     domain is shown to Haiku, which says whether it is about this property;
 *     a yes or unsure is saved as needs_review for the team to accept or
 *     reject in the admin Agents view; a no is dropped
 *   - a neighbour's address, other portals (Realtor, Trulia, HotPads...) and
 *     search or city pages are dropped
 *
 * Re-running is safe: a page already saved is updated, never duplicated, and
 * one the team reviewed keeps its verdict. Each listing records when it was
 * searched (listing_agents.sources_searched_at), so a run resumes where a
 * previous one stopped.
 */
import { z } from "zod";
import supabase from "@/lib/supabase";
import { parseStructured, HAIKU } from "./model";
import { ensureAgent, recordUsage } from "./store";
import { compareAddress, parseAddress, buildingName, mentionsName, addressesIn } from "./address";
import { classifyUrl, hostOf, onDomain } from "./foundUrls";

// Pages per listing Haiku is asked about (most likely first).
const JUDGE_MAX = 15;

// Tavily's basic search costs one credit, about $0.008.
const SEARCH_COST_CENTS = 0.8;

const FREE_EMAIL = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "aol.com", "live.com", "msn.com",
  "me.com", "mac.com", "comcast.net", "att.net", "sbcglobal.net", "charter.net", "proton.me", "protonmail.com",
  "wustl.edu", "slu.edu", "umsl.edu", "proximity.test", "useproximity.org", "example.com",
]);

/*
 * Web search. Tavily first; when it refuses (HTTP 429: our key is a
 * development key with a low rate limit, 2026-10-31) it is rested for a
 * minute and Firecrawl's search answers instead, with the domains written
 * into the query. Calls are spaced out across the whole process so a batch
 * does not trip the limit to begin with.
 */
const SEARCH_GAP_MS = 700;
let lastSearch = Promise.resolve();
let tavilyRestUntil = 0;

function spaced() {
  const turn = lastSearch.then(() => new Promise((r) => setTimeout(r, SEARCH_GAP_MS)));
  lastSearch = turn;
  return turn;
}

async function tavily(query, includeDomains) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return null;
  if (Date.now() < tavilyRestUntil) return null;
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, max_results: 8, search_depth: "basic", ...(includeDomains ? { include_domains: includeDomains } : {}) }),
    signal: AbortSignal.timeout(30000),
  });
  if (res.status === 429 || res.status === 432) {
    tavilyRestUntil = Date.now() + 60_000;
    return null;
  }
  if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
  const data = await res.json();
  return (data.results ?? []).map((r) => ({ url: r.url, title: r.title ?? "", content: String(r.content ?? "").slice(0, 600) }));
}

async function firecrawlSearch(query, includeDomains) {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return null;
  const sites = includeDomains?.length ? ` (${includeDomains.map((d) => `site:${d}`).join(" OR ")})` : "";
  const res = await fetch("https://api.firecrawl.dev/v2/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: `${query}${sites}`, limit: 8 }),
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`Firecrawl HTTP ${res.status}`);
  const data = await res.json();
  const web = data?.data?.web ?? data?.data ?? [];
  return (Array.isArray(web) ? web : []).map((r) => ({ url: r.url, title: r.title ?? "", content: String(r.description ?? r.markdown ?? "").slice(0, 600) }));
}

async function search(query, includeDomains = null) {
  await spaced();
  const t = await tavily(query, includeDomains);
  if (t) return { results: t, via: "tavily" };
  const f = await firecrawlSearch(query, includeDomains);
  if (f) return { results: f, via: "firecrawl" };
  throw new Error("no search service available (TAVILY_API_KEY and FIRECRAWL_API_KEY missing or refusing)");
}

const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+/gi;
/*
 * One spelling per page, so "stlcitywide.com" and "stlcitywide.com/" are one
 * row: no trailing punctuation, slash, query or fragment, lowercase host.
 */
export function canonicalUrl(u) {
  const raw = String(u ?? "").trim().replace(/[.,;:!?]+$/, "");
  try {
    const x = new URL(raw);
    const path = x.pathname.replace(/\/+$/, "");
    return `${x.protocol}//${x.hostname.toLowerCase()}${path}`;
  } catch {
    return raw;
  }
}

// "7342 Dartmouth Avenue, University City, Missouri 63130, United States" -> without the country.
const cleanAddress = (a) => String(a ?? "").replace(/,?\s*United States$/i, "").trim();
const cityOf = (listing) => listing.city || String(listing.address ?? "").split(",")[1]?.trim() || "St. Louis";

function companyDomain(email) {
  const d = String(email ?? "").toLowerCase().split("@")[1]?.trim();
  if (!d || FREE_EMAIL.has(d) || !d.includes(".")) return null;
  return d;
}

/*
 * The searches for one listing. Each is { query, domains, why } and costs one
 * credit; four to six per listing.
 */
export function searchesFor(listing) {
  const address = cleanAddress(listing.address);
  const name = buildingName(listing.title, listing.address);
  const city = cityOf(listing);
  const domain = companyDomain(listing.contact_email);
  const p = parseAddress(address);
  const out = [];
  if (p) {
    out.push({ query: address, domains: ["zillow.com"], why: "address on Zillow" });
    out.push({ query: address, domains: ["apartments.com"], why: "address on Apartments.com" });
    out.push({ query: `${address} apartment for rent`, domains: null, why: "address on the web" });
  }
  if (name) {
    out.push({ query: `"${name}" ${city} MO`, domains: ["zillow.com", "apartments.com"], why: "name on Zillow and Apartments.com" });
    out.push({ query: `"${name}" apartments ${city} MO`, domains: null, why: "name on the web" });
  }
  if (domain && p) {
    out.push({ query: `${p.from} ${p.name} ${city}`, domains: [domain], why: "address on the company's site" });
  }
  return out;
}

const Verdicts = z.object({
  pages: z.array(z.object({
    n: z.number().int(),
    about_this_property: z.enum(["yes", "no", "unsure"]),
    reason: z.string(),
  })),
});

/*
 * Haiku's call on the pages that did not show the exact address: is each one
 * about this property? One request per listing.
 */
async function judge(listing, pages) {
  if (!pages.length) return [];
  pages = pages.slice(0, JUDGE_MAX);
  const list = pages.map((c, i) => `${i + 1}. ${c.url}\n   Title: ${c.title}\n   Text: ${c.content.slice(0, 300)}`).join("\n");
  const { parsed } = await parseStructured({
    model: HAIKU,
    maxTokens: 2500,
    listingId: listing.id,
    kind: "discover",
    tag: "discover-judge",
    system:
      "You decide whether web pages are about one specific rental property. A page is about it if it is the property's own " +
      "page, its listing on a rental site, or its page on its landlord's or management company's website. A page about a " +
      "different building, a neighbouring address, a city or search results page, or a news article is not. Say unsure when " +
      "the page could be it but nothing confirms it. If the page shows a different street address or a differently named " +
      "building, answer no. Keep each reason under 12 words, plain text, no quotes.",
    messages: [{
      role: "user",
      content: `Property: ${listing.title || "(no name)"}, ${cleanAddress(listing.address)}\nManagement email: ${listing.contact_email || "unknown"}\n\nPages:\n${list}`,
    }],
    schema: Verdicts,
  });
  return parsed?.pages ?? [];
}

/*
 * Search one listing and save what was found. Returns counts for the run's
 * report. `dryRun` searches and judges but saves nothing.
 */
export async function discoverListing(listing, { dryRun = false } = {}) {
  const found = new Map(); // url -> candidate
  const add = (c) => {
    const url = canonicalUrl(c.url);
    const kind = classifyUrl(url);
    if (!kind) return;
    const prev = found.get(url);
    if (prev) { prev.foundBy = prev.foundBy.includes(c.foundBy) ? prev.foundBy : `${prev.foundBy}; ${c.foundBy}`; return; }
    found.set(url, { ...c, url, ...kind });
  };

  // What we already know.
  if (listing.source_url) add({ url: listing.source_url, title: "", content: "", foundBy: "imported from", trusted: "The listing was imported from this page" });
  const { data: known } = await supabase.from("listing_sources").select("url").eq("listing_id", listing.id).eq("kind", "page").not("url", "is", null).limit(60);
  for (const k of known ?? []) add({ url: k.url, title: "", content: "", foundBy: "agent reads it", trusted: "The listing's agent already reads this page" });
  for (const u of String(listing.description ?? "").match(URL_RE) ?? []) add({ url: u, title: "", content: "", foundBy: "description link" });

  const domain = companyDomain(listing.contact_email);
  if (domain) {
    add({ url: `https://${domain}/`, title: "", content: "", foundBy: "contact email domain", trusted: `Management company site (contact email @${domain})`, company: true });
  }

  // Searches.
  let searches = 0;
  const errors = [];
  const planned = searchesFor(listing);
  for (const s of planned) {
    try {
      const { results } = await search(s.query, s.domains);
      searches++;
      for (const r of results) add({ ...r, foundBy: s.why });
    } catch (err) {
      errors.push(`${s.why}: ${err.message}`);
    }
  }
  // Every search failing means we learned nothing new: leave the listing
  // unsearched so the next run tries it again.
  if (planned.length && !searches) throw new Error(`searches failed: ${errors[0] ?? "unknown"}`);
  if (searches && !dryRun) {
    await recordUsage({ listingId: listing.id, kind: "discover", costCents: searches * SEARCH_COST_CENTS });
  }

  // Judge.
  const address = cleanAddress(listing.address);
  const name = buildingName(listing.title, listing.address);
  const rows = [];
  const ask = [];
  const trustedHosts = new Set([...found.values()].filter((c) => c.trusted && !c.company).map((c) => hostOf(c.url)));
  for (const c of found.values()) {
    const text = `${c.title} ${c.url} ${c.content}`;
    const host = hostOf(c.url);
    if (c.company) {
      rows.push({ c, site: "company_site", pageType: "home", status: "confirmed", confidence: 0.9, evidence: c.trusted });
      continue;
    }
    const site = c.site;
    if (c.trusted) {
      rows.push({ c, site, pageType: c.pageType, status: "confirmed", confidence: 0.95, evidence: c.trusted });
      continue;
    }
    // A page whose URL or title names another address is about that place,
    // whatever its text mentions (a "similar listings" strip names
    // neighbours; "The Koken on Ohio" is another building).
    let path = "";
    try { path = decodeURIComponent(new URL(c.url).pathname); } catch { /* keep "" */ }
    const elsewhere = (t) => addressesIn(t).length && compareAddress(address, t).level !== "exact";
    if (elsewhere(path) || elsewhere(c.title)) continue;
    // The address in the title or URL says what the page is about; in the
    // text alone it may be a mention, so that waits for review.
    const head = compareAddress(address, `${c.title} ${c.url}`);
    if (head.level === "exact") {
      rows.push({ c, site, pageType: c.pageType, status: "confirmed", confidence: 0.95, evidence: `Shows the address: "${head.seen}"` });
      continue;
    }
    const body = compareAddress(address, c.content);
    // On a site we already trust for this listing, the address anywhere on
    // the page is enough (its own front page, say).
    if (body.level === "exact" && trustedHosts.has(host)) {
      rows.push({ c, site, pageType: c.pageType, status: "confirmed", confidence: 0.9, evidence: `On the listing's own site and mentions the address: "${body.seen}"` });
      continue;
    }
    if (body.level === "exact") {
      rows.push({ c, site, pageType: c.pageType, status: "needs_review", confidence: 0.6, evidence: `Mentions the address in its text: "${body.seen}"` });
      continue;
    }
    if (head.level === "street") continue; // a neighbour
    const named = mentionsName(name, text);
    const onCompanySite = domain && onDomain(host, domain);
    if (named || onCompanySite || c.foundBy === "description link") {
      ask.push({ c, site, why: named ? `Names "${name}"` : onCompanySite ? `On the company's site (@${domain})` : "Linked from the description" });
    }
  }
  if (ask.length) {
    try {
      const verdicts = await judge(listing, ask.map((a) => a.c));
      for (const v of verdicts) {
        const a = ask[v.n - 1];
        if (!a || v.about_this_property === "no") continue;
        rows.push({
          c: a.c, site: a.site, pageType: a.c.pageType, status: "needs_review",
          confidence: v.about_this_property === "yes" ? 0.75 : 0.5,
          evidence: `${a.why}. ${v.reason}`,
        });
      }
    } catch (err) {
      errors.push(`judge: ${err.message}`);
    }
  }

  if (!dryRun) {
    await save(listing.id, rows);
    await ensureAgent(listing.id);
    await supabase.from("listing_agents").update({ sources_searched_at: new Date().toISOString() }).eq("listing_id", listing.id);
  }
  const by = (k) => rows.filter((r) => r.status === k).length;
  return {
    listingId: listing.id,
    searches,
    confirmed: by("confirmed"),
    needsReview: by("needs_review"),
    sites: [...new Set(rows.map((r) => r.site))],
    errors,
    ...(dryRun ? { pages: rows.map((r) => ({ url: r.c.url, site: r.site, pageType: r.pageType, status: r.status, evidence: r.evidence })) } : {}),
  };
}

// Upsert, leaving alone any page the team already reviewed.
async function save(listingId, rows) {
  if (!rows.length) return;
  const { data: reviewed } = await supabase
    .from("listing_found_sources").select("url").eq("listing_id", listingId).not("reviewed_at", "is", null);
  const keep = new Set((reviewed ?? []).map((r) => r.url));
  const now = new Date().toISOString();
  const payload = rows.filter((r) => !keep.has(r.c.url)).map((r) => ({
    listing_id: listingId,
    url: r.c.url,
    site: r.site,
    page_type: r.pageType,
    status: r.status,
    confidence: r.confidence,
    title: (r.c.title || "").slice(0, 300) || null,
    evidence: r.evidence.slice(0, 500),
    found_by: r.c.foundBy.slice(0, 300),
    updated_at: now,
  }));
  if (!payload.length) return;
  const { error } = await supabase.from("listing_found_sources").upsert(payload, { onConflict: "listing_id,url" });
  if (error) throw new Error(`save found sources: ${error.message}`);
}

/*
 * One batch of a run over every published listing (subleases included), the
 * ones never searched first. A serverless call has 300 seconds and a listing
 * takes ~10, so the admin page calls this repeatedly until `remaining` is 0.
 * `redo` searches listings again even if they were searched before.
 */
export async function discoverBatch({ limit = 12, concurrency = 4, redo = false, listingId = null, dryRun = false } = {}) {
  let q = supabase.from("listings")
    .select("id, title, address, city, contact_email, source_url, description")
    .not("published_at", "is", null).is("deleted_at", null)
    .order("created_at", { ascending: true }).limit(10000);
  if (listingId) q = q.eq("id", listingId);
  const { data: listings, error } = await q;
  if (error) throw new Error(`listings: ${error.message}`);

  let todo = listings ?? [];
  if (!redo && !listingId) {
    const { data: done } = await supabase.from("listing_agents").select("listing_id").not("sources_searched_at", "is", null).limit(10000);
    const searched = new Set((done ?? []).map((r) => r.listing_id));
    todo = todo.filter((l) => !searched.has(l.id));
  }
  const batch = todo.slice(0, limit);
  const results = [];
  let next = 0;
  async function worker() {
    while (next < batch.length) {
      const l = batch[next++];
      try {
        results.push(await discoverListing(l, { dryRun }));
      } catch (err) {
        results.push({ listingId: l.id, error: err.message });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, batch.length || 1) }, worker));
  return {
    done: results.filter((r) => !r.error).length,
    errored: results.filter((r) => r.error).length,
    remaining: Math.max(0, todo.length - batch.length),
    total: (listings ?? []).length,
    searches: results.reduce((n, r) => n + (r.searches ?? 0), 0),
    results,
  };
}

/* Counts for the admin view: listings searched, pages by site and status. */
export async function foundSourcesOverview() {
  const [{ count: listings }, { count: searched }, { data: rows }] = await Promise.all([
    supabase.from("listings").select("id", { count: "exact", head: true }).not("published_at", "is", null).is("deleted_at", null),
    supabase.from("listing_agents").select("listing_id", { count: "exact", head: true }).not("sources_searched_at", "is", null),
    supabase.from("listing_found_sources").select("listing_id, site, status").limit(20000),
  ]);
  const bySite = {};
  const withConfirmed = new Set();
  for (const r of rows ?? []) {
    bySite[r.site] ??= { confirmed: 0, needs_review: 0, rejected: 0 };
    bySite[r.site][r.status]++;
    if (r.status === "confirmed") withConfirmed.add(r.listing_id);
  }
  return { listings: listings ?? 0, searched: searched ?? 0, listingsWithConfirmed: withConfirmed.size, bySite };
}

/* Pages waiting for a verdict, with their listing, oldest listing first. */
export async function foundSourcesToReview({ limit = 50 } = {}) {
  const { data, error } = await supabase
    .from("listing_found_sources")
    .select("id, listing_id, url, site, page_type, confidence, title, evidence, found_by, listings!inner(title, address)")
    .eq("status", "needs_review")
    .order("listing_id").order("confidence", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`review list: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id, listingId: r.listing_id, url: r.url, site: r.site, pageType: r.page_type, confidence: r.confidence,
    title: r.title, evidence: r.evidence, foundBy: r.found_by,
    listing: r.listings?.title || cleanAddress(r.listings?.address),
    address: cleanAddress(r.listings?.address),
  }));
}

export async function reviewFoundSource({ id, accept, userId }) {
  const { error } = await supabase.from("listing_found_sources")
    .update({ status: accept ? "confirmed" : "rejected", reviewed_by: userId, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}
