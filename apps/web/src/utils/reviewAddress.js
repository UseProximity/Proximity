/*
 * Address rules for the review flow, shared by the form and the route so the
 * student is told about a bad pick before they write the review, and the server
 * still refuses it if the form is bypassed.
 *
 * The address search offers three kinds of result: a street address
 * ("6650 Delmar Blvd, ..."), a named place ("Local on Delmar, 6650 Delmar Blvd,
 * ..."), and a bare street ("Delmar Boulevard, ..."). Only the first two say
 * which building is meant. A bare street once became a property called
 * "Delmar Boulevard" with a review on it that belonged to a building three
 * kilometres away.
 */

const startsWithNumber = (segment) => /^\s*\d/.test(segment || "");

/*
 * The part of a picked address that names a building: the address itself when
 * it starts with a street number, the address after the place name when a
 * named place carries one, and null when there is no street number at all.
 */
export function buildingAddress(address) {
  const text = String(address || "").trim();
  if (!text) return null;
  const parts = text.split(",");
  if (startsWithNumber(parts[0])) return text;
  if (startsWithNumber(parts[1])) return parts.slice(1).join(",").trim();
  return null;
}

export const NO_STREET_NUMBER_MESSAGE =
  "Pick an address with a street number, like 6650 Delmar Blvd, so we know which building you mean.";
