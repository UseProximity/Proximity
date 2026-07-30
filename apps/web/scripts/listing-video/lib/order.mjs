/*
 * Stage A filtering + Stage B route ordering + §5 eligibility. Pure functions over the
 * classification output; every drop is recorded with a reason for the R4 manifest.
 */
import { dhash, hamming } from "./ffmpeg.mjs";

/* Canonical tour order (§4.2) — the order a human would walk and film the place. */
const SPACE_PRIORITY = [
  "exterior_front", "entry_hall", "living", "dining", "kitchen", "hallway", "stairwell",
  "bedroom", "bathroom", "laundry", "closet", "balcony_patio", "amenity_lounge",
  "amenity_gym", "amenity_pool", "parking", "view_window", "exterior_rear",
  "detail", "other",
];

const SHOT_PREFERENCE = { wide: 0, medium: 1, detail: 2 };
const MAX_PER_SPACE = 2;
const DUPLICATE_HAMMING = 6;

/*
 * Applies the §4.1 rejects, mixed-unit minority drop, §4.2 ordering + per-space caps +
 * dHash dedupe. Returns { ordered, filteredOut } where ordered entries carry the
 * classification fields.
 */
export async function filterAndOrder(images, classification) {
  const filteredOut = [];
  const keep = [];

  const minority = new Set(
    classification.mixed_unit_finishes ? classification.minority_finish_indexes : []
  );

  classification.images.forEach((c, k) => {
    const img = images[k];
    if (!img) return;
    const entry = { ...img, ...c };
    let reason = null;
    if (c.content_type !== "photo") reason = c.content_type; // floorplan | rendering | graphic | map | logo (R2)
    else if (c.quality !== "usable") reason = c.quality;
    else if (c.has_people) reason = "has_people";
    else if (c.shot_type === "detail" || c.space === "detail") reason = "detail_shot";
    else if (minority.has(k)) reason = "mixed_unit_minority";
    // Parking/garage shots don't sell apartments and judge poorly on video
    // (alley clutter, cars, beat-up doors) — stills-only content.
    if (!reason && c.space === "parking") reason = "parking_shot";
    if (reason) filteredOut.push({ id: img.id, url: img.url, reason });
    else keep.push(entry);
  });

  // Route order: canonical space priority, then wide before medium, then original order.
  keep.sort((a, b) => {
    const pa = SPACE_PRIORITY.indexOf(a.space);
    const pb = SPACE_PRIORITY.indexOf(b.space);
    if (pa !== pb) return pa - pb;
    const sa = SHOT_PREFERENCE[a.shot_type] ?? 9;
    const sb = SHOT_PREFERENCE[b.shot_type] ?? 9;
    if (sa !== sb) return sa - sb;
    return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
  });

  // Staged beats vacant: when a space has both furnished and vacant photos, the
  // vacant ones are duplicates of a worse state — and a generated move between the
  // two states makes furniture dissolve on screen (R3). Drop vacant ones up front.
  const furnishedSpaces = new Set(keep.filter((k) => k.furnished).map((k) => k.space));
  for (let i = keep.length - 1; i >= 0; i--) {
    const entry = keep[i];
    if (entry.furnished === false && furnishedSpaces.has(entry.space)) {
      filteredOut.push({ id: entry.id, url: entry.url, reason: "vacant_duplicate" });
      keep.splice(i, 1);
    }
  }

  // Per-space: dHash dedupe, then cap at MAX_PER_SPACE (all bedrooms group as one
  // space but bedrooms are the one space students want to see — the cap still applies).
  const ordered = [];
  const bySpace = new Map();
  for (const entry of keep) {
    const group = bySpace.get(entry.space) || [];
    if (group.length >= MAX_PER_SPACE) {
      filteredOut.push({ id: entry.id, url: entry.url, reason: "space_cap" });
      continue;
    }
    entry.hash = await dhash(entry.origPath);
    const dup = group.find((g) => hamming(g.hash, entry.hash) <= DUPLICATE_HAMMING);
    if (dup) {
      filteredOut.push({ id: entry.id, url: entry.url, reason: `duplicate_of:${dup.id}` });
      continue;
    }
    group.push(entry);
    bySpace.set(entry.space, group);
    ordered.push(entry);
  }

  // Re-sort: the per-space pass kept insertion order; make the final sequence follow
  // route order strictly (ordered was appended in route order already, so this is a
  // no-op safeguard).
  ordered.sort((a, b) => SPACE_PRIORITY.indexOf(a.space) - SPACE_PRIORITY.indexOf(b.space));

  return { ordered, filteredOut };
}

/*
 * Deterministic fallback when the classifier fails (§4.2): filename keyword heuristics
 * for space, original sort_order otherwise, and the caller must force mode=kenburns.
 */
export function fallbackOrder(images) {
  const KEYWORDS = [
    ["exterior_front", /exterior|front|facade|building/i],
    ["living", /living|lounge|family/i],
    ["dining", /dining/i],
    ["kitchen", /kitchen/i],
    ["bedroom", /bed(?!bath)|br\b/i],
    ["bathroom", /bath|shower/i],
    ["balcony_patio", /balcon|patio|deck|courtyard/i],
  ];
  const guess = (url) => {
    for (const [space, re] of KEYWORDS) if (re.test(url)) return space;
    return "other";
  };
  const ordered = images.map((img) => ({ ...img, space: guess(img.url), shot_type: "wide", quality: "usable" }));
  ordered.sort((a, b) => {
    const pa = SPACE_PRIORITY.indexOf(a.space);
    const pb = SPACE_PRIORITY.indexOf(b.space);
    if (pa !== pb) return pa - pb;
    return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
  });
  return ordered;
}

/*
 * §5 eligibility, evaluated after Stage A filtering.
 * Returns { mode: 'hybrid'|'kenburns'|null, skipReason: string|null }.
 */
export function eligibility({ ordered, imagesTotal, streetViewOnly, classifierFailed }) {
  if (streetViewOnly) return { mode: null, skipReason: "street_view_only" };
  if (imagesTotal === 0) return { mode: null, skipReason: "insufficient_photos" };
  const usable = ordered.length;
  const spaces = new Set(ordered.map((o) => o.space)).size;
  if (usable === 0 && imagesTotal > 0) return { mode: null, skipReason: "no_real_photos" };
  if (usable <= 3) return { mode: null, skipReason: "insufficient_photos" };
  if (classifierFailed) return { mode: "kenburns", skipReason: null };
  if (usable <= 5) return { mode: "kenburns", skipReason: null };
  if (spaces < 3) return { mode: "kenburns", skipReason: null };
  return { mode: "hybrid", skipReason: null };
}
