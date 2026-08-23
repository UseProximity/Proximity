import supabase from "@/lib/supabase";
import { auth } from "@/auth";

// Create a lease on a unit that already exists — step 3 of the
// address -> unit -> lease flow, taken when the address matched a known property
// and the user picked one of its existing units.
//
// The listing (property) and the unit are untouched; this only adds the caller's
// own offering. Owner-specific content (contact, description, furnished) is
// written onto the lease, so it never overwrites what another landlord at the
// same property has published.
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
    leaseTermMonths,
    sublease = false,
    available = true,
    description,
    furnished,
    contactEmail,
    contactPhone,
    contactName,
  } = body;

  if (!unitId) {
    return Response.json({ error: "A unit is required." }, { status: 400 });
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
      lease_term_months: terms,
      sublease: !!sublease,
      is_active: true,
      unavailable: available === false,
      description: description?.trim() || null,
      furnished: furnished ?? null,
      contact_email: contactEmail || null,
      contact_phone: contactPhone || null,
      contact_name: contactName || null,
    })
    .select("id")
    .single();

  if (error) {
    // Raised by unit_leases_sublease_guard: a sublease cannot be posted on a
    // unit that is already being offered.
    if (error.code === "23514" || /sublease/i.test(error.message)) {
      return Response.json(
        {
          error:
            "This unit already has a live lease, so it can't be subleased. Pick a different unit, or add a new one.",
        },
        { status: 409 }
      );
    }
    console.error("[leases] Insert failed:", error.message);
    return Response.json({ error: "Could not create that lease." }, { status: 500 });
  }

  return Response.json(
    { message: "Lease created", lease: { id: lease.id, listingId: unit.listing_id } },
    { status: 201 }
  );
}
