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

const IMG_JUNK = /logo|icon|favicon|sprite|badge|avatar|arrow|pixel|tracking|placeholder|\.svg(\?|$)/i;

// Candidate property photos: [{ url, alt }], deduped, junk-filtered, capped.
export function extractImageCandidates(html, baseUrl, cap = 40) {
  const seen = new Set();
  const out = [];
  const tags = html.match(/<img[^>]+>/gi) ?? [];
  for (const tag of tags) {
    const src =
      tag.match(/\bdata-src="([^"]+)"/i)?.[1] ??
      tag.match(/\bsrc="([^"]+)"/i)?.[1];
    if (!src || src.startsWith("data:")) continue;
    let abs;
    try {
      abs = new URL(decodeEntities(src), baseUrl).toString();
    } catch {
      continue;
    }
    if (!abs.startsWith("http")) continue;
    if (IMG_JUNK.test(abs)) continue;
    abs = normalizeImageUrl(abs);
    if (seen.has(abs)) continue;
    seen.add(abs);
    const alt = decodeEntities(tag.match(/\balt="([^"]*)"/i)?.[1] ?? "");
    if (IMG_JUNK.test(alt)) continue;
    out.push({ url: abs, alt });
    if (out.length >= cap) break;
  }
  return out;
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

// AppFolio-hosted pages render empty without JS — those landlords belong on the
// PMS sync instead. Detect both a pasted appfolio URL and a site whose HTML
// links out to one (extractLinks drops off-site links, so scan the raw HTML).
export function detectAppfolio(url, html = "") {
  try {
    if (new URL(url).hostname.endsWith(".appfolio.com")) return true;
  } catch {
    /* fall through to the html scan */
  }
  return /https?:\/\/[a-z0-9-]+\.appfolio\.com/i.test(html);
}
