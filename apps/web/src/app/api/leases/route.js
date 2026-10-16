import { after } from "next/server";
import supabase from "@/lib/supabase";
import { auth } from "@/auth";
import { getBaseUrl } from "@/lib/email";
import { requestContactVerification } from "@/lib/chat/contactVerification";
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

  // Terms Section 5: a subletter confirms their own lease lets them sublet.
  // The add flow asks with a checkbox; this holds the line for direct calls.
  if (sublease && body.subleaseRightsConfirmed !== true) {
    return Response.json(
      { error: "Please confirm you have the right to sublet this place." },
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

  /*
   * One contact per landlord per property. A landlord who already lists here
   * has set theirs (api/landlord/listings/[listingId]/contact writes it to
   * every lease they own at the property), so a new offering takes that block
   * rather than whatever the client sent. The form behind this request may be
   * the add flow, prefilled from the same block, or the editor's bare "add
   * another listing" button, which only knows the login email. Either way the
   * right answer is the address students already reach them at. Their first
   * lease at a property is where the block is born, from the body.
   */
  const inherited = await inheritedContact(session.user.id, unit.listing_id);
  const contact = inherited ?? {
    contact_email: contactEmail?.trim() || null,
    contact_phone: contactPhone || null,
    contact_name: contactName || null,
  };

  // A renter has to be able to reach someone. An offering with no contact is
  // unanswerable, so it is not one we accept. The client pre-fills the
  // landlord's own address, which makes this a guard rather than a chore.
  if (!contact.contact_email) {
    return Response.json(
      { error: "A contact email is required so students can reach you." },
      { status: 400 }
    );
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
      ...contact,
      // An offering added to a live unit from the editor starts as a draft, so
      // students never see it half filled in (see 202610100002).
      ...(body.draft === true ? { published_at: null } : {}),
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

  // The lease's contact address only receives message alerts once confirmed.
  // A lease's conversations are held by its owner, which is the caller. Confirm
  // the address the lease was saved with (the inherited block when there is
  // one), never the raw body value, which may not be stored anywhere.
  const baseUrl = getBaseUrl(req);
  after(() =>
    requestContactVerification({
      landlordId: session.user.id,
      email: contact.contact_email,
      baseUrl,
    })
  );

  return Response.json(
    {
      message: "Lease created",
      lease: { id: lease.id, listingId: unit.listing_id },
      claimedProperty: claimed,
    },
    { status: 201 }
  );
}

// The caller's contact block at this property, off the lease of theirs that was
// edited most recently. Null when they have no lease here yet, or none with an
// email (legacy rows that only ever had the property's contact).
async function inheritedContact(userId, listingId) {
  const { data, error } = await supabase
    .from("unit_leases")
    .select("contact_name, contact_email, contact_phone, listing_units!unit_id!inner(listing_id)")
    .eq("owner_id", userId)
    .eq("listing_units.listing_id", listingId)
    .is("deleted_at", null)
    .not("contact_email", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[leases] Contact lookup failed:", error.message);
    return null;
  }
  if (!data?.contact_email?.trim()) return null;
  return {
    contact_email: data.contact_email.trim(),
    contact_phone: data.contact_phone || null,
    contact_name: data.contact_name || null,
  };
}
