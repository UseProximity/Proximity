/*
 * Claude extraction for the paste-your-website listing draft. Takes the stripped
 * text of the landlord's page(s) plus image/link candidates and returns a draft
 * shaped like ListingFormPanel's state. Same SDK pattern as Lease Check
 * (analyzeLease.js): claude-sonnet-5 structured outputs via messages.parse.
 *
 * Note for future edits: temperature/top_p/top_k and thinking:{type:"enabled"}
 * are rejected with a 400 on claude-sonnet-5 — do not add them.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

export const DRAFT_MODEL = "claude-sonnet-5";

let _client = null;
function getClient() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.LISTING_DRAFT_KEY });
  return _client;
}

// Exact boolean column names on listing_amenities / listing_utilities — must
// stay in sync with ListingFormPanel and /api/addListing.
const AMENITY_VALUES = [
  "air_conditioning", "dishwasher", "gym", "laundry", "mailroom",
  "microwave", "oven", "parking", "pets_allowed", "pool",
  "refrigerator", "rooftop", "storage", "stove", "study_room",
];
const UTILITY_VALUES = [
  "electric", "gas", "heat", "water", "internet",
  "trash", "cable", "sewer", "cooling",
];

const UnitSchema = z.object({
  bedrooms: z.number().nullable(),
  bathrooms: z.number().nullable(),
  rent: z.number().nullable(),
  rentBasis: z.enum(["total", "per_person", "unknown"]),
  area: z.number().nullable(),
  title: z.string().nullable(),
  floorPlanImageUrl: z.string().nullable(),
  // "now", "YYYY-MM-DD", or null when the site doesn't say. NOTE: the API caps
  // structured-output schemas at 16 nullable/union fields and this is #16 —
  // the next nullable field added anywhere in this schema must free one up.
  availableFrom: z.string().nullable(),
});

// address/url use "" (not null) when unknown — the Anthropic API caps schemas
// at 16 nullable/union fields and the listing + unit fields need that budget.
const PropertySchema = z.object({
  name: z.string(),
  address: z.string(),
  url: z.string(),
  // "property" = an actual rental building/complex; "group" = a category page
  // (neighborhood, "our communities") that lists properties one level deeper.
  kind: z.enum(["property", "group"]),
});

const ListingSchema = z.object({
  address: z.string().nullable(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  home_type: z.enum(["apartment", "house", "condo", "townhouse", "other"]).nullable(),
  furnished: z.boolean().nullable(),
  contact_name: z.string().nullable(),
  contact_email: z.string().nullable(),
  contact_phone: z.string().nullable(),
  amenities: z.array(z.enum(AMENITY_VALUES)),
  customAmenities: z.array(z.string()),
  utilities_included: z.array(z.enum(UTILITY_VALUES)),
  units: z.array(UnitSchema),
  imageUrls: z.array(z.string()),
  sourceNotes: z.array(z.string()),
  confidence: z.number(),
});

const DraftSchema = z.object({
  properties: z.array(PropertySchema),
  listing: ListingSchema.nullable(),
});

const SYSTEM = `You extract structured rental-listing drafts from a landlord's own property website for Proximity, a student-housing marketplace near WashU in St. Louis. The landlord pasted this URL themselves and will review every field before anything is published — but they trust the draft, so never guess.

Rules, in order of importance:
1. Trust ONLY the page text and candidate lists you are given. Never infer facts from a URL or page slug — sites reuse and mislabel URLs. If the page text says "723 Interdrive", the property is 723 Interdrive regardless of the URL.
2. Every field is nullable: when the pages don't state a fact, return null (or omit from arrays). Do not pad, estimate, or average.
2b. ADDRESS: return the most complete address the pages state. A street-only address like "718 Limit" or "723 Interdrive" IS worth returning — the landlord confirms the full address from a dropdown afterwards. Never invent a city, state, or zip the pages don't show.
3. RENT: Proximity stores rent for the WHOLE unit per month. If the site gives a price per person / per bed / per room, or you cannot tell which convention it uses, set rent to null, set rentBasis accordingly ("per_person" or "unknown"), and add a sourceNote quoting the price you saw. Only set a rent number when you are confident it is the whole-unit monthly price (then rentBasis "total"). Prices like "$TBD" or "call for pricing" are null.
4. MULTI-PROPERTY SITES: if the pages cover more than one distinct rental property/building and no TARGET PROPERTY is specified, list every property you can identify in "properties" (name, address if stated, and its same-site URL from CANDIDATE LINKS if one clearly matches; use an empty string "" for an unknown address or url, never invent one) and set "listing" to null. If the pages describe exactly one property, or a TARGET PROPERTY is specified, fill "listing" for that property (and still list the properties you saw). Note that many properties sharing one street address (e.g. one building with several floor plans) is ONE property with several units.
4c. RENTALS ONLY, RESIDENTIAL ONLY: Proximity lists residential rentals. Exclude commercial, office, retail, industrial, land, and self-storage properties, AND anything offered FOR SALE (homes for sale, "buy" sections) — from "properties" (including group entries: never list a for-sale or commercial section as a group) and from any listing, even when the site mixes them with rentals. When you genuinely can't tell, include it.
4b. GROUPS vs PROPERTIES: each entry gets a "kind". A neighborhood, area, city, or category page (e.g. "Central West End", "Clayton", "Our Communities") is kind "group", never a property; the landlord will open it to see the actual buildings inside. So is a site section that leads to the residential rentals, but ONLY when the buildings themselves aren't on the current page (e.g. "Apartments for Rent", "Available Rentals", "Our Properties" from CANDIDATE LINKS). When the individual properties ARE already listed here, never also return a nav/section link ("Find Your Home", "Our Properties") as a group — it would duplicate them. An individual building or complex with its own name or street address is kind "property". When the page shows both (areas AND some buildings), list both with correct kinds. Never return an empty properties list when the site clearly has a rentals section you can point to as a group. Never invent a listing from a group page's teaser text.
5. UNITS are floor-plan types (e.g. "2 bed / 1 bath"), not physical apartments. Collapse repeats. When the page lists one bathrooms value alongside several bedroom options (e.g. "Bedrooms: 1/2/3, Bathrooms: 1"), apply that bathroom count to each floor plan rather than leaving it null (add a sourceNote); reserve null for when the page gives no bathroom information at all. "title" is the floor plan's marketing name if the site uses one (e.g. "The Loft"). STUDIOS: record a studio as bedrooms 0, and put "Studio" in the unit's title (unless the site gives it a specific name). AVAILABILITY: when the site states when a unit is available, set availableFrom: "now" for "available now/immediately", or the date as YYYY-MM-DD (infer the year sensibly for month-day dates: the next occurrence). Null when not stated.
6. AMENITIES: map what the site states onto the allowed enum values; anything real that doesn't fit (e.g. "EV charging", "rooftop pool" beyond "pool"/"rooftop") goes in customAmenities as short title-case phrases. utilities_included only when the site says the landlord covers them.
7. PHOTOS: from IMAGE CANDIDATES, return in imageUrls (max 12, best first) the URLs that are photos OF THIS PROPERTY — interiors, exteriors, amenity spaces. Use the alt text, filename, and URL path as evidence. Prefer real photographs first, never a floor plan as the first image.
7b. FLOOR PLANS: a floor-plan diagram that clearly belongs to one specific unit type goes in that unit's floorPlanImageUrl (exact candidate URL) and NOT in imageUrls. Floor plans you can't match to a specific unit go at the END of imageUrls — students want them either way. Exclude anything that looks like a logo, a stock/lifestyle shot unrelated to the building, another property, a map, or a person. Return candidate URLs exactly as given; never invent or modify a URL. Each candidate notes which PAGE section(s) it appeared on — use that as your strongest signal: when a TARGET PROPERTY is specified, PAGE 2+ are that property's own pages, so an image appearing ONLY there is almost certainly its photo — include it even with a bare CDN filename and no alt. An image repeated on page 1 and elsewhere is usually site chrome or another property's teaser. Only exclude a target-page-only image when there is positive evidence it isn't this property (e.g. its alt/filename names a different building).
8. description: a faithful, plain-text summary in the site's own words where possible, 2-5 sentences, no marketing fluff you didn't see, no em dashes. NEVER name the landlord, management company, or their website/brand in the description (students contact through Proximity; e.g. write "the landlord" instead of "Mosaic Living"). title: the property's name as students would know the building (often the street address); never append the management company's brand to it.
9. contact_*: only contact details shown on the pages for THIS landlord/property (leasing office email/phone). Never fabricate.
10. sourceNotes: short plain-English notes for the landlord about anything ambiguous or worth double-checking ("Rent shown as $800/person for the 4-bed — enter the whole-unit price", "Availability dates weren't listed"). confidence: 0-1 overall.`;

// claude-sonnet-5 pricing, USD per token (standard rates) — mirrors Lease Check.
const SONNET5_PRICE = {
  input: 3.0 / 1e6,
  output: 15.0 / 1e6,
  cacheRead: 0.3 / 1e6,
  cacheWrite: 3.75 / 1e6,
};

function logCost(tag, usage) {
  if (!usage) return;
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cost =
    input * SONNET5_PRICE.input +
    output * SONNET5_PRICE.output +
    cacheRead * SONNET5_PRICE.cacheRead +
    cacheWrite * SONNET5_PRICE.cacheWrite;
  console.log(
    `[listing-draft] extraction ${tag} cost $${cost.toFixed(4)} ` +
      `(in:${input} out:${output} cacheRead:${cacheRead} cacheWrite:${cacheWrite})`
  );
}

// Same belt-and-suspenders as Lease Check: no em dash ever reaches the form.
function stripEmDashes(value) {
  if (typeof value === "string") return value.replace(/\s*—\s*/g, ", ").replace(/—/g, "-");
  if (Array.isArray(value)) return value.map(stripEmDashes);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripEmDashes(v)]));
  }
  return value;
}

const PAGE_TEXT_CAP = 30000; // chars per page — well under the token budget

/*
 * pages: [{ url, text }] (first = the pasted page); images: [{ url, alt }];
 * links: [{ url, text }]; targetProperty: { name, address?, url? } | null.
 * Returns the parsed draft or null when the model's output failed to parse.
 */
export async function extractListingDraft({ pages, images, links, targetProperty, brandName }) {
  const client = getClient();

  const sections = pages.map(
    (p, i) => `PAGE ${i + 1} (${p.url}):\n${p.text.slice(0, PAGE_TEXT_CAP)}`
  );
  sections.push(
    `IMAGE CANDIDATES (url | alt | which PAGE sections it appeared on):\n${
      images
        .map(
          (im) =>
            `${im.url} | ${im.alt || "(no alt)"} | page(s) ${
              (im.pages ?? [1]).join(",")
            }`
        )
        .join("\n") || "(none)"
    }`
  );
  sections.push(
    `CANDIDATE LINKS on the site (url | link text):\n${
      links.map((l) => `${l.url} | ${l.text || "(no text)"}`).join("\n") || "(none)"
    }`
  );
  if (targetProperty) {
    sections.push(
      `TARGET PROPERTY: extract the listing for "${targetProperty.name}"` +
        (targetProperty.address ? ` at ${targetProperty.address}` : "") +
        ". Ignore other properties on the site except for the properties list."
    );
  }
  if (brandName) {
    sections.push(
      `MANAGEMENT COMPANY: this site belongs to "${brandName}". Never mention this name (or close variants of it) in the description or title, even when the site's own text does; write "the landlord" instead.`
    );
  }

  const response = await client.messages.parse({
    model: DRAFT_MODEL,
    max_tokens: 16000,
    output_config: { format: zodOutputFormat(DraftSchema) },
    messages: [{ role: "user", content: sections.join("\n\n---\n\n") }],
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
  });

  logCost(targetProperty ? "target" : "initial", response.usage);

  // parsed_output is null when schema parsing failed — callers must treat that
  // as "couldn't read it", never as an empty success.
  if (!response.parsed_output) return null;
  const draft = stripEmDashes(response.parsed_output);

  // Code-level backstop for the company-name ban: sites often open with
  // "<Brand>'s newest property" and the copy-faithfully instinct sometimes
  // wins in the model — scrub literal survivors.
  if (draft.listing && brandName && brandName.length > 3) {
    const brandRe = new RegExp(
      brandName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"),
      "gi"
    );
    if (draft.listing.description) {
      draft.listing.description = draft.listing.description
        .replace(brandRe, "the landlord")
        .replace(/^the landlord/, "The landlord");
    }
    if (draft.listing.title) {
      draft.listing.title =
        draft.listing.title.replace(brandRe, "").replace(/[\s|,:-]+$/, "").trim() ||
        draft.listing.title;
    }
  }

  if (draft.listing) {
    // Photos must be candidate URLs we actually offered — drop anything else.
    const offered = new Set(images.map((im) => im.url));
    draft.listing.imageUrls = (draft.listing.imageUrls ?? [])
      .filter((u) => offered.has(u))
      .slice(0, 12);
    // A rent the model wasn't sure is whole-unit must never prefill the form,
    // and unit floor plans must also come from the offered candidates.
    draft.listing.units = (draft.listing.units ?? []).map((u) => ({
      ...u,
      // Studios import as 0-bed, titled "Studio" so the type stays visible.
      title: u.bedrooms === 0 ? u.title || "Studio" : u.title,
      rent: u.rentBasis === "total" ? u.rent : null,
      availableFrom:
        u.availableFrom === "now" || /^\d{4}-\d{2}-\d{2}$/.test(u.availableFrom ?? "")
          ? u.availableFrom
          : null,
      floorPlanImageUrl:
        u.floorPlanImageUrl && offered.has(u.floorPlanImageUrl)
          ? u.floorPlanImageUrl
          : null,
    }));
  }
  return draft;
}
