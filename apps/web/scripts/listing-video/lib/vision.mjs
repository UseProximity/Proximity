/*
 * Stage A (classify/filter) and Stage C (adjacency scoring) vision calls.
 * Follows the established client/structured-output/cost-logging pattern from
 * src/lib/leaseCheck/analyzeLease.js. Both stages cache their results on disk, so
 * re-runs make zero API calls until the image set changes.
 */
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { anthropicKey } from "./env.mjs";
import { readJson, writeJson } from "./cache.mjs";

export const CURATOR_MODEL = "claude-sonnet-5";

let _client = null;
function getClient() {
  const key = anthropicKey();
  if (!key) {
    throw new Error("No Anthropic key: set LISTING_VIDEO_KEY or LEASE_SCANNER_KEY in apps/web/.env.local");
  }
  if (!_client) _client = new Anthropic({ apiKey: key });
  return _client;
}

// claude-sonnet-5 pricing, USD per token (same table as leaseCheck).
const SONNET5_PRICE = {
  input: 3.0 / 1e6,
  output: 15.0 / 1e6,
  cacheRead: 0.3 / 1e6,
  cacheWrite: 3.75 / 1e6,
};

let visionSpendUsd = 0;
export function getVisionSpendUsd() {
  return visionSpendUsd;
}

function logCost(tag, usage) {
  if (!usage) return;
  const cost =
    (usage.input_tokens ?? 0) * SONNET5_PRICE.input +
    (usage.output_tokens ?? 0) * SONNET5_PRICE.output +
    (usage.cache_read_input_tokens ?? 0) * SONNET5_PRICE.cacheRead +
    (usage.cache_creation_input_tokens ?? 0) * SONNET5_PRICE.cacheWrite;
  visionSpendUsd += cost;
  console.log(
    `  [vision] ${tag} $${cost.toFixed(4)} (in:${usage.input_tokens ?? 0} out:${usage.output_tokens ?? 0})`
  );
}

const SPACES = [
  "exterior_front", "exterior_rear", "entry_hall", "living", "dining", "kitchen",
  "hallway", "stairwell", "bedroom", "bathroom", "laundry", "closet", "balcony_patio",
  "amenity_gym", "amenity_lounge", "amenity_pool", "parking", "view_window", "detail",
  "other",
];

const ClassificationSchema = z.object({
  images: z.array(
    z.object({
      index: z.number(),
      content_type: z.enum(["photo", "rendering", "floorplan", "graphic", "map", "logo"]),
      space: z.enum(SPACES),
      shot_type: z.enum(["wide", "medium", "detail"]),
      quality: z.enum(["usable", "dark", "blurry", "cluttered"]),
      has_people: z.boolean(),
      furnished: z.boolean(),
      palette_cluster: z.string(),
      focal_feature: z.string(),
    })
  ),
  mixed_unit_finishes: z.boolean(),
  minority_finish_indexes: z.array(z.number()),
});

const CLASSIFY_SYSTEM = `You classify real-estate listing photos for an automated video pipeline. Be strict and literal — this feeds legal-compliance filtering.

Definitions:
- content_type: "photo" = a real photograph of a real space. "rendering" = a computer-generated / architectural visualization image (CGI, too-perfect surfaces, staged 3D furniture, watermarks like "rendering"). "floorplan" = a floor plan or diagram. "graphic" = marketing graphic, collage, or text-heavy image. "map" = a map. "logo" = a logo or brand image.
- space: the space shown. Use exterior_front for street-facing building shots, exterior_rear for courtyards/back. Use detail ONLY in shot_type, not as a space, unless nothing else fits ("detail" space is for close-ups of fixtures/finishes with no room context).
- shot_type: "wide" shows most of a room, "medium" shows part of it, "detail" is a close-up. If the frame is dominated by a single surface or fixture — a tile wall, tub surround, backsplash, countertop, appliance, or piece of furniture — with little room context (no visible floor-wall-ceiling structure), it is "detail" even when the surface fills the entire frame.
- quality: "usable" unless clearly dark, blurry, or so cluttered it would look bad in a marketing video.
- has_people: true if any person or recognizable body part is visible.
- palette_cluster: a short label (2-4 words) describing the finish/color scheme, e.g. "white walls light oak". Use the SAME label for images that clearly belong to the same unit/finish scheme.
- focal_feature: the single most camera-worthy feature IN this photo that a slow camera move should push toward, as a short noun phrase with position, e.g. "the arched front door", "the kitchen island", "the bay windows". Must be something actually visible in the photo.
- furnished: true if the space contains furniture/staging; false for vacant/empty rooms. For exteriors and spaces where the question makes no sense, use true.
- mixed_unit_finishes: true only if the set clearly mixes photos of two or more DIFFERENT units with different finish schemes (not just different rooms). If true, list the indexes of the smaller group in minority_finish_indexes; otherwise [].

When unsure between photo and rendering, choose rendering — a rendering published as a walkthrough is a legal risk; losing one real photo is not.`;

/*
 * One pass over all images (each ~768px). Returns the parsed classification keyed back
 * to image ids, or null if the call/parse failed (caller falls back deterministically).
 */
export async function classifyImages(images, cacheFile) {
  // v4: added furnished flag — version the key so stale caches re-classify.
  const cacheKey = "v4:" + images.map((i) => i.id).join(",");
  const cached = readJson(cacheFile);
  if (cached && cached.cacheKey === cacheKey) return cached;

  const content = [];
  images.forEach((img, k) => {
    content.push({ type: "text", text: `Image ${k}:` });
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: fs.readFileSync(img.visionPath).toString("base64"),
      },
    });
  });
  content.push({
    type: "text",
    text: `Classify all ${images.length} images (indexes 0..${images.length - 1}). Return one entry per image.`,
  });

  try {
    const response = await getClient().messages.parse({
      model: CURATOR_MODEL,
      max_tokens: 16000,
      output_config: { format: zodOutputFormat(ClassificationSchema) },
      system: [{ type: "text", text: CLASSIFY_SYSTEM }],
      messages: [{ role: "user", content }],
    });
    logCost("classify", response.usage);
    if (!response.parsed_output) return null;
    if (response.parsed_output.images.length !== images.length) return null;
    const result = { cacheKey, ...response.parsed_output };
    writeJson(cacheFile, result);
    return result;
  } catch (err) {
    console.warn(`  [vision] classify failed: ${err.message}`);
    return null;
  }
}

const AdjacencySchema = z.object({
  score: z.number(),
  reason: z.string(),
});

const ADJACENCY_SYSTEM = `You judge whether two real-estate photos can be bridged by an AI camera move. Do these two photographs show overlapping physical space — a shared wall, a visible doorway between them, a continuous floor, or a sightline from one into the other?

Score 0-3:
0 = unrelated spaces, no visible connection.
1 = plausibly nearby but nothing visibly shared.
2 = visible connection (a doorway, shared wall, or continuous floor links them).
3 = clearly the same space from a different angle, or one photo visibly looks into the space shown in the other.

Reply with the score and a reason under 15 words.`;

/*
 * Scores one consecutive pair. Cached per (fromId,toId) in adjacencyFile.
 * Returns { score, reason } or null on failure (caller treats the pair as safe).
 */
export async function scorePair(fromImage, toImage, adjacencyFile) {
  const key = `${fromImage.id}->${toImage.id}`;
  const cache = readJson(adjacencyFile, {});
  if (cache[key]) return cache[key];

  try {
    const response = await getClient().messages.parse({
      model: CURATOR_MODEL,
      max_tokens: 2000,
      output_config: { format: zodOutputFormat(AdjacencySchema) },
      system: [{ type: "text", text: ADJACENCY_SYSTEM }],
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Photo A:" },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/jpeg",
                data: fs.readFileSync(fromImage.visionPath).toString("base64"),
              },
            },
            { type: "text", text: "Photo B:" },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/jpeg",
                data: fs.readFileSync(toImage.visionPath).toString("base64"),
              },
            },
            { type: "text", text: "Score this pair." },
          ],
        },
      ],
    });
    logCost(`adjacency ${key.slice(0, 8)}…`, response.usage);
    if (!response.parsed_output) return null;
    const result = {
      score: Math.max(0, Math.min(3, Math.round(response.parsed_output.score))),
      reason: response.parsed_output.reason,
    };
    cache[key] = result;
    writeJson(adjacencyFile, cache);
    return result;
  } catch (err) {
    console.warn(`  [vision] adjacency ${key.slice(0, 8)}… failed: ${err.message}`);
    return null;
  }
}
