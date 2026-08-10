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
 */
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
        signal: AbortSignal.timeout(TIMEOUT_MS),
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
function normalizeImageUrl(u) {
  const wix = u.match(/^(https:\/\/static\.wixstatic\.com\/media\/[^/]+)\/v1\//);
  if (wix) return wix[1];
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
 * Optional headless-render fallback via Firecrawl (FIRECRAWL_API_KEY). Rescues
 * JS-rendered galleries/pricing and bot-blocked sites; a no-op without the key.
 * Only called for URLs that already passed the SSRF checks in fetchPage.
 */
async function renderPageViaFirecrawl(rawUrl) {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url: rawUrl, formats: ["html"], timeout: 30000 }),
      signal: AbortSignal.timeout(45000),
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

  const thin = page ? htmlToText(page.html).length < 800 : true;
  if (thin) {
    const rendered = await renderPageViaFirecrawl(rawUrl);
    if (
      rendered &&
      htmlToText(rendered.html).length > (page ? htmlToText(page.html).length : 0)
    ) {
      page = rendered;
    }
  }
  if (!page) throw fetchErr ?? new DraftFetchError("unreachable");
  cachePut(rawUrl, page);
  return page;
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

// Same-site links: [{ url, text }] for the model to name property subpages.
export function extractLinks(html, baseUrl, cap = 60) {
  const seen = new Set();
  const out = [];
  const re = /<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < cap) {
    let abs;
    try {
      abs = new URL(decodeEntities(m[1]), baseUrl).toString();
    } catch {
      continue;
    }
    if (!abs.startsWith("http") || !sameSite(abs, baseUrl)) continue;
    if (/\.(css|js|xml|pdf|jpg|jpeg|png|webp|ico)(\?|$)/i.test(abs)) continue;
    abs = abs.split("?")[0];
    if (seen.has(abs)) continue;
    seen.add(abs);
    const text = htmlToText(m[2]).replace(/\n/g, " ").slice(0, 80).trim();
    out.push({ url: abs, text });
  }
  return out;
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
