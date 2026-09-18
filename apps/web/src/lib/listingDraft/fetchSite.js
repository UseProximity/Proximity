/*
 * SSRF-safe fetching + HTML stripping for the paste-your-website listing draft.
 *
 * Fetches only what the landlord pasted (plus, optionally, a couple of same-site
 * pages the caller explicitly resolves): every hostname is DNS-resolved and
 * rejected if any address is private/internal, redirects are re-validated hop by
 * hop, and bodies are size-capped. No JS rendering — we read what the server
 * sends, which Phase 0 showed is enough for most local landlord sites.
 */
import dns from "node:dns/promises";
import net from "node:net";

export const FETCH_UA = "ProximityListingBot/1.0 (+https://useproximity.org)";
const MAX_BYTES = 2 * 1024 * 1024; // 2MB per page
const MAX_REDIRECTS = 4;
const TIMEOUT_MS = 15000;

// ---------------------------------------------------------------------------
// SSRF guard
// ---------------------------------------------------------------------------

function ipv4ToInt(ip) {
  const parts = ip.split(".").map(Number);
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

const PRIVATE_V4_RANGES = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local incl. cloud metadata 169.254.169.254
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
];

function isPrivateIpv4(ip) {
  const n = ipv4ToInt(ip);
  return PRIVATE_V4_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (ipv4ToInt(base) & mask);
  });
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) return isPrivateIpv4(ip);
  const lower = ip.toLowerCase();
  // IPv4-mapped IPv6 (::ffff:1.2.3.4)
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fe80:")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA fc00::/7
  return false;
}

// Throws on anything that must not be fetched. Returns silently when safe.
async function assertSafeUrl(url) {
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new DraftFetchError("unsupported_scheme");
  }
  const host = url.hostname;
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new DraftFetchError("private_address");
    return;
  }
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new DraftFetchError("private_address");
  }
  let addresses;
  try {
    addresses = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new DraftFetchError("dns_failed");
  }
  if (!addresses.length || addresses.some((a) => isPrivateIp(a.address))) {
    throw new DraftFetchError("private_address");
  }
}

export class DraftFetchError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

async function readBodyCapped(res, maxBytes) {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      reader.cancel().catch(() => {});
      break; // keep what we have — a truncated page still extracts fine
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/*
 * Same idea for a binary asset, with one difference: a truncated page still
 * extracts fine, but a truncated image is garbage. So this refuses instead of
 * salvaging — it returns null once the cap is passed and the caller answers
 * 413. Reading the stream is the point: buffering the whole response first and
 * measuring afterwards means the cap protects nothing.
 */
export async function readAssetCapped(res, maxBytes) {
  const reader = res.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/*
 * Fetch one page with manual redirect handling so every hop is re-validated.
 * Returns { html, finalUrl } or throws DraftFetchError
 * (codes: unsupported_scheme, private_address, dns_failed, timeout, blocked, http_<status>).
 */
export async function fetchPage(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new DraftFetchError("bad_url");
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertSafeUrl(url);
    let res;
    try {
      res = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          "User-Agent": FETCH_UA,
          Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.8",
        },
      });
    } catch (err) {
      throw new DraftFetchError(err?.name === "TimeoutError" ? "timeout" : "unreachable");
    }

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get("location");
      res.body?.cancel?.().catch?.(() => {});
      if (!loc || hop === MAX_REDIRECTS) throw new DraftFetchError("too_many_redirects");
      url = new URL(loc, url); // relative or absolute — next loop re-validates
      continue;
    }
    if (res.status === 403 || res.status === 429) throw new DraftFetchError("blocked");
    if (!res.ok) throw new DraftFetchError(`http_${res.status}`);

    const html = await readBodyCapped(res, MAX_BYTES);
    return { html, finalUrl: url.toString() };
  }
  throw new DraftFetchError("too_many_redirects");
}

/*
 * Fetch a non-HTML asset (property photo) with the same SSRF guard. Returns the
 * Response so the caller can stream it; caller must enforce content-type/size.
 * Assets get a longer timeout than pages: full-size property photos off slow
 * CDNs regularly exceed 15s, which silently dropped imported photos.
 */
const ASSET_TIMEOUT_MS = 45000;

export async function fetchAssetResponse(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new DraftFetchError("bad_url");
  }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertSafeUrl(url);
    let res;
    try {
      res = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(ASSET_TIMEOUT_MS),
        headers: { "User-Agent": FETCH_UA, Accept: "image/*,*/*;q=0.5" },
      });
    } catch (err) {
      throw new DraftFetchError(err?.name === "TimeoutError" ? "timeout" : "unreachable");
    }
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get("location");
      res.body?.cancel?.().catch?.(() => {});
      if (!loc || hop === MAX_REDIRECTS) throw new DraftFetchError("too_many_redirects");
      url = new URL(loc, url);
      continue;
    }
    if (!res.ok) throw new DraftFetchError(`http_${res.status}`);
    return res;
  }
  throw new DraftFetchError("too_many_redirects");
}

// ---------------------------------------------------------------------------
// HTML → extraction inputs
// ---------------------------------------------------------------------------

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ndash: "-", mdash: "-", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"',
};

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

// Visible text only: scripts, styles, svg, comments and tags stripped.
export function htmlToText(html) {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|iframe)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  return s.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

// Wix serves thumbnails via URL transformations; the bare media URL is the
// original. Rewrite so imported photos aren't 56px blurred previews.
// Shopify is the opposite problem: bare URLs are multi-MB originals that time
// out the proxy — ask its CDN for a 1600px rendition (we recompress anyway).
function normalizeImageUrl(u) {
  const wix = u.match(/^(https:\/\/static\.wixstatic\.com\/media\/[^/]+)\/v1\//);
  if (wix) return wix[1];
  if (/(cdn\.shopify\.com|\/cdn\/shop\/)/.test(u) && !/[?&]width=/.test(u)) {
    return u + (u.includes("?") ? "&" : "?") + "width=1600";
  }
  return u;
}

const IMG_JUNK =
  /logo|icon|favicon|sprite|badge|avatar|arrow|pixel|tracking|placeholder|blank|spacer|\.svg(\?|$)/i;

/*
 * Candidate property photos: [{ url, alt }], deduped, junk-filtered, capped.
 * Sites (Wix especially) often render galleries with JS, so <img> tags alone
 * miss most photos — mine three sources in falling order of context quality:
 *   1. <img> tags (src/data-src, with alt text)
 *   2. og:image / twitter:image metas (the site's own pick for a cover)
 *   3. raw image URLs anywhere in the HTML — catches gallery data embedded in
 *      inline JSON (Wix warmupData, WP sliders) that never reaches an <img>.
 */
export function extractImageCandidates(html, baseUrl, cap = 40) {
  const seen = new Set();
  const out = [];
  const push = (rawSrc, alt = "") => {
    if (out.length >= cap || !rawSrc || rawSrc.startsWith("data:")) return;
    let abs;
    try {
      abs = new URL(decodeEntities(rawSrc), baseUrl).toString();
    } catch {
      return;
    }
    if (!abs.startsWith("http")) return;
    if (IMG_JUNK.test(abs) || IMG_JUNK.test(alt)) return;
    abs = normalizeImageUrl(abs);
    if (seen.has(abs)) return;
    seen.add(abs);
    out.push({ url: abs, alt });
  };

  for (const tag of html.match(/<img[^>]+>/gi) ?? []) {
    push(
      tag.match(/\bdata-src="([^"]+)"/i)?.[1] ?? tag.match(/\bsrc="([^"]+)"/i)?.[1],
      decodeEntities(tag.match(/\balt="([^"]*)"/i)?.[1] ?? "")
    );
  }
  for (const meta of html.match(
    /<meta[^>]+(?:property|name)="(?:og:image|twitter:image)"[^>]+>/gi
  ) ?? []) {
    push(meta.match(/\bcontent="([^"]+)"/i)?.[1], "site cover image");
  }
  for (const m of html.matchAll(
    /https?:\/\/[^\s"'<>\\()]+?\.(?:jpe?g|png|webp)(?=[\s"'<>\\)?]|$)/gi
  )) {
    push(m[0], "");
  }
  return out;
}

// JSON-LD structured data (schema.org) — WordPress/agency sites often carry the
// address, images, and offers here even when the visible text doesn't.
export function extractJsonLd(html, cap = 6000) {
  const blocks =
    html.match(
      /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
    ) ?? [];
  return blocks
    .map((b) => b.replace(/<[^>]+>/g, "").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, cap);
}

/*
 * Optional headless-render fallbacks, tried in order for URLs that already
 * passed the SSRF checks in fetchPage. Each is a no-op without its key and
 * fails soft (null) on any error, including exhausted free credits, so the
 * import degrades to whatever the plain fetch got instead of breaking.
 * Order: Firecrawl (best anti-bot) -> Jina Reader -> Tavily Extract
 * (renewing monthly free tier, returns text + images, wrapped as pseudo-HTML).
 */
async function renderPageViaFirecrawl(rawUrl, waitMs = 0) {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      // onlyMainContent defaults to true, which strips header/nav/footer. That
      // is where a management company keeps the link to its actual inventory
      // ("Search Apartments", the per-city pages), so a corporate site came
      // back as its homepage teaser with no way to reach the other 116
      // properties. We need the whole document, chrome included.
      body: JSON.stringify({
        url: rawUrl,
        formats: ["html"],
        onlyMainContent: false,
        ...(waitMs ? { waitFor: waitMs } : {}),
        timeout: waitMs ? 45000 : 30000,
      }),
      signal: AbortSignal.timeout(waitMs ? 70000 : 45000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const html = data?.data?.html;
    if (typeof html !== "string" || !html) return null;
    return {
      html: html.slice(0, MAX_BYTES * 2),
      finalUrl: data?.data?.metadata?.url || rawUrl,
    };
  } catch {
    return null;
  }
}

async function renderPageViaJina(rawUrl) {
  // JINA_API_KEY is the name people reach for (and the one the PR notes gave
  // out); accept it too so a mis-set key degrades to "wrong name, still works"
  // rather than a render fallback that silently never runs.
  const key = process.env.JINA_READER_KEY || process.env.JINA_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`https://r.jina.ai/${rawUrl}`, {
      headers: {
        Authorization: `Bearer ${key}`,
        "X-Return-Format": "html",
        "X-Engine": "browser",
      },
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    if (!html) return null;
    return { html: html.slice(0, MAX_BYTES * 2), finalUrl: rawUrl };
  } catch {
    return null;
  }
}

async function renderPageViaTavily(rawUrl) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api.tavily.com/extract", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ urls: rawUrl, include_images: true, extract_depth: "advanced" }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const r = data?.results?.[0];
    if (!r?.raw_content) return null;
    // Tavily returns markdown text + an image URL list, not HTML — wrap it so
    // the downstream text/image extraction sees a normal page shape.
    const imgs = (r.images ?? [])
      .slice(0, 40)
      .map((u) => `<img src="${String(u).replace(/"/g, "")}" alt="">`)
      .join("\n");
    const html = `<html><body><div>${r.raw_content}</div>\n${imgs}</body></html>`;
    return { html: html.slice(0, MAX_BYTES * 2), finalUrl: rawUrl };
  } catch {
    return null;
  }
}

const RENDER_FALLBACKS = [renderPageViaFirecrawl, renderPageViaJina, renderPageViaTavily];

/*
 * The render chain is scored on stripped-text length, which quietly punishes
 * the sources that preserve structure. Tavily returns raw markdown wrapped in a
 * single <div>: on macapartments.com that scored 4,703 characters against
 * Firecrawl's 1,638, so the markdown blob won and extractLinks() came back with
 * ZERO links, leaving the model no site navigation to offer as area folders.
 *
 * So the winner still supplies the text, but whichever candidate actually
 * carried anchors supplies the links and images. When they are the same
 * response (the normal case) nothing changes.
 */
const anchorCount = (html) => (html ? (html.match(/<a\b[^>]*\bhref=/gi) ?? []).length : 0);

function withLinkHtml(page, structured) {
  if (!page || !structured || structured === page) return page;
  if (anchorCount(structured.html) <= anchorCount(page.html)) return page;
  return { ...page, linkHtml: structured.html };
}

/*
 * One render that deliberately waits for the page's own scripts to finish.
 *
 * Used for widget-driven availability (SightMap on RealPage sites): the plain
 * render of metroflatsstl.com's floor-plans page is 32KB and never mentions the
 * widget, while the same page given nine seconds is 722KB and carries the embed
 * token we need. Far too slow to do on every import, so the route only reaches
 * for it when the page looks like one of those.
 */
export async function renderPageWaited(rawUrl, waitMs = 9000) {
  let url;
  try {
    url = new URL(rawUrl);
    await assertSafeUrl(url);
  } catch {
    return null;
  }
  return renderPageViaFirecrawl(rawUrl, waitMs);
}

// Run the render chain directly (SSRF-checked first) and return the best
// result, or null. Used when a page passed the thin check but its listings
// clearly live in a JS widget (PMS portal detected, little real content).
export async function tryRenderPage(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  try {
    await assertSafeUrl(url);
  } catch {
    return null;
  }
  let best = null;
  let bestLen = 0;
  let structured = null;
  for (const render of RENDER_FALLBACKS) {
    const rendered = await render(rawUrl);
    const len = rendered ? htmlToText(rendered.html).length : 0;
    if (anchorCount(rendered?.html) > anchorCount(structured?.html)) structured = rendered;
    if (len > bestLen) {
      best = rendered;
      bestLen = len;
    }
    if (bestLen >= 3000) break;
  }
  return withLinkHtml(best, structured);
}

// Codes where a render service can't help (or must not be asked to try).
const NO_RENDER_CODES = new Set(["bad_url", "unsupported_scheme", "private_address", "dns_failed"]);

// 10-minute page cache so the pick-a-property second request (and background
// queue prefetches) don't re-download pages this instance just fetched.
// Per-instance and best-effort, like the rate limiter.
const PAGE_CACHE_TTL_MS = 10 * 60 * 1000;
const PAGE_CACHE_MAX = 40;
const _pageCache = new Map(); // url -> { at, page }

function cachePut(url, page) {
  if (_pageCache.size >= PAGE_CACHE_MAX) {
    const oldest = [..._pageCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) _pageCache.delete(oldest[0]);
  }
  _pageCache.set(url, { at: Date.now(), page });
}

/*
 * The route's one entry point: cached plain fetch, upgraded to a Firecrawl
 * render when the plain fetch was blocked or came back thin (JS-rendered site)
 * and a key is configured. Throws DraftFetchError like fetchPage.
 */
export async function fetchPageSmart(rawUrl) {
  const hit = _pageCache.get(rawUrl);
  if (hit && Date.now() - hit.at < PAGE_CACHE_TTL_MS) return hit.page;

  let page = null;
  let fetchErr = null;
  try {
    page = await fetchPage(rawUrl);
  } catch (err) {
    if (!(err instanceof DraftFetchError) || NO_RENDER_CODES.has(err.code)) throw err;
    fetchErr = err;
  }

  let bestLen = page ? htmlToText(page.html).length : 0;
  let structured = anchorCount(page?.html) ? page : null;
  if (bestLen < 800) {
    for (const render of RENDER_FALLBACKS) {
      const rendered = await render(rawUrl);
      const len = rendered ? htmlToText(rendered.html).length : 0;
      if (anchorCount(rendered?.html) > anchorCount(structured?.html)) structured = rendered;
      if (len > bestLen) {
        page = rendered;
        bestLen = len;
      }
      if (bestLen >= 800) break; // good enough — stop spending credits
    }
  }
  /*
   * One retry before giving up.
   *
   * A transient timeout, or a render service rate-limiting under a burst,
   * surfaced to the landlord as "we couldn't reach that page", which reads as
   * permanent and is where they stop. Both sites that failed this way in the
   * 34-site audit (apartments.com under a batch, a Wix page mid-run) succeeded
   * on the very next attempt.
   */
  if (!page && fetchErr && !NO_RENDER_CODES.has(fetchErr.code)) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      page = await fetchPage(rawUrl);
    } catch {
      for (const render of RENDER_FALLBACKS) {
        const rendered = await render(rawUrl);
        if (rendered && htmlToText(rendered.html).length > 200) {
          page = rendered;
          break;
        }
      }
    }
  }
  if (!page) throw fetchErr ?? new DraftFetchError("unreachable");
  page = withLinkHtml(page, structured);
  cachePut(rawUrl, page);
  return page;
}

// The site's brand/company name (og:site_name, else the tail of <title>), so
// extraction can be told BY NAME never to mention the management company —
// a named ban sticks far better than a generic one, and the sanitizer scrubs
// any survivors. Null when undetectable; imperfect guesses are harmless.
export function extractSiteBrand(html) {
  const og =
    html.match(/property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i)?.[1] ??
    html.match(/content=["']([^"']+)["'][^>]*property=["']og:site_name["']/i)?.[1];
  if (og) return decodeEntities(og).trim().slice(0, 60) || null;
  const t = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
  if (t) {
    const parts = decodeEntities(t)
      .split(/\s*[|]\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length > 1) return parts[parts.length - 1].slice(0, 60) || null;
  }
  return null;
}

// Registrable-domain match (naive last-two-labels compare — fine for the
// .com/.org/.net landlord sites this feature targets).
export function sameSite(a, b) {
  try {
    const tail = (h) => h.split(".").slice(-2).join(".");
    return tail(new URL(a).hostname) === tail(new URL(b).hostname);
  } catch {
    return false;
  }
}

/*
 * Analytics/click-tracking parameters, dropped so the same destination doesn't
 * appear as several links. Everything else in the query string is KEPT: on a
 * RentCafe or Entrata corporate site the area filter IS a query parameter
 * (/searchlisting?citystate=st.%20louis,mo), so chopping at "?" collapsed every
 * city down to one undifferentiated search page and made area folders
 * impossible for exactly the big multi-city companies that need them.
 */
const TRACKING_PARAMS =
  /^(utm_|rcstdid$|gclid$|fbclid$|msclkid$|mkt_tok$|_ga$|_gl$|ref$|source$|yclid$|igshid$)/i;

// Canonical form for comparing two links: tracking params dropped, fragment
// dropped, trailing slash and default port normalized, host lowercased.
export function normalizeLinkUrl(raw, baseUrl) {
  let u;
  try {
    u = new URL(decodeEntities(raw), baseUrl);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(u.protocol)) return null;
  u.hash = "";
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
  }
  u.hostname = u.hostname.toLowerCase();
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
    u.pathname = u.pathname.replace(/\/+$/, "");
  }
  return u.toString();
}

// The hostname, lowercased. Throws on anything that is not a URL, which every
// caller here treats as "not a link we can use".
export function hostOf(url) {
  return new URL(url).hostname.toLowerCase();
}

/*
 * The property's OWN website, linked from a management company's page about it.
 *
 * Mac gives each building its own domain and links straight to it, so picking a
 * building from the list already landed us on the building's site. Keeley links
 * to its own summary page first — "Lofts at Euclid" on keeleyproperties.com,
 * three thousand characters of blurb, a price range, and no floor plans,
 * because the floor plans are on loftsateuclid.com. The drill looked for a
 * same-site floor-plans link, found none, and the landlord got a property with
 * nothing under it. Every property in their portfolio is built this way.
 *
 * The host has to echo the property's name, which is what makes this safe:
 * these pages also link to the company's sibling businesses, the web designer
 * who built the site, and a resident login portal, and none of those are the
 * property. "Lofts at Euclid" matches loftsateuclid.com, "The Koken" matches
 * kokenliving.com, "Citizen Park" matches livecitizenpark.com. Words too short
 * or too common to identify anything are not allowed to make the match.
 */
const OWN_SITE_NOISE_RE =
  /facebook|instagram|linkedin|twitter|x\.com|youtube|tiktok|pinterest|yelp|google|maps|apple|goo\.gl|bit\.ly|securecafe|rentcafe|appfolio|buildium|entrata|realpage|yardi|resident|portal|payment|policy|privacy|terms|accessibility|wordpress|squarespace|wix|godaddy|brindle|design|agency|construction|restoration/i;

const NAME_STOPWORDS = new Set([
  "the", "at", "on", "of", "and", "a", "an", "in", "apartments", "apartment",
  "residences", "residence", "living", "lofts", "loft", "place", "properties",
  "property", "homes", "home", "house", "flats", "suites", "towers", "tower",
  "llc", "inc", "co", "company", "group", "management", "realty",
]);

export function findPropertyOwnSite(html, pageUrl, propertyName) {
  const name = String(propertyName ?? "").toLowerCase();
  if (!name.trim()) return null;
  let pageHost;
  try {
    pageHost = hostOf(pageUrl);
  } catch {
    return null;
  }
  const condensed = name.replace(/[^a-z0-9]/g, "");
  const words = name
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 5 && !NAME_STOPWORDS.has(w));

  for (const link of extractAllLinks(html, pageUrl, 300)) {
    if (link.internal) continue;
    if (OWN_SITE_NOISE_RE.test(link.url)) continue;
    let host;
    try {
      host = hostOf(link.url);
    } catch {
      continue;
    }
    if (!host || host === pageHost) continue;
    // Compare the bare name: no www, no dots, no top-level domain.
    const bare = host.replace(/^www\./, "").replace(/\.[a-z.]+$/, "").replace(/[^a-z0-9]/g, "");
    if (!bare) continue;
    if (
      (condensed.length >= 5 && (bare.includes(condensed) || condensed.includes(bare))) ||
      words.some((w) => bare.includes(w))
    ) {
      return link.url;
    }
  }
  return null;
}

const LINK_ASSET_RE = /\.(css|js|xml|pdf|jpe?g|png|webp|gif|svg|ico|zip|docx?)(\?|$)/i;

// Destinations that are never a property page. Worth dropping explicitly: every
// property card on a RentCafe site carries a "get directions" link, so these
// otherwise took half the candidate-link budget and taught the model nothing.
const LINK_NOISE_RE =
  /^https?:\/\/([a-z0-9-]+\.)*(maps\.google\.[a-z.]+|google\.[a-z.]+\/maps|facebook\.com|twitter\.com|x\.com|instagram\.com|linkedin\.com|youtube\.com|youtu\.be|tiktok\.com|pinterest\.com|yelp\.com)\//i;

/*
 * Every link on the page: [{ url, text, internal }], deduped and asset-filtered.
 * Cross-site links are kept here (a management company routinely gives each
 * building its own domain) — callers that only want same-site links filter on
 * `internal`.
 */
export function extractAllLinks(html, baseUrl, cap = 120) {
  const seen = new Set();
  const out = [];
  const re = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const base = normalizeLinkUrl(baseUrl, baseUrl);
  let m;
  while ((m = re.exec(html)) && out.length < cap) {
    const abs = normalizeLinkUrl(m[1], baseUrl);
    if (!abs || abs === base) continue; // in-page anchors resolve to the page
    if (LINK_ASSET_RE.test(abs) || LINK_NOISE_RE.test(abs)) continue;
    if (seen.has(abs)) continue;
    seen.add(abs);
    const text = htmlToText(m[2]).replace(/\n/g, " ").slice(0, 80).trim();
    out.push({ url: abs, text, internal: sameSite(abs, baseUrl) });
  }
  return out;
}

// Same-site links: [{ url, text }] for the model to name property subpages.
export function extractLinks(html, baseUrl, cap = 40) {
  return extractAllLinks(html, baseUrl, cap * 4)
    .filter((l) => l.internal)
    .slice(0, cap)
    .map(({ url, text }) => ({ url, text }));
}

/*
 * PMS-hosted listing portals render empty without JS. Detect which system a
 * pasted URL or a site's HTML points at so the UI can react: the four systems
 * Proximity syncs with get steered to the integration; the rest get an honest
 * "your listings live in <system>" message instead of a generic failure.
 */
const PMS_PORTALS = [
  { name: "appfolio", host: /(^|\.)appfolio\.com$/i, scan: /https?:\/\/[a-z0-9-]+\.appfolio\.com/i },
  { name: "buildium", host: /(^|\.)managebuilding\.com$/i, scan: /https?:\/\/[a-z0-9-]+\.managebuilding\.com/i },
  { name: "rentecdirect", host: /(^|\.)rentecdirect\.com$/i, scan: /https?:\/\/[a-z0-9-]+\.rentecdirect\.com/i },
  { name: "doorloop", host: /(^|\.)doorloop\.com$/i, scan: /https?:\/\/app\.doorloop\.com/i },
  { name: "propertyware", host: /(^|\.)propertyware\.com$/i, scan: /https?:\/\/[a-z0-9.-]*propertyware\.com/i },
  { name: "showmojo", host: /(^|\.)showmojo\.com$/i, scan: /https?:\/\/showmojo\.com/i },
  { name: "rentcafe", host: /(^|\.)(rentcafe|securecafe)\.com$/i, scan: /https?:\/\/[a-z0-9.-]*(rentcafe|securecafe)\.com/i },
];

/*
 * Listing portals. A page on one of these describes exactly ONE property, and
 * every other property-looking link on it is a competitor from the portal's own
 * "nearby listings" rail.
 *
 * Pasting apartments.com/5316-pershing-ave returned a picker of FORTY buildings
 * (Avenir, SoHo, Clayton on the Park, Coronado Place and Towers), each with a
 * working apartments.com URL, so a landlord importing their own listing could
 * publish a competitor's building on Proximity. On these hosts we take the one
 * listing and never offer a picker.
 */
const LISTING_PORTALS =
  /(^|\.)(apartments\.com|zillow\.com|trulia\.com|hotpads\.com|forrent\.com|forrentuniversity\.com|rent\.com|apartmentlist\.com|padmapper\.com|zumper\.com|realtor\.com|showmetherent\.com|apartmentfinder\.com|apartmentguide\.com)$|(^|\.)wustl\.edu$/i;

export function isListingPortal(url) {
  try {
    return LISTING_PORTALS.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

// Systems the existing PMS sync supports — worth steering to instead.
export const SYNCABLE_PMS = new Set(["appfolio", "buildium", "rentecdirect", "doorloop"]);

// Returns the portal name, or null. Host match (pasted portal URL) wins; the
// html scan catches marketing sites that link out to their portal.
export function detectPmsPortal(url, html = "") {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    /* html scan below */
  }
  for (const p of PMS_PORTALS) {
    if (host && p.host.test(host)) return p.name;
  }
  for (const p of PMS_PORTALS) {
    if (html && p.scan.test(html)) return p.name;
  }
  return null;
}
