/*
 * A lease's blurb: the one or two sentences a landlord adds about THEIR offering
 * — "utilities included, cat-friendly, ask about the garage".
 *
 * It is deliberately short and deliberately optional. It used to be a required
 * free-text box on the way in ("Anything else about your listing"), which made
 * every landlord write something before they could publish and then put what
 * they wrote nowhere a renter would read it. Now it is a detail behind the
 * chevron on the offering it describes, so length is what makes it useful: a
 * paragraph would push the next offering off the screen.
 *
 * The cap applies to new and edited text only. Existing rows were backfilled
 * from listings.description and some run long, so it is enforced here rather
 * than as a column constraint that would refuse to save them.
 */
export const LEASE_DESCRIPTION_MAX = 300;

export function shortDescription(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, LEASE_DESCRIPTION_MAX);
}
