/*
 * Per-apartment availability and pricing, read from a building's own floor-plan
 * pages.
 *
 * A floor plan is not an apartment. One Hundred Above the Park publishes plan
 * 100N101A with two apartments behind it, #1501 at $3,080 and #2701 at $3,095,
 * both available now; plan 100N101C has #1301 free on 9 November and #901 not
 * until 7 January, at different rents again. Reading only the floor-plans index
 * gets a plan name and one "starting at" price, and throws away which
 * apartments exist, when each is free and what each costs. For a marketplace
 * that syncs availability back on a timer, that is the data.
 *
 * None of it needs a private API. Each plan has an ordinary page, one level
 * below the floor-plans index, and the apartments are in its text:
 *
 *     Apartment: # 1301
 *     Date Available: 11/9/2026
 *     Starting at: $2,945.00
 *
 * So: find the index's child pages, read them, and parse the blocks. The shape
 * above is RentCafe's, which is most of the student-housing market, and the
 * parser is loose enough to survive the wording drifting a little.
 *
 * These pages are usually bot-blocked (liveat100.com answers our plain fetch
 * with a 403), so each one costs a render. That is why this is capped and only
 * runs for a single property the landlord has already committed to.
 */
import { fetchPageSmart, htmlToText, extractAllLinks, sameSite } from "./fetchSite.js";

const MAX_PLANS = 12;
const CONCURRENCY = 3;

/*
 * Pages one level below the floor-plans index on the same site.
 * /floorplans -> /floorplans/100n101a, and nothing shallower or sideways.
 */
export function findFloorPlanPages(html, indexUrl, cap = MAX_PLANS) {
  let basePath;
  try {
    basePath = new URL(indexUrl).pathname.replace(/\/+$/, "");
  } catch {
    return [];
  }
  if (!basePath || basePath === "/") return [];
  const out = [];
  const seen = new Set();
  for (const l of extractAllLinks(html, indexUrl, 300)) {
    if (!l.internal || !sameSite(l.url, indexUrl)) continue;
    let path;
    try {
      path = new URL(l.url).pathname.replace(/\/+$/, "");
    } catch {
      continue;
    }
    if (!path.startsWith(`${basePath}/`)) continue;
    // exactly one segment deeper, and not an anchor back to the index
    if (path.slice(basePath.length + 1).includes("/")) continue;
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(l.url);
    if (out.length >= cap) break;
  }
  return out;
}

/*
 * The apartments listed on one floor-plan page.
 *
 * Anchored on the apartment number, then the two facts that follow it. Both
 * orders appear in the wild, and a plan can list "Available Now" for one
 * apartment and a date for the next, so each is matched independently within a
 * short window rather than as one rigid block.
 */
const APARTMENT_RE = /Apartment:?\s*#?\s*([A-Za-z]?\d{1,5}[A-Za-z]?)\b/gi;
const AVAIL_NOW_RE = /\bAvailable\s+Now\b/i;
const AVAIL_DATE_RE = /\b(?:Date\s+Available|Available)\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i;
const PRICE_RE = /(?:Starting\s+at|Rent|Price)\s*:?\s*\$\s*([\d,]+(?:\.\d{2})?)/i;

const toIsoDate = (mdy) => {
  const m = mdy?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
};

export function parseFloorPlanPage(text, url) {
  const apartments = [];
  const seen = new Set();
  for (const m of text.matchAll(APARTMENT_RE)) {
    const number = m[1];
    if (seen.has(number)) continue;
    // Everything up to the next apartment heading, capped, is this one's block.
    const rest = text.slice(m.index + m[0].length, m.index + m[0].length + 260);
    const block = rest.split(/Apartment:?\s*#/i)[0];
    const price = block.match(PRICE_RE)?.[1]?.replace(/,/g, "");
    const dated = block.match(AVAIL_DATE_RE)?.[1];
    const now = AVAIL_NOW_RE.test(block);
    if (!price && !dated && !now) continue; // a stray number, not a listing
    seen.add(number);
    apartments.push({
      number,
      rent: price ? Math.round(Number(price)) : null,
      availableOn: dated ? toIsoDate(dated) : now ? "now" : null,
    });
  }
  /*
   * The slug is the plan's name on these sites (/floorplans/100n101a is plan
   * 100N101A) and is the only reliable source: reading the first all-caps line
   * of the page instead named nine of twelve plans "CONTACT US".
   */
  const slug = decodeURIComponent((url.split("?")[0].split("/").filter(Boolean).pop() ?? ""));
  const name = /[a-z]/i.test(slug) ? slug.toUpperCase().replace(/-/g, " ") : null;
  const beds = text.match(/(\d+)\s*(?:Bed|BR|Bedroom)/i)?.[1];
  const baths = text.match(/(\d+(?:\.\d)?)\s*(?:Bath|BA|Bathroom)/i)?.[1];
  const area = text.match(/(?:Up to\s*)?([\d,]{3,6})\s*Sq\.?\s*Ft/i)?.[1]?.replace(/,/g, "");
  return {
    url,
    name,
    bedrooms: beds != null ? Number(beds) : null,
    bathrooms: baths != null ? Number(baths) : null,
    area: area != null ? Number(area) : null,
    apartments,
  };
}

// Reads up to MAX_PLANS floor-plan pages. Failures are skipped, never fatal:
// a plan we cannot read costs that plan's detail, not the whole import.
export async function fetchFloorPlanUnits(urls) {
  const plans = [];
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const url = urls[cursor++];
      if (!url) return;
      try {
        const page = await fetchPageSmart(url);
        const plan = parseFloorPlanPage(htmlToText(page.html), page.finalUrl);
        if (plan.apartments.length) plans.push(plan);
      } catch {
        /* skip this plan */
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker)
  );
  return plans;
}

/*
 * The authoritative block for the extraction prompt. Same contract as the
 * SightMap feed: read off the property's own pages, so it outranks anything in
 * the marketing copy.
 */
export function describeFloorPlanUnits(plans) {
  if (!plans?.length) return null;
  const lines = [];
  for (const p of plans) {
    const head = [
      p.name ? `"${p.name}"` : "(floor plan)",
      p.bedrooms === 0 ? "studio" : p.bedrooms != null ? `${p.bedrooms} bed` : null,
      p.bathrooms != null ? `${p.bathrooms} bath` : null,
      p.area ? `up to ${p.area} sq ft` : null,
    ]
      .filter(Boolean)
      .join(", ");
    const rents = p.apartments.map((a) => a.rent).filter(Boolean);
    lines.push(`FLOOR PLAN ${head}`);
    if (rents.length) {
      lines.push(
        `  asking rent for this floor plan: $${Math.min(
          ...rents
        )} per month for the whole unit (the lowest of its available apartments; use this as the floor plan's rent)`
      );
    }
    for (const a of p.apartments) {
      lines.push(
        `  apartment ${a.number}: ` +
          (a.rent ? `$${a.rent}/mo` : "price not shown") +
          (a.availableOn === "now"
            ? ", available now"
            : a.availableOn
            ? `, available ${a.availableOn}`
            : "")
      );
    }
  }
  return `AVAILABLE APARTMENTS (read from this property's own floor-plan pages — these apartment numbers, rents and dates are authoritative; list every apartment number under its floor plan in unitNames, with its date in unitAvailability, and never contradict them):\n${lines.join(
    "\n"
  )}`;
}
