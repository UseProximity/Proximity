/*
 * The model calls behind the importer: Haiku first, Sonnet only when Haiku
 * was not sure.
 *
 * The readers do the exact work (prices, apartments, dates, floor plans come
 * off the page or the site's own feed). What is left for a model is the part
 * that needs reading rather than parsing: which buildings a company page
 * lists, a property's description and amenities, and on a site no reader
 * understands, the units themselves. Haiku is fast and cheap enough to run on
 * every import; Sonnet is held back for the reads Haiku flags as low
 * confidence, so a strange site costs more but a normal one does not.
 *
 * Structured outputs via messages.parse. The API caps a schema at 16
 * nullable/union fields; the listing and unit schemas below spend 15.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { AMENITY_VALUES, HOME_TYPES, UTILITY_VALUES } from "./snapshot.js";

export const HAIKU = "claude-haiku-5-5";
export const SONNET = "claude-sonnet-5-5";

// Below this the read is retried on Sonnet. Haiku reports its own confidence;
// the route also escalates on structural signs (see shouldEscalate).
const ESCALATE_BELOW = 0.6;

let _client = null;
function getClient() {
  if (!_client) {
    _client = new Anthropic({
      apiKey: process.env.LISTING_DRAFT_KEY || process.env.ANTHROPIC_API_KEY,
    });
  }
  return _client;
}

// USD per token, for the cost line in the logs.
const PRICES = {
  [HAIKU]: { input: 1.0 / 1e6, output: 5.0 / 1e6, cacheRead: 0.1 / 1e6, cacheWrite: 1.25 / 1e6 },
  [SONNET]: { input: 3.0 / 1e6, output: 15.0 / 1e6, cacheRead: 0.3 / 1e6, cacheWrite: 3.75 / 1e6 },
};

export function logCost(tag, model, usage) {
  if (!usage) return;
  const p = PRICES[model] ?? PRICES[SONNET];
  const cost =
    (usage.input_tokens ?? 0) * p.input +
    (usage.output_tokens ?? 0) * p.output +
    (usage.cache_read_input_tokens ?? 0) * p.cacheRead +
    (usage.cache_creation_input_tokens ?? 0) * p.cacheWrite;
  console.log(
    `[source-import] ${tag} on ${model} cost $${cost.toFixed(4)} ` +
      `(in:${usage.input_tokens ?? 0} out:${usage.output_tokens ?? 0} cacheRead:${usage.cache_read_input_tokens ?? 0})`
  );
  return cost;
}

// No em dash ever reaches a listing (repo rule).
function stripEmDashes(value) {
  if (typeof value === "string") return value.replace(/\s*—\s*/g, ", ").replace(/—/g, "-");
  if (Array.isArray(value)) return value.map(stripEmDashes);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripEmDashes(v)]));
  }
  return value;
}

// ---------------------------------------------------------------- schemas

const PropertyEntry = z.object({
  name: z.string(),
  address: z.string(),
  url: z.string(),
  kind: z.enum(["property", "group"]),
});

const UnitSchema = z.object({
  name: z.string().nullable(),
  bedrooms: z.number().nullable(),
  bathrooms: z.number().nullable(),
  area: z.number().nullable(),
  rent: z.number().nullable(),
  rentBasis: z.enum(["total", "per_person", "unknown"]),
  available: z.boolean(),
  floorPlanImageUrl: z.string().nullable(),
  availableFrom: z.string().nullable(),
  leaseTermMonths: z.array(z.number()),
  // Apartment numbers filed under this floor plan, with a rent and a date per
  // entry in the same order (or empty). Arrays cost nothing against the cap.
  apartments: z.array(z.string()),
  apartmentRents: z.array(z.number()),
  apartmentDates: z.array(z.string()),
});

const ListingSchema = z.object({
  address: z.string().nullable(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  home_type: z.enum(HOME_TYPES).nullable(),
  furnished: z.boolean().nullable(),
  contact_name: z.string().nullable(),
  contact_email: z.string().nullable(),
  contact_phone: z.string().nullable(),
  amenities: z.array(z.enum(AMENITY_VALUES)),
  customAmenities: z.array(z.string()),
  utilities_included: z.array(z.enum(UTILITY_VALUES)),
  units: z.array(UnitSchema),
  imageUrls: z.array(z.string()),
  concessions: z.array(z.string()),
  sourceNotes: z.array(z.string()),
  confidence: z.number(),
});

const ReadSchema = z.object({
  properties: z.array(PropertyEntry),
  listing: ListingSchema.nullable(),
});

// ---------------------------------------------------------------- prompts

const SYSTEM = `You read a landlord's own property website for Proximity, a student-housing marketplace near WashU in St. Louis, and return a structured draft. The landlord pasted this URL and will review every field, but they trust the draft, so never guess.

Rules, in order of importance:
1. Trust ONLY the page text and the candidate lists you are given. Never infer a fact from a URL or slug.
2. Every field is nullable. When the pages do not state a fact, return null or an empty array. Never pad, estimate or average. Set "confidence" (0 to 1) to how sure you are that the units and prices you returned are complete and correct for this property; be honest, a low number is useful.
3. ADDRESS: the most complete address the pages state. A street-only address ("723 Interdrive") is worth returning. Never invent a city, state or zip.
4. RENT: Proximity stores rent per month. If the site says a price is per person, per bed or per room, set rentBasis "per_person" and still return the number. If it is clearly for the whole apartment, "total". If you cannot tell, "unknown" with the number. "$TBD" or "call for pricing" is null.
5. MULTI-PROPERTY SITES: when the pages cover more than one distinct rental building and no TARGET PROPERTY is given, list every property in "properties" (name, address if stated, URL from CANDIDATE LINKS exactly as written or "" if none clearly matches) and set "listing" to null. Different street numbers are different properties even when marketed together ("6219-6221 Rosebury" is two). A neighborhood, city or "our communities" page is kind "group", never a property; a building with its own name or street address is kind "property". A section link such as "Apartments for Rent" or "Our Properties" is a group only when the buildings themselves are not already on the page. Never list anything for sale, commercial, office, retail, storage or land.
6. UNITS. Each entry becomes one unit, and "name" is shown to students. Decide by how the site itself is organised:
   (a) a building of shared layouts (a floor plans page, plans with names or codes, apartments filed under plans): ONE unit per FLOOR PLAN, named exactly as the site names it ("Pershing", "A1 Penthouse", "100N101A"). The apartment numbers behind it go in "apartments", with their own rents and dates in "apartmentRents" and "apartmentDates" in the same order when the site gives them per apartment (same length or empty, never partial).
   (b) a small building where each apartment is presented on its own: ONE unit per APARTMENT, named as the site does ("6219 S", "2W", "Unit B"), with "apartments" empty.
   (c) a whole house let as one: one unit, name null.
   Never invent a name from the bed and bath count. Studios are bedrooms 0. When one bathroom count is listed alongside several bedroom options, apply it to each. "available" is false for a plan the site marks waitlist, sold out or call for details with no price. "leaseTermMonths" holds lease lengths the site states for this plan in months; empty when it does not say. A sentence like "lease terms from 3 to 24 months" is a range they will discuss, not a price per term: leave leaseTermMonths empty and add a sourceNote.
   When a KNOWN UNITS section is given, those units were read exactly from the site's own feed or floor plan pages: do not restate them. In "units", return only floor plans the pages show that are NOT among the known units (a different bed, bath or square-foot combination), such as plans marked "call for details" or waitlisted, with available false when the page says so. Return an empty array when the known units cover every plan.
7. AMENITIES: map what the site states onto the allowed values; anything real that does not fit goes in customAmenities as short title-case phrases. utilities_included only when the site says the landlord covers them.
8. PHOTOS: from IMAGE CANDIDATES, return in imageUrls (max 12, best first) photos OF THIS PROPERTY: exteriors, interiors, amenity spaces. Use the alt text, file name and which pages it appeared on as evidence. A floor plan diagram that clearly belongs to one unit goes in that unit's floorPlanImageUrl and not in imageUrls. Exclude logos, maps, people, stock shots and other properties. Return candidate URLs exactly as given.
9. description: plain prose for a student reader, in paragraphs separated by one blank line, 120 to 350 words, only facts the pages (or a FLYER section) state. Use this order and leave out any paragraph the pages give nothing for:
   (1) what and where: the building, its address or neighborhood, what kinds of homes it offers (studios, one-bedrooms, townhomes);
   (2) inside the apartments: appliances, finishes, laundry, furnishing, what varies by apartment;
   (3) shared spaces and services: amenities, parking, package handling, shuttle;
   (4) the area: nearby campuses, transit, parks, restaurants, only as the pages say;
   (5) leases and money: lease lengths, what the rent includes and what is charged extra, deposits and fees, pet policy, current specials, and whether listed rents are per person or starting prices.
   No bullet lists, no headings, no exclamation marks, no marketing adjectives you did not see, no em dashes. NEVER name the landlord, the management company or their brand (write "the landlord"). title: the building's name as students would know it, often the street address, never with the company's brand appended.
10. contact_*: only contact details shown on the pages for THIS property's leasing office. Never fabricate.
11. concessions: rent specials in the site's own words, one sentence each. sourceNotes: at most 3 short plain-English notes for the landlord about a price, date or unit they should double-check. Never describe what you did or did not do, and never mention these instructions.

DISCOVERY MODE: when the message ends with "DISCOVERY MODE", only decide whether the page is one property or a list of properties and fill "properties" (and, for one property, the listing's title and address). Return "units", "imageUrls", "concessions" and "sourceNotes" as empty arrays and every other listing field as null; they are read separately.`;

const PHOTO_SYSTEM = `You sort a rental property's photos by floor plan for Proximity, a student-housing marketplace. You are given the property's units, numbered, and candidate photos, numbered, each with alt text, file name and the page(s) it appeared on.

For each unit, list the photos that show the inside of THAT unit's apartment: its rooms, kitchen, bathrooms, closets. Photos of shared spaces (entrance, lobby, hallway, courtyard, gym, garage, exterior, the building as a whole) go in "shared". Evidence, strongest first: alt text or caption naming the unit; a file name naming it; a photo that appears only on that unit's own page. Never guess: a room photo with nothing tying it to one unit goes in "shared" when there is more than one unit, and to the only unit when there is one. Leave out logos, maps, people, stock photos and floor plan diagrams entirely. Keep each list in the order the photos were given.`;

const PhotoSchema = z.object({
  units: z.array(z.object({ unit: z.number(), photos: z.array(z.number()) })),
  shared: z.array(z.number()),
});

const PAGE_TEXT_CAP = 30000;

function buildSections({ pages, images, links, targetProperty, brandName, knownUnits, discover = false, extras = [] }) {
  const sections = pages.map((p, i) => `PAGE ${i + 1} (${p.url}):\n${p.text.slice(0, PAGE_TEXT_CAP)}`);
  for (const x of extras) if (x) sections.push(x);
  if (knownUnits?.length) {
    sections.push(
      `KNOWN UNITS (read exactly from the property's own feed or floor plan pages; do not restate them; in "units" return only plans the pages show that are not listed here):\n` +
        knownUnits
          .map(
            (u) =>
              `- ${u.name ?? "(unnamed)"}: ${u.bedrooms ?? "?"} bed / ${u.bathrooms ?? "?"} bath` +
              (u.area ? `, ${u.area} sq ft` : "") +
              (u.offers?.length ? `, from $${u.offers.find((o) => o.rent != null)?.rent ?? "?"}` : "")
          )
          .join("\n")
    );
  }
  sections.push(
    `IMAGE CANDIDATES (url | alt | page(s)):\n${
      images.map((im) => `${im.url} | ${im.alt || "(no alt)"} | ${(im.pages ?? [1]).join(",")}`).join("\n") || "(none)"
    }`
  );
  sections.push(
    `CANDIDATE LINKS (url | link text):\n${links.map((l) => `${l.url} | ${l.text || "(no text)"}`).join("\n") || "(none)"}`
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
      `MANAGEMENT COMPANY: this site belongs to "${brandName}". Never mention this name in the description or title; write "the landlord" instead.`
    );
  }
  if (discover) sections.push("DISCOVERY MODE");
  return sections.join("\n\n---\n\n");
}

async function parseWith(model, { system, schema, content, maxTokens, tag }) {
  let response;
  try {
    response = await getClient().messages.parse({
    model,
    max_tokens: maxTokens,
    output_config: { format: zodOutputFormat(schema) },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content }],
    });
  } catch (err) {
    // A truncated or malformed answer (the SDK throws on it) is "could not
    // read", which the caller escalates or reports; it is not a crash.
    console.error(`[source-import] ${tag} on ${model} failed to parse: ${err?.message?.slice(0, 160)}`);
    return { parsed: null, cost: 0 };
  }
  const cost = logCost(tag, model, response.usage) ?? 0;
  return { parsed: response.parsed_output ? stripEmDashes(response.parsed_output) : null, cost };
}

/*
 * Signs that Haiku's read missed something structural, whatever confidence it
 * reported: a page full of dollar figures that produced no priced unit, or a
 * single-property read that found no units at all.
 */
function shouldEscalate(parsed, { pages, knownUnits, targetProperty, discover }) {
  if (!parsed) return true;
  // Discovery only needs the property list; the job reads the units.
  if (discover) return !parsed.listing && !parsed.properties.length && !targetProperty && pages[0].text.length > 1500;
  if (parsed.listing) {
    if (parsed.listing.confidence < ESCALATE_BELOW) return true;
    if (!knownUnits?.length) {
      const prices = pages.reduce((n, p) => n + (p.text.match(/\$\s?\d{3,5}/g) ?? []).length, 0);
      const priced = parsed.listing.units.filter((u) => u.rent != null).length;
      if (prices >= 3 && priced === 0) return true;
      if (parsed.listing.units.length === 0 && (targetProperty || prices >= 2)) return true;
    }
    return false;
  }
  // A properties list: escalate only when it came back empty on a page that
  // clearly lists buildings.
  if (!parsed.properties.length && !targetProperty) {
    const addresses = pages.reduce((n, p) => n + (p.text.match(/\b\d{2,5}\s+[A-Z][a-z]+\s+(St|Ave|Blvd|Dr|Rd|Ln|Pl|Ct)\b/g) ?? []).length, 0);
    return addresses >= 3;
  }
  return false;
}

/*
 * One read of a site or property. Returns { draft, model, cost, escalated }
 * where draft is { properties, listing } (listing null for a multi-property
 * page) or null when neither model could parse the pages.
 */
/*
 * SOURCE_IMPORT_MODEL=sonnet makes every extraction run on Sonnet directly,
 * for comparing accuracy against the Haiku-first default on the same sites.
 */
const FORCED = process.env.SOURCE_IMPORT_MODEL === "sonnet" ? SONNET : process.env.SOURCE_IMPORT_MODEL === "haiku" ? HAIKU : null;

export async function readWithModel(input, { force = FORCED } = {}) {
  const content = buildSections(input);
  const call = (model) =>
    parseWith(model, { system: SYSTEM, schema: ReadSchema, content, maxTokens: input.discover ? 8000 : 12000, tag: input.discover ? "discover" : "property" });

  if (force) {
    const r = await call(force);
    return { draft: r.parsed, model: force, cost: r.cost, escalated: false };
  }
  const first = await call(HAIKU);
  if (!shouldEscalate(first.parsed, input)) {
    return { draft: first.parsed, model: HAIKU, cost: first.cost, escalated: false };
  }
  console.log(`[source-import] escalating to ${SONNET}: Haiku confidence ${first.parsed?.listing?.confidence ?? "n/a"}`);
  const second = await call(SONNET);
  // Sonnet's answer, unless it also came back empty and Haiku had something.
  const draft = second.parsed ?? first.parsed;
  return { draft, model: second.parsed ? SONNET : HAIKU, cost: first.cost + second.cost, escalated: true };
}

/*
 * Which candidate photos show which unit. Haiku only; a wrong sort costs a
 * landlord one drag in the editor, not a published error. Returns
 * { byUnit: string[][], shared: string[] } or null.
 */
export async function sortPhotosByUnit({ units, images }) {
  if (!units.length || !images.length) return null;
  // Enough candidates to cover a big building's room shots, few enough that
  // the numbered answer fits; it was truncating past eighty.
  images = images.slice(0, 80);
  const content = [
    `UNITS:\n${units.map((u, i) => `${i + 1}. ${u.name ?? "(unnamed)"}: ${u.bedrooms ?? "?"} bed / ${u.bathrooms ?? "?"} bath${u.area ? `, ${u.area} sq ft` : ""}`).join("\n")}`,
    `PHOTOS (number. url | alt | page(s)):\n${images
      .map((im, i) => `${i + 1}. ${im.url} | ${im.alt || "(no alt)"} | ${(im.pages ?? [1]).join(",")}`)
      .join("\n")}`,
  ].join("\n\n");
  try {
    const { parsed } = await parseWith(HAIKU, { system: PHOTO_SYSTEM, schema: PhotoSchema, content, maxTokens: 8000, tag: "photos" });
    if (!parsed) return null;
    const at = (n) => images[n - 1]?.url;
    const byUnit = units.map(() => []);
    const taken = new Set();
    for (const row of parsed.units) {
      const i = row.unit - 1;
      if (i < 0 || i >= units.length) continue;
      for (const n of row.photos) {
        const url = at(n);
        if (url && !taken.has(url)) {
          byUnit[i].push(url);
          taken.add(url);
        }
      }
    }
    const shared = parsed.shared.map(at).filter((u) => u && !taken.has(u));
    return { byUnit, shared };
  } catch (err) {
    console.error("[source-import] photo sort failed:", err?.message);
    return null;
  }
}

/*
 * The sync's second opinion on a change the rules could not classify: is it
 * an obvious correction to apply, or something a person should look at?
 * Haiku, one short answer. Fails to "review" so a model outage never applies
 * anything.
 */
const VerdictSchema = z.object({
  verdict: z.enum(["apply", "review"]),
  reason: z.string(),
});

export async function judgeChange({ listingLabel, unitLabel, field, oldValue, newValue, context }) {
  const content =
    `Listing: ${listingLabel}\nUnit: ${unitLabel ?? "(property)"}\nField: ${field}\n` +
    `Before (on Proximity): ${JSON.stringify(oldValue)}\nNow (on the landlord's website): ${JSON.stringify(newValue)}\n` +
    (context ? `Context: ${context}\n` : "") +
    `\nIs this an obvious, safe update to copy from the website to the listing (apply), or does it need a person to look (review)? ` +
    `Apply only when the website clearly and unambiguously states the new value and the change is the kind a landlord would expect to flow through automatically (a rent number moved, a date moved, a unit stopped being offered). Review when the new value could be a misread, a placeholder, a different unit, or a structural change.`;
  try {
    const { parsed } = await parseWith(HAIKU, {
      system: "You review proposed changes to rental listings for a student-housing marketplace. Be conservative: when in doubt, answer review.",
      schema: VerdictSchema,
      content,
      maxTokens: 800,
      tag: "judge",
    });
    return parsed ?? { verdict: "review", reason: "no answer" };
  } catch (err) {
    return { verdict: "review", reason: err?.message ?? "model error" };
  }
}

/*
 * Which pages to open next, chosen by the model.
 *
 * The read tells it, from what the readers and earlier extraction actually
 * returned, what is already known about the building and what is still
 * missing (lease lengths, availability, rent, what the rent includes). It
 * picks the links most likely to state the missing facts for THIS building:
 * an FAQ, a fee guide, a leasing portal, an availability page, wherever.
 * A word list used to decide this, and it followed Zillow's "nearby homes"
 * as if they were pages about the building.
 */
const ExploreSchema = z.object({
  pages: z.array(z.object({ url: z.string(), lookingFor: z.string() })),
});

const EXPLORE_SYSTEM = `You help Proximity, a student-housing marketplace, finish reading one rental property's website. You are told which property this is, what has already been read about it, and what is still missing. From CANDIDATE LINKS, choose the pages most likely to state the missing facts for THIS property.

Rules:
- Only pages about this property or its landlord's policies for it: its floor plans, availability, pricing, lease terms, FAQ, fees, what's included, amenities, specials, or its leasing portal or application flow (these often show lease lengths and dates). A company-wide FAQ or fee page counts.
- Never pages about other buildings or other listings ("nearby", "similar homes", another property's name or address), blogs, news, careers, residents' login, payments, maintenance requests, social media or maps.
- Copy each URL exactly as written in CANDIDATE LINKS. Choose at most the number asked for, best first, and say in a few words what you hope to find on each.
- Small landlords often keep prices and dates in a file or an embedded sheet: links marked "(linked file)" (a PDF, a picture, a Google Sheet or Doc) and "(embedded in the page)" (a published sheet, a listings widget) are readable and worth choosing when they look like an availability list, price sheet, rate card, floor plans or lease terms.
- ALREADY READ may answer an item listed as missing (a monthly utility fee answers what the rent includes): do not hunt for what is already answered.
- If no link is likely to help, return an empty list. An empty list is better than a guess.`;

export async function choosePagesToExplore({ target, known, missing, visited, links, max = 4 }) {
  if (!links.length || !missing.length || max <= 0) return { pages: [], cost: 0 };
  const content = [
    `PROPERTY: ${target.name ?? "(unnamed)"}${target.address ? `, ${target.address}` : ""}`,
    `ALREADY READ:\n${known.map((k) => `- ${k}`).join("\n") || "- nothing yet"}`,
    `STILL MISSING:\n${missing.map((m) => `- ${m}`).join("\n")}`,
    `PAGES ALREADY OPENED:\n${visited.slice(0, 30).map((u) => `- ${u}`).join("\n")}`,
    `CANDIDATE LINKS (url | link text):\n${links.map((l) => `${l.url} | ${l.text || "(no text)"}`).join("\n")}`,
    `Choose at most ${max}.`,
  ].join("\n\n");
  try {
    const { parsed, cost } = await parseWith(HAIKU, { system: EXPLORE_SYSTEM, schema: ExploreSchema, content, maxTokens: 800, tag: "explore" });
    const allowed = new Set(links.map((l) => l.url));
    const pages = (parsed?.pages ?? []).filter((p) => allowed.has(p.url)).slice(0, max);
    return { pages, cost: cost ?? 0 };
  } catch (err) {
    console.error("[source-import] explore failed:", err?.message);
    return { pages: [], cost: 0 };
  }
}

/*
 * The notes a landlord sees on the import, checked against what the read
 * finally found. Readers and the extraction each write notes as they go
 * ("this site does not publish lease lengths"); a later step can answer
 * one (the leasing portal priced every apartment for 12 months), and two
 * can say the same thing. The model keeps the ones still true, merges
 * repeats, and drops the answered. A word filter did this before.
 */
const NotesSchema = z.object({ notes: z.array(z.string()) });

const NOTES_SYSTEM = `You tidy the notes shown to a landlord after Proximity imported their property from their website. You get the notes and the FINAL FACTS: what the import ended up with. Return the notes that are still true and useful, in plain English, one or two sentences each.

Rules:
- Drop a note the final facts contradict or answer (a note saying lease lengths are not published, when the final facts show lease lengths for every lease).
- Merge notes that say the same thing into one.
- Keep notes about things the landlord should check or decide; never add a new fact, number or claim of your own.
- Keep the landlord's wording plain; never mention notes, models, readers, scrapers or this process.
- Return at most 6, most important first, each under 35 words. An empty list is fine.`;

export async function reviewNotes({ notes, facts }) {
  const unique = [...new Set(notes.map((n) => String(n ?? "").trim()).filter(Boolean))];
  if (!unique.length) return { notes: [], cost: 0 };
  const content = [`FINAL FACTS:\n${facts.map((f) => `- ${f}`).join("\n")}`, `NOTES:\n${unique.map((n, i) => `${i + 1}. ${n}`).join("\n")}`].join("\n\n");
  try {
    const { parsed, cost } = await parseWith(HAIKU, { system: NOTES_SYSTEM, schema: NotesSchema, content, maxTokens: 2000, tag: "notes" });
    if (!parsed) return { notes: unique.slice(0, 6), cost: cost ?? 0 };
    return { notes: stripEmDashes(parsed.notes).map((n) => n.trim()).filter(Boolean).slice(0, 6), cost: cost ?? 0 };
  } catch (err) {
    console.error("[source-import] notes review failed:", err?.message);
    return { notes: unique.slice(0, 6), cost: 0 };
  }
}

/*
 * Are these two floor plans the same plan? Asked only when two sources (a
 * feed and the website, or two feeds) list plans with the same beds, baths
 * and size under different names. The Barton's Musial and Cassily are both
 * 1 bed, 1 bath, 750 sq ft and are different apartments at different rents;
 * merging them on the numbers lost the Cassily. The drawings, when there
 * are any, are the strongest evidence. Unsure means different: two tabs a
 * landlord can merge are better than one that hides a plan.
 */
const SamePlanSchema = z.object({ same: z.boolean(), reason: z.string() });

export async function judgeSamePlan(a, b) {
  const describe = (u, tag) =>
    `${tag}: "${u.name ?? "(no name)"}" from ${u.source ?? "the website"}, ${u.bedrooms ?? "?"} bed, ${u.bathrooms ?? "?"} bath, ${u.area ?? "?"} sq ft; ` +
    `rents ${[...new Set((u.offers ?? []).map((o) => o.rent).filter(Boolean))].slice(0, 6).join(", ") || "none"}; apartments ${[...new Set((u.offers ?? []).flatMap((o) => o.apartments ?? []))].slice(0, 8).join(", ") || "none"}`;
  const content = [{ type: "text", text: `${describe(a, "PLAN A")}\n${describe(b, "PLAN B")}` }];
  for (const [u, tag] of [[a, "A"], [b, "B"]]) {
    if (typeof u.floorPlanImageUrl === "string" && /^https:\/\//.test(u.floorPlanImageUrl)) {
      content.push({ type: "text", text: `Plan ${tag} drawing:` }, { type: "image", source: { type: "url", url: u.floorPlanImageUrl } });
    }
  }
  content.push({ type: "text", text: "Is plan A the same floor plan as plan B, listed twice under two names? Same layout and the same apartments means same; a different layout, different apartment numbers or a clearly different rent means different. When unsure, answer different." });
  try {
    const { parsed } = await parseWith(HAIKU, {
      system: "You compare two floor plans of one apartment building, read from different parts of its website, and say whether they are one plan listed twice or two different plans.",
      schema: SamePlanSchema,
      content,
      maxTokens: 300,
      tag: "same plan",
    });
    return parsed ?? { same: false, reason: "no answer" };
  } catch (err) {
    console.error("[source-import] same-plan check failed:", err?.message);
    return { same: false, reason: "check failed" };
  }
}
