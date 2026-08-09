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
});

const PropertySchema = z.object({
  name: z.string(),
  address: z.string().nullable(),
  url: z.string().nullable(),
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
3. RENT: Proximity stores rent for the WHOLE unit per month. If the site gives a price per person / per bed / per room, or you cannot tell which convention it uses, set rent to null, set rentBasis accordingly ("per_person" or "unknown"), and add a sourceNote quoting the price you saw. Only set a rent number when you are confident it is the whole-unit monthly price (then rentBasis "total"). Prices like "$TBD" or "call for pricing" are null.
4. MULTI-PROPERTY SITES: if the pages cover more than one distinct rental property/building and no TARGET PROPERTY is specified, list every property you can identify in "properties" (name, address if stated, and its same-site URL from CANDIDATE LINKS if one clearly matches) and set "listing" to null. If the pages describe exactly one property, or a TARGET PROPERTY is specified, fill "listing" for that property (and still list the properties you saw). Note that many properties sharing one street address (e.g. one building with several floor plans) is ONE property with several units.
5. UNITS are floor-plan types (e.g. "2 bed / 1 bath"), not physical apartments. Collapse repeats. "title" is the floor plan's marketing name if the site uses one (e.g. "The Loft").
6. AMENITIES: map what the site states onto the allowed enum values; anything real that doesn't fit (e.g. "EV charging", "rooftop pool" beyond "pool"/"rooftop") goes in customAmenities as short title-case phrases. utilities_included only when the site says the landlord covers them.
7. PHOTOS: from IMAGE CANDIDATES, return in imageUrls (max 12, best first) the URLs that are photos OF THIS PROPERTY — interiors, exteriors, amenity spaces. Use the alt text and filename as evidence. Exclude anything that looks like a logo, a stock/lifestyle shot unrelated to the building, another property, a map, or a person. Return candidate URLs exactly as given; never invent or modify a URL. When unsure, leave it out.
8. description: a faithful, plain-text summary in the site's own words where possible, 2-5 sentences, no marketing fluff you didn't see, no em dashes. title: the property's display name as the site presents it (often the street address or building name).
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
export async function extractListingDraft({ pages, images, links, targetProperty }) {
  const client = getClient();

  const sections = pages.map(
    (p, i) => `PAGE ${i + 1} (${p.url}):\n${p.text.slice(0, PAGE_TEXT_CAP)}`
  );
  sections.push(
    `IMAGE CANDIDATES (url | alt):\n${
      images.map((im) => `${im.url} | ${im.alt || "(no alt)"}`).join("\n") || "(none)"
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

  if (draft.listing) {
    // Photos must be candidate URLs we actually offered — drop anything else.
    const offered = new Set(images.map((im) => im.url));
    draft.listing.imageUrls = (draft.listing.imageUrls ?? [])
      .filter((u) => offered.has(u))
      .slice(0, 12);
    // A rent the model wasn't sure is whole-unit must never prefill the form.
    draft.listing.units = (draft.listing.units ?? []).map((u) =>
      u.rentBasis === "total" ? u : { ...u, rent: null }
    );
  }
  return draft;
}
