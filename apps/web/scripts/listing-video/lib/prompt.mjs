/*
 * §4.4 prompt template. Fixed wording — the R3 "do not add, remove, or alter" clause is
 * a legal requirement, keep it verbatim. Only {direction} varies, derived from the
 * space pair.
 */

const TEMPLATE = (direction) =>
  `Smoothly blend from the first frame into the second frame. Slow, stable, continuous ` +
  `real-estate walkthrough camera move, ${direction}. Seamless transition. Photorealistic. ` +
  `Do not add, remove, or alter any furniture, fixtures, walls, windows, or architectural ` +
  `features. No people. No text or captions.`;

/* Directions keyed "fromSpace>toSpace"; sparse — DEFAULTS covers the rest. */
const PAIR_DIRECTIONS = {
  "exterior_front>entry_hall":
    "walking toward the front door, the door swings open, and the camera passes through the open doorway inside",
  "entry_hall>living": "moving forward through the doorway, turning slightly",
  "living>dining": "gliding smoothly and steadily across the room on a stabilized rig",
  "living>kitchen": "moving forward toward the kitchen",
  "dining>kitchen": "moving forward into the kitchen",
  "kitchen>hallway": "pulling back out of the kitchen",
  "hallway>bedroom": "moving forward through the doorway",
  "bedroom>bathroom": "moving forward through the doorway",
  "living>hallway": "moving forward into the hallway",
  "balcony_patio>exterior_rear": "pulling back to reveal the exterior",
};

/*
 * visionScore (0-3, optional) disambiguates same-space pairs: 2+ means the two photos
 * verifiably show the same room (pan works); below that they're different rooms of the
 * same type (e.g. two bedrooms) and a pan invites a morph — walk a doorway instead.
 */
export function directionFor(fromSpace, toSpace, visionScore = 3) {
  if (fromSpace === toSpace) {
    return visionScore >= 2
      ? "panning slowly to the right"
      : "moving out through the doorway and into the next room";
  }
  const exact = PAIR_DIRECTIONS[`${fromSpace}>${toSpace}`];
  if (exact) return exact;
  if (toSpace.startsWith("exterior") || toSpace === "balcony_patio") {
    return "pulling back to reveal the space";
  }
  return "moving forward through the doorway";
}

export function transitionPrompt(fromSpace, toSpace, visionScore) {
  return TEMPLATE(directionFor(fromSpace, toSpace, visionScore));
}

/*
 * Solo move: a camera move inside ONE real photo (no end frame) — pushes toward the
 * photo's focal feature with a slight rightward drift so every move in the video
 * shares the same tour direction. Same verbatim R3 clause.
 */
export function soloPrompt(focalFeature) {
  const target = focalFeature || "the center of the room";
  return (
    `Smooth, stable, gimbal-steady real-estate camera move: gliding forward and slightly ` +
    `sideways toward ${target}, with strong realistic parallax — foreground objects, door ` +
    `frames, and furniture visibly shift against the background as the camera travels. ` +
    `Photorealistic. Do not add, remove, or alter any furniture, fixtures, walls, windows, ` +
    `or architectural features. Do not open any doors. No people. No text or captions.`
  );
}
