/*
 * Fill-in hints for an import (Wyatt, 2026-11-24): what the read could not
 * find, said calmly and field by field, so the landlord knows where to look
 * rather than being told something went wrong. Fixed templates, no model.
 * Pure.
 */

const money = (n) => `$${Math.round(Number(n)).toLocaleString("en-US")}`;
const list = (names) => (names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`);

/* Up to `max` short hints, most useful first: [text]. */
export function importHints(snapshot, { max = 6 } = {}) {
  const units = (snapshot?.units ?? []).filter((u) => u.available !== false);
  if (!units.length) return ["No units were found on this website yet. You can add them here, or paste a link to the page that lists them."];
  const name = (u) => u.name ?? `${u.bedrooms ?? "?"} bed plan`;
  const starting = units.filter((u) => (u.offers ?? []).length && u.offers.every((o) => o.rentExact === false));
  const unpriced = units.filter((u) => !(u.offers ?? []).some((o) => o.rent != null));
  const noTerms = units.filter((u) => (u.offers ?? []).length && u.offers.every((o) => !(o.leaseTermMonths ?? []).length));
  const guessedTerms = units.filter((u) => (u.offers ?? []).some((o) => o.termsInferred));
  const noDate = units.filter((u) => (u.offers ?? []).length && u.offers.every((o) => !o.availableFrom && !o.availableNow));
  const noLayout = units.filter((u) => u.bedrooms == null || u.bathrooms == null);
  const noSize = units.filter((u) => !u.area);
  const noBasis = units.filter((u) => (u.offers ?? []).some((o) => o.rent != null && o.rentIsPerPerson == null));
  const out = [];
  if (starting.length) out.push(`${list(starting.map(name))}: your site shows a starting-at price (${money(Math.min(...starting.flatMap((u) => u.offers.map((o) => o.rent))))} and up), so it is on the 12 month lease for now. Set the price for each lease length if they differ.`);
  if (unpriced.length) out.push(`${list(unpriced.map(name))}: no price found. Add one, or leave it as price on request.`);
  if (noTerms.length) out.push(`${noTerms.length === units.length ? "No lease lengths were found" : `${list(noTerms.map(name))}: no lease length found`}. Choose them before you publish.`);
  else if (guessedTerms.length) out.push(`Lease lengths for ${list(guessedTerms.map(name))} come from your site's general text, not from each floor plan. A quick check is worth it.`);
  if (noBasis.length) out.push(`${list(noBasis.map(name))}: your site does not say if the price is per person or for the whole unit. It is set as whole unit; switch any that are per person.`);
  if (noDate.length && noDate.length < units.length) out.push(`${list(noDate.map(name))}: no move-in date found.`);
  if (noLayout.length) out.push(`${list(noLayout.map(name))}: bedrooms or bathrooms not found.`);
  if (noSize.length && noSize.length < units.length) out.push(`${list(noSize.map(name))}: size not found.`);
  return out.slice(0, max);
}
