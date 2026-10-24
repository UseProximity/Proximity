/*
 * A Zillow listing's own photos.
 *
 * The rendered page shows five of the listing's photos and, around them,
 * "nearby" and "similar" homes, each with its own photo, plus the agent's
 * headshot. Read as one pool of images, a 6829 Kingsbury import came back
 * with LOCAL on Delmar, 733 Heman and 757 Syracuse in its gallery.
 *
 * The page's script data carries the listing's whole gallery as
 * "responsivePhotos" (21 for 6829 Kingsbury), each in several sizes. That
 * list, at its largest JPEG, is the photo pool for a Zillow page.
 */
export const ZILLOW_HOST_RE = /(^|\.)zillow\.com$/i;

function arrayAfter(text, key) {
  const at = text.indexOf(key);
  if (at < 0) return null;
  const start = text.indexOf("[", at);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/* The listing's photos, largest JPEG of each, in the site's order; [] when absent. */
export function parseZillowGallery(rawHtml) {
  if (!rawHtml || !rawHtml.includes("responsivePhotos")) return [];
  // The data sits in a JSON string inside a script, escaped once or twice.
  let text = rawHtml;
  for (let i = 0; i < 2 && !/"responsivePhotos":\[/.test(text); i++) text = text.replace(/\\"/g, '"').replace(/\\\//g, "/").replace(/\\\\/g, "\\");
  const photos = arrayAfter(text, '"responsivePhotos"') ?? [];
  const out = [];
  for (const p of photos) {
    const jpegs = (p?.mixedSources?.jpeg ?? []).filter((s) => typeof s?.url === "string");
    const best = jpegs.sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? p?.url;
    if (typeof best === "string" && /^https?:\/\/photos\.zillowstatic\.com\//.test(best) && !out.includes(best)) out.push(best);
  }
  return out;
}
