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
import {
  fetchPageSmart,
  htmlToText,
  extractAllLinks,
  extractImageCandidates,
  sameSite,
} from "@/lib/listingDraft/fetchSite";

/*
 * How many plan pages we open. Not how many floor plans exist.
 *
 * One Hundred Above the Park has THIRTY-SIX floor plans, and a cap of twelve
 * took the first twelve in page order, which are all its one-bedrooms: the
 * studios sit at the end of the list and the two- and three-beds in the middle,
 * so the building imported as a one-bedroom building. The plans we do not open
 * still become units from the index page; this only limits how many get their
 * individual apartments read.
 */
const MAX_PLANS = 16;
/*
 * Matched to the Firecrawl plan's maxConcurrency of 2. Asking for more does not
 * go faster — the extra requests queue on their side — and under a burst they
 * come back as failures, which is what made apartments.com look blocked during
 * the 34-site audit.
 */
const CONCURRENCY = 2;

/*
 * Pages one level below the floor-plans index on the same site.
 * /floorplans -> /floorplans/100n101a, and nothing shallower or sideways.
 */
export function findFloorPlanPages(html, indexUrl, cap = Infinity) {
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
  /*
   * Bed and bath counts are written half a dozen ways across these pages
   * ("1 Bed", "1 bd", "1 Bedroom", "1 BR", "Studio", "1 Bed / 1 Bath"), and a
   * plan whose page used a spelling the old pattern missed published with the
   * bedroom and bathroom boxes blank.
   */
  /*
   * Both spellings: the count before the word ("1 Bedroom") and after it
   * ("Bedrooms: 1"). Only the first was read, and a plan whose render used the
   * other came back with no bed count — which was then filled in by the model,
   * and the model has been caught taking the number out of an image file name.
   * Whatever this reads off the page beats a guess, so it is worth being
   * generous about the wording.
   */
  const beds = /\bstudio\b/i.test(text)
    ? "0"
    : text.match(/(\d+)\s*(?:-|\s)?\s*(?:bed(?:room)?s?|bd|br)\b/i)?.[1] ??
      text.match(/\bbed(?:room)?s?\s*[:\-]?\s*(\d+)\b/i)?.[1];
  const baths = text.match(
    /(\d+(?:\.\d)?)\s*(?:-|\s)?\s*(?:bath(?:room)?s?|ba)\b/i
  )?.[1] ?? text.match(/\bbath(?:room)?s?\s*[:\-]?\s*(\d+(?:\.\d)?)\b/i)?.[1];
  const area = text.match(/(?:Up to\s*)?([\d,]{3,6})\s*Sq\.?\s*Ft/i)?.[1]?.replace(/,/g, "");
  /*
   * Concessions sit on these pages and are worth as much as the rent: Dorchester
   * runs "1 MONTH FREE RENT. Must sign lease on/before September 30th, 2026.
   * Lease term must be 10+ months." That is a price, a deadline and a minimum
   * term in one sentence, and a student comparing rents cannot see any of it.
   */
  const specials = findSpecial(text);
  return {
    specials,
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
/*
 * The lease-term range, which lives only on the leasing application page.
 *
 * Dorchester's floor plans publish one rent and no terms; the apply page says
 * "we offer flexible lease terms ranging from 3 to 24 months" and that the rate
 * shown is for a qualifying term. That is a range they will discuss, not a
 * price list, so it is recorded as a note rather than turned into per-term
 * prices we would be inventing. Fetched once per property, not per apartment.
 */
/*
 * The same page reaches us in two different formats, and the parsers only ever
 * saw one of them.
 *
 * A page we can fetch directly arrives as HTML and comes out of htmlToText as
 * plain prose. The same page fetched through Firecrawl arrives as MARKDOWN, so
 * the numbers we are looking for are wrapped in emphasis: "lease terms ranging
 * from **6 to 24 months.**" Every regex here expected a digit where the render
 * put an asterisk, which is why the lease terms parsed perfectly in a direct
 * test and came back empty through the importer every time. Emphasis becomes a
 * space before anything is matched, so both renders read the same.
 */
function stripMarkdown(text) {
  return text
    .replace(/\*\*|__|~~/g, " ")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/[ \t]{2,}/g, " ");
}

/*
 * A rent special, wherever the sentence lands. One Hundred Above the Park does
 * not print its offer on the floor-plan pages at all; it appears on the leasing
 * application, which we already open for the lease terms, so reading it there
 * costs nothing.
 */
/*
 * The floor plan's own diagram, off the floor plan's own page.
 *
 * These pages were being opened for their apartments and their images thrown
 * away, so every import published with no floor plans at all — the model can
 * only choose from candidates it is shown, and it was never shown these. No
 * guessing is needed here: the page IS the plan, and RentCafe labels the image
 * "Floor Plan 100N108a". Failing that, the file is named after the plan.
 *
 * It goes on the unit's own floor-plan slot, never into the photo gallery.
 *
 * Read off the render that kept its HTML, not whichever render won on text
 * length. The markdown one loses the alt that says which image this is, and the
 * first attempt picked a kitchen photo off a plan page because of it — the same
 * trap that hid the lease terms. `linkHtml` is the HTML render fetchSite keeps
 * for exactly this.
 */
function findPlanImage(html, finalUrl, name) {
  let images;
  try {
    images = extractImageCandidates(html, finalUrl);
  } catch {
    return null;
  }
  const slug = String(name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const saysFloorPlan = (im) => /floor\s*plan/i.test(im.alt ?? "");
  const namesThisPlan = (im) =>
    !!slug && im.url.toLowerCase().replace(/[^a-z0-9]/g, "").includes(slug);
  // Labelled a floor plan AND named after this plan is the one we want. A
  // building that labels every carousel thumbnail "floor plan" makes the label
  // alone worth little, which is why the pair comes first.
  /*
   * Renders vary and some arrive with no alt text at all, which left eleven of
   * sixteen plans with no diagram. The file itself is the second witness:
   * these assets are named for the plan and marked as floor plans ("_fp.jpg",
   * "floorplan"), so a file that is both is this plan's diagram whether or not
   * the render kept the label.
   */
  const fileLooksLikeAPlan = (im) => /[._-]fp[._-]|floor[-_]?plan/i.test(im.url);
  return (
    images.find((im) => saysFloorPlan(im) && namesThisPlan(im))?.url ??
    images.find((im) => fileLooksLikeAPlan(im) && namesThisPlan(im))?.url ??
    images.find(saysFloorPlan)?.url ??
    null
  );
}

function findSpecial(text) {
  const hit =
    text.match(/([^\n]*\b(?:MONTH|WEEKS?)\s+FREE\b[^\n]*)/i)?.[1]?.trim() ??
    text.match(/([^\n]*\b(?:special|concession|look and lease|waived)\b[^\n]*)/i)?.[1]?.trim() ??
    null;
  return hit && hit.length < 300 ? hit : null;
}

async function fetchLeaseTermRange(applyUrl) {
  if (!applyUrl) {
    console.log("[listing-draft] lease terms: no application link on any floor-plan page");
    return null;
  }
  try {
    const page = await fetchPageSmart(applyUrl);
    const text = stripMarkdown(htmlToText(page.html));
    const special = findSpecial(text);
    /*
     * The term the quoted rent belongs to, which the page states outright:
     * "Lease Term 12 months / Rent $3,095.00". Worth having on its own even
     * when the property publishes no range, because it is the number that
     * fills the lease-length chips.
     */
    const reflects =
      /Lease\s+Term\s*:?\s*(\d{1,2})\s*months?/i.exec(text)?.[1] ??
      /displayed[^.]*?(\d{1,2})[- ]month/i.exec(text)?.[1] ??
      null;
    const m = text.match(
      /lease terms?[^.]{0,60}?rang\w*\s+from\s*(\d{1,2})\s*(?:to|-|–|through|and)\s*(\d{1,2})\s*months/i
    );
    if (!m) {
      console.log(
        `[listing-draft] lease terms: read ${text.length} chars from ${applyUrl.slice(0, 120)} ` +
          `but found no range${/lease\s*term/i.test(text) ? ' (the page does mention a lease term)' : ''}`
      );
      return reflects || special ? { reflects, special } : null;
    }
    /*
     * The page states the term its quoted rent assumes, in as many words:
     * "Lease Term 12 months / Rent $2,395.00". That is the number the rent
     * belongs on; the 3-to-24 range is only what they will discuss.
     */
    console.log(`[listing-draft] lease terms: ${m[1]}-${m[2]} months, rate reflects ${reflects ?? "?"}`);
    return { min: Number(m[1]), max: Number(m[2]), reflects, special };
  } catch (err) {
    console.log(`[listing-draft] lease terms: ${applyUrl.slice(0, 120)} failed — ${err.message}`);
    return null;
  }
}

/*
 * Spread the budget across the list instead of taking the first N.
 *
 * The plans are in page order, which groups them by bedroom count, so the first
 * sixteen of thirty-six are all one-bedrooms. Taking an even spread means every
 * size gets some of its apartments read, and the plans in between still appear
 * from the index.
 */
export function chooseFloorPlansToRead(urls, budget = MAX_PLANS) {
  if (urls.length <= budget) return urls;
  const step = urls.length / budget;
  const picked = [];
  for (let i = 0; i < budget; i++) picked.push(urls[Math.floor(i * step)]);
  return [...new Set(picked)];
}

export async function fetchFloorPlanUnits(urls) {
  const plans = [];
  let applyUrl = null;
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const url = urls[cursor++];
      if (!url) return;
      try {
        const page = await fetchPageSmart(url);
        const text = stripMarkdown(htmlToText(page.html));
        const plan = parseFloorPlanPage(text, page.finalUrl);
        plan.image = findPlanImage(page.linkHtml ?? page.html, page.finalUrl, plan.name);
        if (!applyUrl) {
          applyUrl =
            /*
             * The leasing application, not the resident portal. Matching
             * "securecafe" loosely picked up .../residentservices/userlogin,
             * which is a sign-in wall with no lease information on it at all.
             */
            extractAllLinks(page.html, page.finalUrl, 200).find(
              (l) => /oleapplication/i.test(l.url) && !/residentservices/i.test(l.url)
            )?.url ?? null;
        }
        if (plan.apartments.length) plans.push(plan);
      } catch {
        /* skip this plan */
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker)
  );
  const termRange = plans.length ? await fetchLeaseTermRange(applyUrl) : null;
  return { plans, termRange };
}

/*
 * The authoritative block for the extraction prompt. Same contract as the
 * SightMap feed: read off the property's own pages, so it outranks anything in
 * the marketing copy.
 */
export function describeFloorPlanUnits(result) {
  const plans = Array.isArray(result) ? result : result?.plans;
  const termRange = Array.isArray(result) ? null : result?.termRange;
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
    if (p.specials) lines.push(`  special offer: ${p.specials}`);
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
  if (termRange) {
    lines.push(
      `LEASE TERMS: this property offers terms from ${termRange.min} to ${termRange.max} months, and the rents above are the rate for a qualifying term` +
        (termRange.reflects ? `, normally ${termRange.reflects} months` : "") +
        `. That is a range they will discuss, NOT a price per term: put the rent on ${
          termRange.reflects ?? 12
        } months, leave leaseTermPrices empty, and add a sourceNote saying terms run ${termRange.min} to ${termRange.max} months and only the displayed rate is published.`
    );
  }
  return `AVAILABLE APARTMENTS (read from this property's own floor-plan pages — these apartment numbers, rents and dates are authoritative; list every apartment number under its floor plan in unitNames, with its date in unitAvailability, and never contradict them):\n${lines.join(
    "\n"
  )}`;
}
