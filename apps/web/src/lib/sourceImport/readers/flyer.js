/*
 * "What's included" flyers.
 *
 * Student-housing sites often publish the one thing a renter most wants to
 * know, which utilities and perks the rent covers, as a picture: Everly on
 * the Loop hides it behind "Lease now" then "What is included?", a 900x1200
 * PNG with a two-column list. Nothing on the site's text says any of it, so a
 * text read reports no utilities and is wrong.
 *
 * This finds links and images that call themselves "what's included",
 * "all-inclusive", "utilities" or "included in rent", fetches the picture
 * through the same SSRF guard as every other asset, and asks Haiku (which
 * reads images) for the lists. The answer is constrained to our amenity and
 * utility vocabulary; anything else goes to custom amenities.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { fetchAssetResponse, readAssetCapped, normalizeLinkUrl } from "@/lib/listingDraft/fetchSite";
import { AMENITY_VALUES, UTILITY_VALUES } from "../snapshot.js";
import { HAIKU } from "../model.js";

const FLYER_TEXT_RE = /what'?s?\s*(is\s*)?included|all[\s-]?inclusive|included\s+(in|with)\s+(your\s+)?rent|utilities\s+included|rent\s+includes|fee\s*(guide|schedule|sheet)|pricing\s*(guide|sheet)/i;
const IMAGE_RE = /\.(png|jpe?g|webp|gif)(\?|$)/i;
const MAX_BYTES = 6 * 1024 * 1024;
const MAX_FLYERS = 2;

let _client = null;
function getClient() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.LISTING_DRAFT_KEY || process.env.ANTHROPIC_API_KEY });
  return _client;
}

const FlyerSchema = z.object({
  isInclusionsFlyer: z.boolean(),
  utilities: z.array(z.enum(UTILITY_VALUES)),
  amenities: z.array(z.enum(AMENITY_VALUES)),
  customAmenities: z.array(z.string()),
  fees: z.array(z.string()),
  // Lease lengths the flyer names or implies (a "short term (10 months)" fee
  // means 10 is offered and the standard term is 12).
  leaseTermMonths: z.array(z.number()),
  notes: z.array(z.string()),
});

/* Image URLs on a page that announce themselves as an inclusions flyer. */
export function findFlyerCandidates(html, baseUrl) {
  const out = new Set();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
    const [tag, href, inner] = m;
    const title = tag.match(/\btitle=["']([^"']*)["']/i)?.[1] ?? "";
    const text = inner.replace(/<[^>]+>/g, " ");
    if (!FLYER_TEXT_RE.test(`${title} ${text}`)) continue;
    const url = normalizeLinkUrl(href, baseUrl);
    if (url && IMAGE_RE.test(url)) out.add(url);
  }
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const alt = `${tag.match(/\balt=["']([^"']*)["']/i)?.[1] ?? ""} ${tag.match(/\btitle=["']([^"']*)["']/i)?.[1] ?? ""}`;
    const src = tag.match(/\b(?:data-src|src)=["']([^"']+)["']/i)?.[1];
    if (!src || !FLYER_TEXT_RE.test(alt)) continue;
    const url = normalizeLinkUrl(src, baseUrl);
    if (url && IMAGE_RE.test(url)) out.add(url);
  }
  return [...out].slice(0, MAX_FLYERS);
}

async function fetchImageBase64(url) {
  const res = await fetchAssetResponse(url);
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!/^image\/(png|jpeg|jpg|webp|gif)$/.test(type)) {
    res.body?.cancel?.().catch?.(() => {});
    return null;
  }
  const buf = await readAssetCapped(res, MAX_BYTES);
  if (!buf) return null;
  return { data: buf.toString("base64"), mediaType: type === "image/jpg" ? "image/jpeg" : type };
}

/*
 * Read one flyer. Returns { utilities, amenities, customAmenities, fees,
 * notes, url } or null when the picture is not an inclusions list.
 */
export async function readInclusionsFlyer(url) {
  let image;
  try {
    image = await fetchImageBase64(url);
  } catch {
    return null;
  }
  if (!image) return null;
  try {
    const response = await getClient().messages.parse({
      model: HAIKU,
      max_tokens: 1500,
      output_config: { format: zodOutputFormat(FlyerSchema) },
      system:
        "You read a rental property's 'what is included' flyer for Proximity, a student-housing marketplace. Return only what the picture states. Map utilities onto the allowed values (electric, gas, heat, water, internet, trash, cable, sewer, cooling) when the flyer says the rent covers them; map building features onto the allowed amenity values; everything else the flyer lists as included (furniture, a TV, a gym membership, a shuttle, package lockers) goes in customAmenities as short title-case phrases. Charges the flyer says are NOT included or cost extra go in fees, one short line each. Put every lease length in months the flyer names or clearly implies in leaseTermMonths (a short-term surcharge for 10 months means 10 is offered; a flyer that charges extra for short terms has a standard term of 12). Set isInclusionsFlyer false if the picture is not a list of what is included or a fee guide.",
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } },
            { type: "text", text: "What does this flyer say is included in the rent, what costs extra, and which lease lengths does it name?" },
          ],
        },
      ],
    });
    const parsed = response.parsed_output;
    const u = response.usage ?? {};
    console.log(`[source-import] flyer ${url.slice(0, 80)}: ${parsed?.isInclusionsFlyer ? `${parsed.utilities.length} utilities, ${parsed.amenities.length + parsed.customAmenities.length} amenities` : "not an inclusions flyer"} (in:${u.input_tokens ?? 0} out:${u.output_tokens ?? 0})`);
    if (!parsed?.isInclusionsFlyer) return null;
    return { ...parsed, url, text: describeFlyer(parsed) };
  } catch (err) {
    console.error("[source-import] flyer read failed:", err?.message);
    return null;
  }
}

/* The flyer as a few lines of text, for the extraction prompt. */
function describeFlyer(f) {
  const lines = [];
  if (f.utilities.length) lines.push(`Utilities included in rent: ${f.utilities.join(", ")}.`);
  if (f.amenities.length || f.customAmenities.length) lines.push(`Included: ${[...f.amenities, ...f.customAmenities].join(", ")}.`);
  if (f.fees.length) lines.push(`Fees and extras: ${f.fees.join("; ")}.`);
  if (f.leaseTermMonths.length) lines.push(`Lease lengths: ${f.leaseTermMonths.join(", ")} months.`);
  for (const n of f.notes) lines.push(n);
  return lines.join("\n");
}
