/*
 * Everything Proxy may know about one listing, as text for the model and as
 * data for routing (PRD v3: "Proxy's context holds only student-safe facts").
 *
 * In: the displayed fields (read live from the listing, unit and lease
 * tables), amenities and utilities, the description, and the knowledge store
 * by section. Each lease is one owner's offering and is labelled with its
 * owner (Owner A, Owner B, Unclaimed leases) so Proxy can say whose terms it
 * is quoting and never merge them.
 *
 * Out: owner and lease contact details, source names and URLs, other
 * students' questions, anything not published.
 */
import supabase from "@/lib/supabase";
import { isLiveLease, publicUnits } from "@/lib/listings/unitAvailability";
import { studentFacts, ownerLabels } from "./studentView";
import { UNCLAIMED_OWNER_ID, money, shortDate } from "./sections";

const AMENITY_LABELS = {
  air_conditioning: "air conditioning", dishwasher: "dishwasher", gym: "gym", laundry: "laundry", mailroom: "mailroom",
  microwave: "microwave", oven: "oven", parking: "parking", pets_allowed: "pets allowed", pool: "pool",
  refrigerator: "refrigerator", rooftop: "rooftop", storage: "storage", stove: "stove", study_room: "study room",
};
const UTILITY_LABELS = { electric: "electric", gas: "gas", heat: "heat", water: "water", internet: "internet", trash: "trash", cable: "cable", sewer: "sewer", cooling: "cooling" };

const SELECT = `
  id, title, address, description, lease_type, lease_structure, furnished, sublease_friendly,
  twenty_one_plus, unavailable, published_at, deleted_at, contact_email,
  home_types!home_type_id(label),
  listing_units!listing_id(id, bedrooms, bathrooms, area, name, sort_order, deleted_at, published_at,
    unit_leases!unit_id(id, rent, is_active, unavailable, sublease, available_from, lease_term_months,
      furnished, owner_id, rent_is_per_person, description, deleted_at, published_at)),
  listing_landlords!listing_id(user_id, is_primary),
  listing_amenities!listing_id(air_conditioning, dishwasher, gym, laundry, mailroom, microwave, oven, parking, pets_allowed, pool, refrigerator, rooftop, storage, stove, study_room),
  listing_utilities!listing_id(electric, gas, heat, water, internet, trash, cable, sewer, cooling),
  listing_custom_amenities!listing_id(label)
`;

function termLabel(months) {
  const t = [...new Set((months ?? []).map(Number).filter((m) => Number.isFinite(m) && m > 0))].sort((a, b) => a - b);
  if (!t.length) return null;
  if (t.length === 1) return `${t[0]}-month lease`;
  return `${t[0]} to ${t[t.length - 1]} month leases`;
}

export async function buildProxyContext(listingId) {
  const { data: row, error } = await supabase.from("listings").select(SELECT).eq("id", listingId).maybeSingle();
  if (error) throw new Error(`proxy context: ${error.message}`);
  if (!row || row.deleted_at) return null;

  const owners = await ownerLabels(listingId);
  const facts = await studentFacts(listingId);
  const units = publicUnits(row.listing_units ?? []).slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  const leases = [];
  const unitLines = [];
  for (const u of units) {
    const live = (u.unit_leases ?? []).filter(isLiveLease);
    const unitName = u.name || `${u.bedrooms ?? "?"} bed, ${u.bathrooms ?? "?"} bath`;
    const specs = [u.bedrooms != null ? `${u.bedrooms} bed` : null, u.bathrooms != null ? `${u.bathrooms} bath` : null, u.area ? `${Number(u.area).toLocaleString()} sq ft` : null].filter(Boolean).join(", ");
    const lines = [`- Unit "${unitName}"${specs ? ` (${specs})` : ""}${live.length ? "" : ": no lease on offer right now"}`];
    for (const l of live) {
      const ownerKey = l.owner_id ?? UNCLAIMED_OWNER_ID;
      const ownerLabel = owners.get(ownerKey) ?? "Unclaimed leases";
      const rent = Number(l.rent) > 0 ? `${money(l.rent)} a month${l.rent_is_per_person ? " per person" : ""}` : "price on request";
      const bits = [rent, termLabel(l.lease_term_months), l.available_from ? `available ${shortDate(l.available_from)}` : "available now",
        l.furnished === true ? "furnished" : l.furnished === false ? "unfurnished" : null, l.sublease ? "a sublease" : null].filter(Boolean);
      const idx = leases.length + 1;
      leases.push({
        id: l.id, unitId: u.id, unitName, ownerId: l.owner_id ?? null, ownerKey, ownerLabel, rent: Number(l.rent) > 0 ? Number(l.rent) : null,
        label: `${unitName}${Number(l.rent) > 0 ? ` at ${money(l.rent)}` : ""}`, index: idx,
      });
      lines.push(`  - Lease ${idx} [${ownerLabel}]: ${bits.join(", ")}${l.description ? `. Notes: ${String(l.description).trim().slice(0, 300)}` : ""}`);
    }
    unitLines.push(lines.join("\n"));
  }

  const amen = Object.entries(row.listing_amenities ?? {}).filter(([, v]) => v === true).map(([k]) => AMENITY_LABELS[k]).filter(Boolean);
  const custom = (row.listing_custom_amenities ?? []).map((a) => a.label).filter(Boolean);
  const utils = Object.entries(row.listing_utilities ?? {}).filter(([, v]) => v === true).map(([k]) => UTILITY_LABELS[k]).filter(Boolean);

  const sectionText = (name, items) => items.length
    ? `${name}:\n${items.map((f) => `- ${f.summary}${f.scope.level !== "property" ? ` [applies to: ${f.scope.label}]` : ""} (updated ${shortDate(f.updatedAt)})`).join("\n")}`
    : `${name}: nothing on record`;

  const text = [
    `LISTING: ${row.title || row.address}${row.title ? `, ${row.address}` : ""}. Type: ${row.home_types?.label ?? "other"}.`,
    row.twenty_one_plus ? "Residents must be 21 or older." : null,
    row.sublease_friendly ? "Subletting is allowed by the property." : null,
    row.description ? `DESCRIPTION (from the listing): ${String(row.description).trim().slice(0, 2500)}` : "DESCRIPTION: none",
    `AMENITIES: ${[...amen, ...custom].join(", ") || "none listed"}`,
    `UTILITIES INCLUDED IN RENT: ${utils.join(", ") || "none listed"}`,
    `UNITS AND LEASES (a lease is one owner's offering; several owners can offer the same building):\n${unitLines.join("\n") || "- no units listed"}`,
    leases.length ? null : "AVAILABILITY: nothing is available right now (no lease on offer).",
    sectionText("FEES", facts.sections.fees),
    sectionText("POLICIES", facts.sections.policies),
    sectionText("SPECIALS AND PROMOTIONS (current)", facts.sections.specials),
    sectionText("OTHER DETAILS", facts.sections.misc),
    facts.verifiedAt ? `The displayed details were last checked on ${shortDate(facts.verifiedAt)}.` : null,
  ].filter(Boolean).join("\n\n");

  const factKeys = new Set();
  for (const items of Object.values(facts.sections)) for (const f of items) factKeys.add(f.key);

  const primaryOwner = (row.listing_landlords ?? []).find((o) => o.is_primary)?.user_id
    ?? (row.listing_landlords ?? [])[0]?.user_id ?? null;

  return {
    listingId,
    title: row.title || row.address,
    address: row.address,
    text,
    leases,
    hasLiveLease: leases.length > 0,
    ownerCount: new Set(leases.map((l) => l.ownerKey)).size,
    primaryOwner,
    contactEmail: row.contact_email ?? null,
    factKeys: [...factKeys],
    facts,
  };
}
