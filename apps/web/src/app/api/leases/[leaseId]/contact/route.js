import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { auth } from "@/auth";
import { isPropertyOwner } from "@/lib/listings/ownership";

/*
 * Fix the contact on an imported offering that nobody owns.
 *
 * A lease from the old import has a contact but no account behind it, so
 * canManageLease refuses everyone and the per-landlord block
 * (api/landlord/listings/[listingId]/contact) never reaches it. When its
 * address is wrong or blank, the property's owner is the person who can tell.
 * This route lets them set it, and nothing else on the lease.
 *
 * Owner-held leases stay out of reach: another landlord's offering is theirs
 * to edit, and redirecting it would redirect their enquiries.
 *
 * No confirmation email (Wyatt, 2026-10-12): there are only a few of these,
 * all from the old import.
 *
 * @auth user
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const text = (v) => (typeof v === "string" ? v.trim() || null : null);

export async function PUT(req, { params }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { leaseId } = await params;
  if (!UUID_RE.test(leaseId ?? "")) {
    return NextResponse.json({ error: "That isn't a valid listing id." }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  const contactEmail = text(body.contactEmail);
  // A renter has to be able to reach someone. Same rule the other contact routes apply.
  if (!contactEmail || !contactEmail.includes("@")) {
    return NextResponse.json(
      { error: "A contact email is required so students can reach this landlord." },
      { status: 400 }
    );
  }

  const { data: lease, error } = await supabase
    .from("unit_leases")
    .select("id, owner_id, deleted_at, listing_units!unit_id(listing_id, deleted_at)")
    .eq("id", leaseId)
    .maybeSingle();
  if (error) {
    console.error("[leases/contact] lookup failed:", error.message);
    return NextResponse.json({ error: "Could not save that contact." }, { status: 500 });
  }
  if (!lease || lease.deleted_at || lease.listing_units?.deleted_at) {
    return NextResponse.json({ error: "That listing no longer exists." }, { status: 404 });
  }
  if (lease.owner_id || !(await isPropertyOwner(session.user.id, lease.listing_units?.listing_id))) {
    return NextResponse.json({ error: "You can't change this listing's contact." }, { status: 403 });
  }

  const { error: updateError } = await supabase
    .from("unit_leases")
    .update({ contact_email: contactEmail, contact_name: text(body.contactName) })
    .eq("id", leaseId)
    .is("owner_id", null);
  if (updateError) {
    console.error("[leases/contact] update failed:", updateError.message);
    return NextResponse.json({ error: "Could not save that contact." }, { status: 500 });
  }

  return NextResponse.json({ message: "Contact saved" });
}
