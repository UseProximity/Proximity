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

/*
 * A street number and then a street: "6650 Delmar Blvd", "6650A Delmar",
 * "6650-52 Delmar". A numbered street on its own ("39th Street") starts with
 * a digit too but names no building.
 */
const isStreetAddress = (segment) => {
  const text = String(segment || "").trim();
  if (/^\d+(st|nd|rd|th)\b/i.test(text)) return false;
  return /^\d+[a-z]?(-\d+)?\s+\S/i.test(text);
};

/*
 * The part of a picked address that names a building, or null when there is no
 * street number at all. A named place carries its street address after the
 * name, and the name may itself start with a number ("3949 Apartments, 3949
 * Lindell Blvd, ..."), so a street address in the second part always wins.
 */
export function buildingAddress(address) {
  const text = String(address || "").trim();
  if (!text) return null;
  const parts = text.split(",");
  if (isStreetAddress(parts[1])) return parts.slice(1).join(",").trim();
  if (isStreetAddress(parts[0])) return text;
  return null;
}

export const NO_STREET_NUMBER_MESSAGE =
  "Pick an address with a street number, like 6650 Delmar Blvd, so we know which building you mean.";
