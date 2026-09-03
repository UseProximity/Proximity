import supabase from "@/lib/supabase";
import { auth } from "@/auth";
import { shortDescription } from "@/lib/listings/leaseDescription";
import { claimUnclaimedProperty } from "@/lib/listings/ownership";

// Create a lease on a unit that already exists — step 3 of the
// address -> unit -> lease flow, taken when the address matched a known property
// and the user picked one of its existing units.
//
// The listing (property) and the unit are untouched; this only adds the caller's
// own offering. Owner-specific content (contact, description, furnished) is
// written onto the lease, so it never overwrites what another landlord at the
// same property has published.
//
// One thing it can change: a property nobody owns — a review stub carrying the
// Proximity placeholder, or an import with no landlord row — is handed to a
// landlord publishing a real (non-sublease) offering on it. This is the step
// where sublease is actually known, which is why the claim is tried here as well
// as on unit creation. See claimUnclaimedProperty.
//
// @auth user
export async function POST(req) {
  const session = await auth();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return Response.json({ error: "Invalid request body." }, { status: 400 });

  const {
    unitId,
    rent,
    rentIsPerPerson,
    leaseTermMonths,
    sublease = false,
    available = true,
    // The date this offering opens. It was collected on the way in but never
    // read here, so every lease created through the flow landed with a null
    // available_from and came back reading "Available now".
    availableFrom,
    description,
    furnished,
    contactEmail,
    contactPhone,
    contactName,
  } = body;

  if (!unitId) {
    return Response.json({ error: "A unit is required." }, { status: 400 });
  }

  // A renter has to be able to reach someone. An offering with no contact is
  // unanswerable, so it is not one we accept — the client pre-fills the
  // landlord's own address, which makes this a guard rather than a chore.
  if (!contactEmail?.trim()) {
    return Response.json(
      { error: "A contact email is required so students can reach you." },
      { status: 400 }
    );
  }

  // Confirm the unit exists and is live before writing against it.
  const { data: unit, error: unitError } = await supabase
    .from("listing_units")
    .select("id, listing_id, deleted_at")
    .eq("id", unitId)
    .maybeSingle();

  if (unitError) {
    console.error("[leases] Unit lookup failed:", unitError.message);
    return Response.json({ error: "Could not verify that unit." }, { status: 500 });
  }
  if (!unit || unit.deleted_at) {
    return Response.json({ error: "That unit no longer exists." }, { status: 404 });
  }

  const terms = Array.isArray(leaseTermMonths)
    ? leaseTermMonths.map(Number).filter((m) => Number.isFinite(m) && m > 0)
    : [];

  const { data: lease, error } = await supabase
    .from("unit_leases")
    .insert({
      unit_id: unitId,
      owner_id: session.user.id,
      rent: rent != null && rent !== "" ? Number(rent) : null,
      // Recorded rather than inferred — see 202608240004.
      rent_is_per_person: rentIsPerPerson == null ? null : !!rentIsPerPerson,
      lease_term_months: terms,
      sublease: !!sublease,
      is_active: true,
      unavailable: available === false,
      available_from: availableFrom || null,
      description: shortDescription(description),
      furnished: furnished ?? null,
      contact_email: contactEmail.trim(),
      contact_phone: contactPhone || null,
      contact_name: contactName || null,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[leases] Insert failed:", error.message);
    return Response.json({ error: "Could not create that lease." }, { status: 500 });
  }

  const claimed = await claimUnclaimedProperty({
    userId: session.user.id,
    listingId: unit.listing_id,
    sublease: !!sublease,
  });

  return Response.json(
    {
      message: "Lease created",
      lease: { id: lease.id, listingId: unit.listing_id },
      claimedProperty: claimed,
    },
    { status: 201 }
  );
}
