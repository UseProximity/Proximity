/*
 * What a student (or anything acting for one: the read API, Proxy's context,
 * matchmaking) may see of a listing's knowledge.
 *
 * Student-safe means: the summary, the structured value, which owner's leases
 * it applies to, and when it was last updated. Never the source, the excerpt,
 * a URL or a "per the website": nothing that names where a fact came from or
 * points a student off Proximity (PRD v3: "How Proxy answers").
 *
 * Left out: low-confidence facts (inferred values are never stated as fact),
 * specials past their valid-until date (checked now, not when loaded), and
 * core provenance rows (the core values themselves are read live elsewhere).
 *
 * Owners are named "Owner A", "Owner B" in the order primary first, then by
 * when they joined the listing, and leases nobody owns are "Unclaimed leases".
 */
import supabase from "@/lib/supabase";
import { currentFacts } from "./store";
import { UNCLAIMED_OWNER_ID, todayChicago, money } from "./sections";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export async function ownerLabels(listingId) {
  const { data } = await supabase
    .from("listing_landlords").select("user_id, is_primary, created_at").eq("listing_id", listingId)
    .order("is_primary", { ascending: false }).order("created_at", { ascending: true });
  const labels = new Map();
  (data ?? []).forEach((o, i) => labels.set(o.user_id, `Owner ${LETTERS[i] ?? i + 1}`));
  labels.set(UNCLAIMED_OWNER_ID, "Unclaimed leases");
  return labels;
}

async function scopeLabels(listingId, facts) {
  const unitIds = [...new Set(facts.filter((f) => f.scope_level === "unit").map((f) => f.scope_id))];
  const leaseIds = [...new Set(facts.filter((f) => f.scope_level === "lease").map((f) => f.scope_id))];
  const units = new Map();
  const leases = new Map();
  if (unitIds.length) {
    const { data } = await supabase.from("listing_units").select("id, name, bedrooms, bathrooms").in("id", unitIds);
    (data ?? []).forEach((u) => units.set(u.id, u.name || `${u.bedrooms ?? "?"} bed, ${u.bathrooms ?? "?"} bath`));
  }
  if (leaseIds.length) {
    const { data } = await supabase
      .from("unit_leases").select("id, rent, listing_units!unit_id(name, bedrooms, bathrooms)").in("id", leaseIds);
    (data ?? []).forEach((l) => {
      const u = l.listing_units;
      const unit = u?.name || `${u?.bedrooms ?? "?"} bed, ${u?.bathrooms ?? "?"} bath`;
      leases.set(l.id, l.rent ? `${unit} at ${money(l.rent)}` : unit);
    });
  }
  return { units, leases };
}

export async function studentFacts(listingId) {
  const facts = await currentFacts(listingId);
  const today = todayChicago();
  const owners = await ownerLabels(listingId);
  const { units, leases } = await scopeLabels(listingId, facts);

  const sections = { fees: [], policies: [], specials: [], misc: [] };
  let verifiedAt = null;
  let updatedAt = null;
  for (const f of facts) {
    if (f.observed_at && (!updatedAt || f.observed_at > updatedAt)) updatedAt = f.observed_at;
    if (f.section === "core") {
      if (f.field_key === "core.verified") verifiedAt = f.value?.verified_at ?? f.observed_at;
      continue;
    }
    if (f.confidence === "low") continue;
    if (f.valid_until && f.valid_until < today) continue;
    const scope = { level: f.scope_level };
    if (f.scope_level === "owner") scope.label = owners.get(f.scope_id) ?? "Another owner";
    else if (f.scope_level === "unit") scope.label = units.get(f.scope_id) ?? "One unit type";
    else if (f.scope_level === "lease") scope.label = leases.get(f.scope_id) ?? "One lease";
    sections[f.section]?.push({
      key: f.field_key,
      summary: f.summary,
      value: f.value,
      scope,
      landlordSet: f.landlord_set,
      updatedAt: f.observed_at,
      validFrom: f.valid_from,
      validUntil: f.valid_until,
    });
  }
  return { listingId, sections, verifiedAt, updatedAt, count: Object.values(sections).reduce((n, a) => n + a.length, 0) };
}
