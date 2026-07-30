/*
 * Stage D assembly: title card + segments + crossfades, then the two finalized renders
 * (watermarked/free and clean/paid — both carry the R1 disclosure label) plus poster.
 */
import path from "node:path";
import {
  kenburnsSegment,
  stitch,
  finalize,
  extractPoster,
  probe,
  speedClip,
  bridgeOut,
  bridgeIn,
  KENBURNS_CYCLE,
  BLUR,
} from "./ffmpeg.mjs";
import { SAFE_SECONDS, BEAT_SECONDS, CLIP_SPEED, SOLO_SPEED } from "./plan.mjs";

const STATE_ABBREV = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS",
  kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA",
  michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT",
  nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
  ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX",
  utah: "UT", vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV",
  wisconsin: "WI", wyoming: "WY",
};

/* "7307 Delmar Boulevard, University City, Missouri 63130, United States"
 *   → { street: "7307 Delmar Boulevard", cityState: "University City, MO" } */
export function parseAddress(address) {
  const parts = (address || "").split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { street: "", cityState: "" };
  const street = parts[0];
  const city = parts[1] || "";
  let state = "";
  if (parts[2]) {
    const words = parts[2].replace(/\d{5}(-\d{4})?/g, "").trim();
    state = STATE_ABBREV[words.toLowerCase()] || words;
  }
  return { street, cityState: city ? (state ? `${city}, ${state}` : city) : "" };
}

/*
 * transitions: the plan; clipPaths: Map(transition index → normalized generated clip).
 * Any generated transition without a clip renders as safe (downgrade path, §5).
 * Returns { watermarkedPath, cleanPath, posterPath, durationSeconds, segments }.
 */
/* Kling ends clips near — not exactly on — the target photo, so every joint that
 * touches a generated clip crossfades briefly to absorb the drift (the ~0:22 "pop"
 * fix). Bridge internals use faster blends; the punch lands through a white flash. */
const DRIFT_FADE = { transition: "fade", duration: 0.18 };
const SNAP_FADE = { transition: "fade", duration: 2 / 30 };
const HARD_CUT = { transition: "fade", duration: 1 / 30 };
const FLASH = { transition: "fadewhite", duration: 4 / 30 };

/*
 * connectedTour: chains-only assembly (Ben, 2026-07-30). Only generated pair moves
 * appear, hard-cut between chains; no solos, whips, or beats — rooms without
 * verified footage don't appear at all. Small catalog of good videos > full
 * coverage of mediocre ones.
 */
export async function renderVideo({ listing, ordered, transitions, clipPaths, soloPaths, dirs, bridgeStyle = "whip", connectedTour = false }) {
  const segments = [];
  const segmentMeta = [];
  const boundaries = []; // joint between segment i and i+1
  let pendingJoint = null; // set by a blur bridge that emits no segments of its own
  const push = (file, meta, joint) => {
    if (segments.length > 0) boundaries.push(pendingJoint || joint);
    pendingJoint = null;
    segments.push(file);
    segmentMeta.push(meta);
  };
  const isGen = (t) => t?.kind === "generated" && clipPaths?.has(t.index);
  let cycleIndex = 0;

  if (!transitions.some(isGen)) {
    // kenburns mode (or every clip failed): moving slideshow with blur-throughs.
    for (let i = 0; i < ordered.length; i++) {
      const seg = path.join(dirs.segs, `kb-${i}.mp4`);
      await kenburnsSegment(ordered[i].masterPath, seg, KENBURNS_CYCLE[cycleIndex++ % KENBURNS_CYCLE.length], SAFE_SECONDS);
      push(seg, { kind: "safe", image: ordered[i].id }, BLUR);
    }
  } else {
    // v5 assembly. Invariant: after transition i, the screen shows ordered[i+1].
    // Rooms are shown by pair moves or solo moves (both real Kling footage — one
    // matched look); whips are the only edit language between unproven spaces.
    // A solo that failed to generate degrades to a kenburns beat (never blocks).
    let shownImageId = null; // photo the screen currently ends on (joint decisions)
    const showRoom = async (imageIndex, joint) => {
      const solo = soloPaths?.get(imageIndex);
      shownImageId = ordered[imageIndex].id;
      if (solo) {
        // Slight speedup keeps energy without feeling rushed (~2.5s on screen).
        const sped = path.join(dirs.segs, `solo-${imageIndex}.mp4`);
        await speedClip(solo, sped, SOLO_SPEED);
        push(sped, { kind: "solo", image: ordered[imageIndex].id, speed: SOLO_SPEED }, joint);
      } else {
        const beat = path.join(dirs.segs, `beat-${imageIndex}.mp4`);
        await kenburnsSegment(ordered[imageIndex].masterPath, beat, "push_in", BEAT_SECONDS);
        push(beat, { kind: "beat_fallback", image: ordered[imageIndex].id }, joint);
      }
    };

    if (!isGen(transitions[0]) && !connectedTour) await showRoom(0, DRIFT_FADE);

    for (let i = 0; i < transitions.length; i++) {
      const t = transitions[i];
      const from = ordered[t.index];
      const to = ordered[t.index + 1];

      if (isGen(t)) {
        // DRIFT_FADE only when the screen already shows this clip's start photo
        // (absorbs Kling's end-frame drift invisibly). Coming from a DIFFERENT room,
        // a fade reads as amateur double-exposure ghosting — hard cut instead.
        const continuous = shownImageId === ordered[t.index].id;
        const joint = continuous
          ? DRIFT_FADE
          : bridgeStyle === "blur"
            ? BLUR
            : HARD_CUT;
        // The door walk-in runs extra fast (Ben, 2026-07-30): a quick cut-through
        // makes no claim about what's behind the door; lingering would.
        const isDoorMoment = t.from_space === "exterior_front" && t.to_space === "entry_hall";
        const speed = isDoorMoment ? 1.8 : CLIP_SPEED;
        const spedClip = path.join(dirs.segs, `gen-${t.index}.mp4`);
        await speedClip(clipPaths.get(t.index), spedClip, speed);
        push(spedClip, { kind: "generated", from: t.from, to: t.to, speed }, joint);
        shownImageId = ordered[t.index + 1].id;
        continue;
      }

      // Connected tour: unverified gaps contribute nothing — the next chain's first
      // clip lands on a clean hard cut (existing joint logic handles the mismatch).
      if (connectedTour) continue;

      // Bridge from `from` (on screen now) into `to` — edit language only. "cut"
      // (the Gemini judge's recommendation, standard tour grammar) adds no segments:
      // the joint itself is a clean hard cut.
      if (bridgeStyle !== "blur" && bridgeStyle !== "cut") {
        const out = path.join(dirs.segs, `bridge-out-${t.index}.mp4`);
        const into = path.join(dirs.segs, `bridge-in-${t.index}.mp4`);
        await bridgeOut(from.masterPath, out, bridgeStyle);
        await bridgeIn(to.masterPath, into, bridgeStyle);
        push(out, { kind: "bridge_out", style: bridgeStyle, image: from.id }, SNAP_FADE);
        push(into, { kind: "bridge_in", style: bridgeStyle, image: to.id }, bridgeStyle === "punch" ? FLASH : SNAP_FADE);
      }

      const arrivalJoint =
        bridgeStyle === "blur" ? BLUR : bridgeStyle === "cut" ? HARD_CUT : SNAP_FADE;
      if (isGen(transitions[i + 1])) {
        // Next pair move opens on `to`'s exact photo — it shows the room itself.
        if (bridgeStyle === "blur" || bridgeStyle === "cut") pendingJoint = arrivalJoint;
      } else {
        await showRoom(t.index + 1, arrivalJoint);
      }
    }
  }

  const base = path.join(dirs.segs, "base.mp4");
  await stitch(segments, base, boundaries);

  const watermarkedPath = path.join(dirs.out, `${listing.id}.watermarked.mp4`);
  const cleanPath = path.join(dirs.out, `${listing.id}.clean.mp4`);
  const posterPath = path.join(dirs.out, `${listing.id}.poster.jpg`);
  await finalize(base, watermarkedPath, { watermark: true }, dirs.segs);
  await finalize(base, cleanPath, { watermark: false }, dirs.segs);
  await extractPoster(watermarkedPath, posterPath, 1.0);

  const durationSeconds = Number((await probe(watermarkedPath)).duration.toFixed(1));
  return { watermarkedPath, cleanPath, posterPath, durationSeconds, segments: segmentMeta };
}
