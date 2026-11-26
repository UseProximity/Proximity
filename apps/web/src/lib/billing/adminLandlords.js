/*
 * Finding a landlord, and their properties and leases, for the admin billing
 * tools that act on one landlord (uploading an agreement for them, creating a
 * charge). Light queries, unlike landlordOverview.js, which loads everything.
 *
 *   searchLandlords(db, query)       up to 20 landlord accounts by name, email or company
 *   landlordProperties(db, userId)   their properties, each with its leases
 *
 * `db` is a service-role Supabase client.
 */
import { BillingError } from "./errors.js";
import { displayAddress, unitLabel } from "./coverage.js";
import { leaseLabel } from "./chargeDisplay.js";

const LIMIT = 20;

// Characters that mean something inside a PostgREST or() filter or an ilike pattern.
const cleanQuery = (q) => String(q ?? "").replace(/[,()*%_\\]/g, " ").trim().slice(0, 80);

export async function searchLandlords(db, query) {
  const q = cleanQuery(query);
  let req = db
    .from("users")
    .select("id, name, email, company_name, roles!role_id!inner(name)")
    .eq("roles.name", "landlord")
    .is("deleted_at", null)
    .order("name", { ascending: true, nullsFirst: false })
    .limit(LIMIT);
  if (q) req = req.or(`name.ilike.*${q}*,email.ilike.*${q}*,company_name.ilike.*${q}*`);
  const { data, error } = await req;
  if (error) throw error;
  return data.map((u) => ({ id: u.id, name: u.name ?? null, email: u.email ?? null, company: u.company_name ?? null }));
}

/*
 * Every property the landlord is on (as a listing landlord or through a lease
 * they own), published or not: a lease signed on a property since taken down is
 * still chargeable. Each with the leases they own on it, for the charge's lease.
 */
export async function landlordProperties(db, userId) {
  const { data: user, error: userError } = await db
    .from("users")
    .select("id, deleted_at, roles!role_id(name)")
    .eq("id", userId)
    .maybeSingle();
  if (userError) throw userError;
  if (!user || user.deleted_at || user.roles?.name !== "landlord") {
    throw new BillingError("bad_landlord", "That landlord was not found.", 404);
  }

  const [linked, leases] = await Promise.all([
    db
      .from("listing_landlords")
      .select("listing:listings!listing_id(id, title, address, city, state, zipcode, deleted_at)")
      .eq("user_id", userId)
      .limit(500),
    db
      .from("unit_leases")
      .select(
        "id, rent, lease_term_months, deleted_at, listing_units!unit_id(name, title, unit_designator, unit_number, bedrooms, listing:listings!listing_id(id, title, address, city, state, zipcode, deleted_at))"
      )
      .eq("owner_id", userId)
      .is("deleted_at", null)
      .limit(1000),
  ]);
  if (linked.error) throw linked.error;
  if (leases.error) throw leases.error;

  const byListing = new Map();
  const add = (listing) => {
    if (!listing || listing.deleted_at) return null;
    if (!byListing.has(listing.id)) {
      byListing.set(listing.id, { listingId: listing.id, address: displayAddress(listing), leases: [] });
    }
    return byListing.get(listing.id);
  };
  for (const row of linked.data ?? []) add(row.listing);
  for (const lease of leases.data ?? []) {
    const property = add(lease.listing_units?.listing);
    if (!property) continue;
    property.leases.push({
      leaseId: lease.id,
      label: leaseLabel({ lease_term_months: lease.lease_term_months, listing_units: lease.listing_units }) || unitLabel(lease.listing_units) || "Lease",
      rentCents: Number.isFinite(Number(lease.rent)) && Number(lease.rent) > 0 ? Math.round(Number(lease.rent) * 100) : null,
    });
  }
  return [...byListing.values()]
    .map((p) => ({ ...p, leases: p.leases.sort((a, b) => a.label.localeCompare(b.label)) }))
    .sort((a, b) => a.address.localeCompare(b.address));
}
