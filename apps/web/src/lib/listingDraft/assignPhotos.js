/*
 * Second pass of the paste-your-website draft: which photos show which floor
 * plan.
 *
 * Kept out of extract.js on purpose. The draft's structured-output schema is at
 * the API's grammar size limit, and adding even one list of photo URLs to each
 * unit made every extraction fail with "the compiled grammar is too large". So
 * the floor plans are read first, and this call, with a schema of a few
 * numbers, files the photos against them afterwards.
 *
 * Photos are referred to by number rather than URL: shorter to write, and a
 * number can only ever point at a photo we offered.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { DRAFT_MODEL } from "./extract.js";

let _client = null;
function getClient() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.LISTING_DRAFT_KEY });
  return _client;
}

const AssignmentSchema = z.object({
  units: z.array(z.object({ unit: z.number(), photos: z.array(z.number()) })),
  shared: z.array(z.number()),
});

const SYSTEM = `You sort a rental property's photos by floor plan for Proximity, a student-housing marketplace. You are given the property's floor plans, numbered, and its candidate photos, numbered, each with its alt text, file name and the page(s) it appeared on.

For each floor plan, list the photos that show the inside of THAT floor plan's apartment: its rooms, kitchen, bathrooms, closets. Put photos of shared spaces (entrance, lobby, hallways, courtyard, gym, storage, bike room, garage, exterior, the building as a whole) in "shared".

Evidence, strongest first: alt text or a caption naming the floor plan or its apartment ("Kitchen in 6219 S"); a file name naming it ("rosebury-6219-s-kitchen.jpg"); a photo that appears only on that floor plan's own page. Never guess. A room photo with nothing tying it to one floor plan goes in "shared" when the property has more than one floor plan, and to the only floor plan when it has one. Leave out logos, maps, people, stock photos and floor-plan diagrams entirely. Keep each list in the order the photos were given. A photo may sit under more than one floor plan only when the site says it shows each of them.`;

/*
 * units: the draft's units (title, bedrooms, bathrooms, area, unitNames).
 * images: [{ url, alt, pages }] as offered to the extraction.
 * Returns { byUnit: string[][] (one list per unit), shared: string[] }, or null
 * when the call failed and the draft should go out without unit photos.
 */
export async function assignPhotosToUnits({ units, images, pages }) {
  if (!units?.length || !images?.length) return null;
  const pageList = (pages ?? []).map((p, i) => `PAGE ${i + 1}: ${p.url}`).join("\n");
  const plans = units
    .map((u, i) => {
      const bits = [
        u.title ? `"${u.title}"` : null,
        u.bedrooms != null ? `${u.bedrooms} bed` : null,
        u.bathrooms != null ? `${u.bathrooms} bath` : null,
        u.area ? `${u.area} sq ft` : null,
        (u.unitNames ?? []).length ? `apartments ${u.unitNames.slice(0, 12).join(", ")}` : null,
      ].filter(Boolean);
      return `${i}: ${bits.join(", ") || "(no details)"}`;
    })
    .join("\n");
  const photos = images
    .map((im, i) => {
      let file = im.url;
      try {
        file = decodeURIComponent(new URL(im.url).pathname.split("/").filter(Boolean).slice(-3).join("/"));
      } catch {
        /* keep the url */
      }
      return `${i}: ${file} | ${im.alt || "(no alt)"} | page(s) ${(im.pages ?? [1]).join(",")}`;
    })
    .join("\n");

  try {
    const response = await getClient().messages.create({
      model: DRAFT_MODEL,
      max_tokens: 8000,
      output_config: { format: zodOutputFormat(AssignmentSchema) },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `PAGES READ:\n${pageList}\n\nFLOOR PLANS:\n${plans}\n\nPHOTOS:\n${photos}`,
        },
      ],
    });
    const u = response.usage ?? {};
    console.log(
      `[listing-draft] photo sort cost $${(((u.input_tokens ?? 0) * 3 + (u.output_tokens ?? 0) * 15) / 1e6).toFixed(4)} ` +
        `(in:${u.input_tokens ?? 0} out:${u.output_tokens ?? 0})`
    );
    const raw = response.content.find((b) => b.type === "text")?.text ?? "";
    const parsed = AssignmentSchema.parse(JSON.parse(raw));
    const urlOf = (n) => (Number.isInteger(n) && images[n] ? images[n].url : null);
    const byUnit = units.map(() => []);
    for (const entry of parsed.units) {
      if (!Number.isInteger(entry.unit) || !byUnit[entry.unit]) continue;
      const urls = entry.photos.map(urlOf).filter(Boolean);
      byUnit[entry.unit] = [...new Set([...byUnit[entry.unit], ...urls])].slice(0, 30);
    }
    const shared = [...new Set(parsed.shared.map(urlOf).filter(Boolean))];
    return { byUnit, shared };
  } catch (err) {
    console.warn("[listing-draft] photo sort failed:", err?.message ?? err);
    return null;
  }
}
