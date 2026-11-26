/*
 * Stage C: assemble the transition plan from the ordered sequence + adjacency scores.
 * The plan is the R4 provenance manifest's core and everything --dry-run prints.
 */
import { histogram, histSimilarity } from "./ffmpeg.mjs";
import { scorePair } from "./vision.mjs";
import { transitionPrompt, directionFor, soloPrompt } from "./prompt.mjs";

export const MODEL_ID = "fal-ai/kling-video/o3/standard/image-to-video";
export const GENERATED_SECONDS = 5;
export const CLIP_SPEED = 1.4; // playback speedup on generated pair moves
export const SOLO_SPEED = 1.2; // gentler on solos — judge flagged 1.4x as rushed
export const BEAT_SECONDS = 1.5; // quick moving beat for rooms reached via a bridge
export const SAFE_SECONDS = 3; // kenburns-mode slideshows only
export const XFADE_SECONDS = 0.5;
export const TITLE_SECONDS = 1.5;
export const MAX_GENERATED = 16; // per-listing safety cap (spend guard is the real limit)
export const PRICE_PER_SECOND_USD = 0.084; // Kling O3 standard, audio off (verified 2026-07-29)

/* Histogram gate: below this similarity the rooms' light/finish clearly differ, so
 * knock the vision score down one — the mechanical half of §4.3's combined signal. */
const HIST_PENALTY_BELOW = 0.3;

/* Narrative pairs are exempt from the histogram penalty: indoor/outdoor lighting
 * always differs across a front door, but Kling's end frame anchors these to the real
 * photo, and the walk-in moment is the single most valuable shot in the video. */
const NARRATIVE_PAIRS = new Set(["exterior_front>entry_hall", "entry_hall>living"]);

export async function buildPlan({ ordered, mode, adjacencyFile }) {
  const transitions = [];
  for (let i = 0; i < ordered.length - 1; i++) {
    const from = ordered[i];
    const to = ordered[i + 1];
    let visionScore = 0;
    let reason = "kenburns mode — not scored";
    let histSim = null;
    let combined = 0;

    if (mode === "hybrid") {
      const [h1, h2] = await Promise.all([histogram(from.framePath), histogram(to.framePath)]);
      histSim = Number(histSimilarity(h1, h2).toFixed(3));
      const scored = await scorePair(from, to, adjacencyFile);
      if (scored) {
        visionScore = scored.score;
        reason = scored.reason;
      } else {
        visionScore = 0;
        reason = "adjacency call failed — forced safe";
      }
      const narrative = NARRATIVE_PAIRS.has(`${from.space}>${to.space}`);
      combined =
        !narrative && histSim < HIST_PENALTY_BELOW
          ? Math.max(0, visionScore - 1)
          : visionScore;
    }

    transitions.push({
      index: i,
      from: from.id,
      to: to.id,
      from_space: from.space,
      to_space: to.space,
      vision_score: visionScore,
      hist_similarity: histSim,
      score: combined,
      reason,
      kind: "safe", // may be upgraded below
      duration: SAFE_SECONDS,
      direction: directionFor(from.space, to.space),
      prompt: null,
      est_cost_cents: 0,
    });
  }

  if (mode === "hybrid") {
    // v5 director rule (Ben, 2026-07-29): pair moves ONLY at score 3 — the photos
    // visibly show the same space, or one visibly looks into the other. "Likely
    // connected" (score 2) is not knowing: it produced a front-door walk-in that
    // asserted an entry hall we couldn't see (the 7024 case). Everything below 3
    // gets a side-turn whip — edit language, no geography claims — plus solo moves.
    // Narrative pairs (the front-door walk-in and entry→living) are allowed at
    // score 2 — Ben's explicit creative call (2026-07-30): both frames are real,
    // the label discloses the synthesized swing, and it's the signature moment.
    const isNarrative = (t) => NARRATIVE_PAIRS.has(`${t.from_space}>${t.to_space}`);
    const isExterior = (s) => s.startsWith("exterior");
    const candidates = transitions
      .filter((t) => (isNarrative(t) ? t.score >= 2 : t.score >= 3))
      // Staged↔vacant pairs of the same room would melt furniture in/out (R3).
      .filter((t) => ordered[t.index].furnished === ordered[t.index + 1].furnished)
      // A window sightline can score 3 but isn't walkable — a camera "pulling back"
      // through a wall forces Kling into a ghost dissolve. Interior↔exterior never
      // generates outside the narrative door pairs.
      .filter((t) => isNarrative(t) || isExterior(t.from_space) === isExterior(t.to_space))
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.vision_score - a.vision_score ||
          (b.hist_similarity ?? 0) - (a.hist_similarity ?? 0)
      )
      .slice(0, MAX_GENERATED);
    for (const t of candidates) {
      t.kind = "generated";
      t.duration = GENERATED_SECONDS;
      t.direction = directionFor(t.from_space, t.to_space, t.vision_score);
      t.prompt = transitionPrompt(t.from_space, t.to_space, t.vision_score);
      t.est_cost_cents = Math.round(GENERATED_SECONDS * PRICE_PER_SECOND_USD * 100);
    }
  }

  return transitions;
}

export const SOLO_SECONDS = 3;

/*
 * Solo moves: single-photo generated camera moves (no end frame — nothing invented)
 * that give un-bridged rooms real parallax instead of a flat zoom. One is needed for
 * every image that no pair move displays: the opening image (when the first
 * transition is a whip) and each whip arrival not followed by a pair move.
 */
export function buildSolos(ordered, transitions) {
  const solos = [];
  const need = (idx) => {
    const img = ordered[idx];
    solos.push({
      index: idx,
      image_id: img.id,
      space: img.space,
      focal_feature: img.focal_feature || null,
      prompt: soloPrompt(img.focal_feature),
      duration: SOLO_SECONDS,
      est_cost_cents: Math.round(SOLO_SECONDS * PRICE_PER_SECOND_USD * 100),
    });
  };
  if (transitions.length && transitions[0].kind !== "generated") need(0);
  transitions.forEach((t, i) => {
    if (t.kind === "generated") return;
    const next = transitions[i + 1];
    if (!next || next.kind !== "generated") need(t.index + 1);
  });
  return solos;
}

/*
 * v5 estimate: pair moves play at CLIP_SPEED, solos play native, whips ~0.5s.
 */
export function estimateDuration(transitions, solos = []) {
  let total = 0;
  for (const t of transitions) {
    total += t.kind === "generated" ? t.duration / CLIP_SPEED : 0.5;
  }
  total += solos.reduce((a, s) => a + s.duration, 0);
  return Number(total.toFixed(1));
}

export function estimateCostCents(transitions) {
  return transitions.reduce((a, t) => a + t.est_cost_cents, 0);
}

export function buildManifest({ listing, mode, skipReason, ordered, filteredOut, transitions, solos = [], classifierFailed }) {
  return {
    listing_id: listing.id,
    address: listing.address,
    mode,
    skip_reason: skipReason,
    classifier_fallback: !!classifierFailed,
    ordered_images: ordered.map((o) => ({
      id: o.id,
      space: o.space,
      shot_type: o.shot_type,
      palette_cluster: o.palette_cluster ?? null,
    })),
    filtered_out: filteredOut,
    transitions: transitions.map(({ index, ...t }) => t),
    solos,
    est_duration_seconds: transitions.length ? estimateDuration(transitions, solos) : 0,
    est_generation_cost_cents:
      estimateCostCents(transitions) + solos.reduce((a, s) => a + s.est_cost_cents, 0),
    model: MODEL_ID,
    curator_model: "claude-sonnet-5",
    generated_at: new Date().toISOString(),
  };
}

/* Console rendering of the plan — what Ben reviews at the Phase 0 checkpoint. */
export function printPlan(manifest, ordered) {
  const line = (s = "") => console.log(s);
  line();
  line(`════════ ${manifest.address} ════════`);
  line(`mode: ${manifest.mode ?? "SKIP"}${manifest.skip_reason ? ` (${manifest.skip_reason})` : ""}`);
  if (!manifest.mode) return;
  line();
  line(`Route (${ordered.length} images):`);
  ordered.forEach((o, k) => {
    line(`  ${String(k + 1).padStart(2)}. ${o.space.padEnd(14)} ${o.shot_type.padEnd(6)} ${o.id}`);
  });
  if (manifest.filtered_out.length) {
    line();
    line(`Filtered out (${manifest.filtered_out.length}):`);
    for (const f of manifest.filtered_out) line(`  – ${f.id}  ${f.reason}`);
  }
  line();
  line(`Transitions:`);
  for (const t of manifest.transitions) {
    const badge = t.kind === "generated" ? "GEN " : "safe";
    const score =
      t.hist_similarity === null
        ? ""
        : ` score=${t.score} (vision ${t.vision_score}, hist ${t.hist_similarity})`;
    line(`  [${badge}] ${t.from_space} → ${t.to_space}${score}`);
    line(`         ${t.reason}`);
    if (t.kind === "generated") line(`         camera: ${t.direction} · ${t.duration}s · ~$${(t.est_cost_cents / 100).toFixed(2)}`);
  }
  if (manifest.solos?.length) {
    line();
    line(`Solo moves (single-photo, nothing invented):`);
    for (const s of manifest.solos) {
      line(`  [solo] ${s.space} → toward ${s.focal_feature || "room center"} · ${s.duration}s · ~$${(s.est_cost_cents / 100).toFixed(2)}`);
    }
  }
  line();
  const gen = manifest.transitions.filter((t) => t.kind === "generated").length;
  line(
    `Summary: ${manifest.transitions.length} transitions (${gen} pair moves, ` +
      `${manifest.transitions.length - gen} whips) + ${manifest.solos?.length ?? 0} solos · ` +
      `est ${manifest.est_duration_seconds}s · ` +
      `est generation cost $${(manifest.est_generation_cost_cents / 100).toFixed(2)}`
  );
}
