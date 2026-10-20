/*
 * A company's property list embedded as JSON in a page.
 *
 * Mac Properties' search page (macapartments.com/search) ships every building
 * in the portfolio inside its script data: name, street address, city, zip,
 * coordinates, the building's path on the site and its own website when it
 * has one. The homepage shows three of them and a "Search Apartments" link.
 * Asking a model to read the rendered search page gave names with no
 * addresses, and the picker decides "near WashU" from the address, so every
 * St. Louis building but one was filed as far away.
 *
 * Read the JSON instead. Same brace-matching as rentcafeEmbedded.js, keyed on
 * the fields these objects carry.
 */
import { normalizeLinkUrl } from "@/lib/listingDraft/fetchSite";

export const EMBEDDED_PROPERTIES_HINT_RE = /\\?"propertyName\\?"\s*:\s*\\?"[^"]/;

const WASHU = { lat: 38.6488, lng: -90.3108 };

function unescapeJs(s) {
  return s
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\\//g, "/")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function objectsContaining(text, needle, cap = 400) {
  const out = [];
  let from = 0;
  while (out.length < cap) {
    const at = text.indexOf(needle, from);
    if (at < 0) break;
    let depth = 0;
    let start = -1;
    for (let i = at; i >= 0; i--) {
      const ch = text[i];
      if (ch === "}") depth++;
      else if (ch === "{") {
        if (depth === 0) {
          start = i;
          break;
        }
        depth--;
      }
    }
    if (start < 0) {
      from = at + needle.length;
      continue;
    }
    depth = 0;
    let end = -1;
    let inStr = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (ch === "\\") i++;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end < 0) break;
    try {
      out.push(JSON.parse(text.slice(start, end)));
    } catch {
      /* skip */
    }
    from = end;
  }
  return out;
}

export function distanceKm(lat, lng, to = WASHU) {
  const r = (d) => (d * Math.PI) / 180;
  const a = Math.sin(r(to.lat - lat) / 2) ** 2 + Math.cos(r(lat)) * Math.cos(r(to.lat)) * Math.sin(r(to.lng - lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

/*
 * Returns picker rows [{ name, address, url, kind, distanceKm }] sorted
 * nearest-to-campus first, or null when the page carries no such list.
 */
export function parseEmbeddedProperties(html, baseUrl) {
  if (!html || !EMBEDDED_PROPERTIES_HINT_RE.test(html)) return null;
  const text = unescapeJs(html);
  const rows = objectsContaining(text, '"propertyName"').filter((o) => typeof o.propertyName === "string" && (o.address || o.city));
  if (!rows.length) return null;
  const seen = new Set();
  const out = [];
  for (const o of rows) {
    const name = o.propertyName.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    const address = [o.address, [o.city, o.state].filter(Boolean).join(", "), o.zipCode ?? o.zip ?? o.postalCode]
      .map((x) => String(x ?? "").trim())
      .filter(Boolean)
      .join(", ");
    const own = typeof o.externalWebsiteUrl === "string" && /^https?:/.test(o.externalWebsiteUrl) ? o.externalWebsiteUrl : null;
    const path = typeof o.publicPath === "string" ? normalizeLinkUrl(o.publicPath, baseUrl) : null;
    const lat = Number(o.latitude);
    const lng = Number(o.longitude);
    const dist = Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 ? distanceKm(lat, lng) : null;
    out.push({ name, address, url: own ?? path ?? "", kind: "property", distanceKm: dist == null ? null : Math.round(dist * 10) / 10 });
  }
  if (!out.length) return null;
  out.sort((a, b) => (a.distanceKm ?? 9e9) - (b.distanceKm ?? 9e9) || a.name.localeCompare(b.name));
  return out;
}
