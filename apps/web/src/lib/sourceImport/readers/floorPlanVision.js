/*
 * Which of a unit's images is its floor plan diagram.
 *
 * Readers guess the diagram from filenames, and sites make that a guess:
 * Mac suffixes every image of a plan with "_FP", kitchen photos included,
 * so a room photo landed in the floor plan slot. A diagram looks nothing
 * like a photo (white page, black lines), so the pictures decide:
 *
 *   1. every candidate (the guessed diagram and the unit's photos) is
 *      fetched through the asset guard and shrunk; a cheap pixel score
 *      (how white, how grey) ranks them, diagram-like first;
 *   2. the best few go to Haiku, which reads images, with one question:
 *      which one is the architectural floor plan drawing, if any.
 *
 * The answer replaces the guess. "None" empties the slot rather than leave
 * a photo in it, and a guessed diagram that turned out to be a photo joins
 * the photos. One small call per unit, images at 320px, so a building of
 * forty plans costs a few cents.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { fetchAssetResponse, readAssetCapped } from "@/lib/listingDraft/fetchSite";
import { HAIKU, logCost } from "../model.js";

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_CANDIDATES = 14;
const SENT_TO_MODEL = 4;
const CONCURRENCY = 4;
// Filenames that tend to be drawings. Mac ends every image in "_FP", so
// that suffix alone says nothing and is left out.
const NAME_RE = /floor-?plan|floorplan|diagram|layout|[-_]unit[-_]|[-_]plan[-_]/i;

let _client = null;
function getClient() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.LISTING_DRAFT_KEY || process.env.ANTHROPIC_API_KEY });
  return _client;
}

let sharpLoader = null;
function getSharp() {
  if (sharpLoader === null) sharpLoader = import("sharp").then((m) => m.default ?? m).catch(() => false);
  return sharpLoader;
}

const Answer = z.object({
  // 1-based position of the floor plan drawing among the images sent, or
  // null when none of them is one.
  floorPlanImage: z.number().nullable(),
});

// One retry when the answer comes back unreadable. Haiku now and then ends
// its JSON early ("Unterminated string"), and a second ask nearly always
// lands.
const ATTEMPTS = 2;

/* Fetch, shrink to 320px JPEG, and score how diagram-like the pixels are. */
async function prepare(url) {
  let buf;
  let type;
  try {
    const res = await fetchAssetResponse(url);
    type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!/^image\/(png|jpeg|jpg|webp|gif)$/.test(type)) {
      res.body?.cancel?.().catch?.(() => {});
      return null;
    }
    buf = await readAssetCapped(res, MAX_BYTES);
  } catch (err) {
    console.warn(`[source-import] floor plan candidate not fetched (${err?.message}): ${url.slice(0, 100)}`);
    return null;
  }
  if (!buf) return null;
  const sharp = await getSharp();
  if (!sharp) {
    // No sharp on this machine: send the picture as it is (small ones only)
    // and let the model rank without a pixel score.
    if (buf.length > 1.5 * 1024 * 1024) return null;
    return { url, data: buf.toString("base64"), mediaType: type === "image/jpg" ? "image/jpeg" : type, score: 0 };
  }
  try {
    const small = await sharp(buf).rotate().resize({ width: 320, height: 320, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
    const { data, info } = await sharp(buf).resize(40, 40, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let white = 0;
    let sat = 0;
    const n = info.width * info.height;
    for (let i = 0; i < data.length; i += info.channels) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (min > 225) white += 1;
      sat += max ? (max - min) / max : 0;
    }
    // Mostly white and nearly grey is a drawing; a photo is neither.
    const score = white / n - sat / n;
    return { url, data: small.toString("base64"), mediaType: "image/jpeg", score };
  } catch (err) {
    console.warn(`[source-import] floor plan candidate not readable (${err?.message}): ${url.slice(0, 100)}`);
    return null;
  }
}

/*
 * The model's pick among the prepared candidates, or null. Undefined when
 * no readable answer came back: the unit keeps the floor plan it had, so a
 * miss is logged as a warning, not raised as a site error.
 */
async function askModel(unitName, candidates) {
  let lastError = null;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      return await askModelOnce(unitName, candidates);
    } catch (err) {
      lastError = err;
    }
  }
  console.warn(`[source-import] floor plan not checked for ${unitName}, kept as it was (${ATTEMPTS} tries): ${lastError?.message}`);
  return { pick: undefined, cost: 0 };
}

/*
 * One ask. The reply is parsed here rather than by messages.parse, so an
 * unreadable answer says why (stop reason, token count, what came back):
 * the 11/15 failures cut off 9 to 20 characters in, in pairs at the same
 * moment, and the log should show what ended them.
 */
async function askModelOnce(unitName, candidates) {
  const response = await getClient().messages.create({
    model: HAIKU,
    max_tokens: 200,
    output_config: { format: zodOutputFormat(Answer) },
    system:
      "You look at images from an apartment listing and say which one, if any, is the floor plan: an architectural drawing of the apartment's layout (walls, rooms, labels, dimensions), usually black lines on white. Photographs of rooms, buildings, furniture or views are not floor plans, even if they show an empty unit. A rendering or 3D cutaway of the layout counts. Answer with the 1-based position of the floor plan image, or null if none is one.",
    messages: [
      {
        role: "user",
        content: [
          ...candidates.flatMap((c, i) => [
            { type: "text", text: `Image ${i + 1}:` },
            { type: "image", source: { type: "base64", media_type: c.mediaType, data: c.data } },
          ]),
          { type: "text", text: `These are images filed under the floor plan "${unitName}". Which image is the floor plan drawing?` },
        ],
      },
    ],
  });
  const cost = logCost(`floor plan ${unitName}`, HAIKU, response.usage) ?? 0;
  const text = (response.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("");
  let parsed = null;
  try {
    parsed = Answer.parse(JSON.parse(text));
  } catch (err) {
    throw new Error(`unreadable answer (stop: ${response.stop_reason}, ${response.usage?.output_tokens ?? "?"} tokens, got ${JSON.stringify(text.slice(0, 60))}): ${err?.message}`);
  }
  const i = parsed.floorPlanImage;
  return { pick: Number.isInteger(i) && i >= 1 && i <= candidates.length ? candidates[i - 1].url : null, cost };
}

/*
 * Settle one unit's floor plan in place. Returns "kept", "changed",
 * "cleared", "skipped" or "unsure" for the trace.
 */
async function settleUnit(u) {
  const all = [...new Set([u.floorPlanImageUrl, ...(u.photos ?? [])].filter((x) => typeof x === "string" && /^https?:/.test(x)))];
  // Likely drawings first, so a cap on a long photo list never drops one.
  const named = (x) => NAME_RE.test(x.split("/").pop() ?? "");
  const urls = [...all.filter(named), ...all.filter((x) => !named(x))].slice(0, MAX_CANDIDATES);
  if (!urls.length) return "skipped";
  const prepared = (await Promise.all(urls.map(prepare))).filter(Boolean);
  if (!prepared.length) return "skipped";
  // Drawing-like pixels first; a filename that says "floorplan" breaks ties.
  const rank = (c) => c.score + (named(c.url) ? 0.15 : 0);
  prepared.sort((a, b) => rank(b) - rank(a));
  const sent = prepared.slice(0, SENT_TO_MODEL);
  const { pick, cost } = await askModel(u.name ?? "unit", sent);
  u._floorPlanCost = cost;
  if (pick === undefined) return "unsure";
  const before = u.floorPlanImageUrl ?? null;
  if (pick === before) return "kept";
  // The old guess was a photo after all; keep it as one.
  if (before && !(u.photos ?? []).includes(before)) u.photos = [before, ...(u.photos ?? [])];
  u.floorPlanImageUrl = pick;
  if (pick) u.photos = (u.photos ?? []).filter((p) => p !== pick);
  return pick ? "changed" : "cleared";
}

/*
 * Check every unit that has any image. Mutates the units. Returns counts
 * and the model cost for the trace.
 */
export async function confirmFloorPlans(units, { onStep = () => {} } = {}) {
  const todo = units.filter((u) => u.floorPlanImageUrl || (u.photos ?? []).length);
  const result = { checked: 0, kept: 0, changed: 0, cleared: 0, unsure: 0, costUsd: 0 };
  if (!todo.length) return result;
  onStep(`Checking floor plan diagrams for ${todo.length} unit${todo.length === 1 ? "" : "s"}`);
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const u = todo[cursor++];
      if (!u) return;
      const outcome = await settleUnit(u);
      result.checked += 1;
      result.costUsd += u._floorPlanCost ?? 0;
      delete u._floorPlanCost;
      if (outcome in result) result[outcome] += 1;
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
  console.log(`[source-import] floor plans: ${result.checked} units checked, ${result.kept} kept, ${result.changed} changed, ${result.cleared} cleared, ${result.unsure} unsure, $${result.costUsd.toFixed(3)}`);
  return result;
}
