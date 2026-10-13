export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";

/*
 * One contact per landlord per property.
 *
 * A lease row still carries its own contact_name / contact_email /
 * contact_phone, and browse still reads them: that is how imported leases with
 * no account behind them stay reachable. But a landlord with an account no
 * longer sets them one offering at a time. They set this block once per
 * property and it is written to every lease they own there, so a renter sees
 * one landlord with several options rather than several identical contacts,
 * and an enquiry about any of them lands in the same inbox.
 *
 * Scoped by owner_id, never by listing_landlords: subletters and landlords at a
 * property they do not own have leases here too, and the block is theirs for
 * their own leases only. Other people's leases at the same property are out of
 * reach by construction, not by a check.
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

  const { listingId } = await params;
  if (!UUID_RE.test(listingId ?? "")) {
    return NextResponse.json({ error: "That isn't a valid property id." }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  const contact = {
    contact_name: text(body.contactName),
    contact_email: text(body.contactEmail),
    contact_phone: text(body.contactPhone),
  };
  // A renter has to be able to reach someone, so this is the one field that
  // cannot be cleared. Same rule the per-lease routes apply.
  if (!contact.contact_email || !contact.contact_email.includes("@")) {
    return NextResponse.json(
      { error: "A contact email is required so students can reach you." },
      { status: 400 }
    );
  }

  const { data: units, error: unitsErr } = await supabase
    .from("listing_units")
    .select("id")
    .eq("listing_id", listingId)
    .is("deleted_at", null);
  if (unitsErr) {
    console.error("[listings/contact] units lookup failed:", unitsErr.message);
    return NextResponse.json({ error: "Could not save that contact." }, { status: 500 });
  }
  const unitIds = (units ?? []).map((u) => u.id);
  if (!unitIds.length) {
    return NextResponse.json({ error: "You don't have a listing at this property." }, { status: 404 });
  }

  // Withdrawn leases are included on purpose: restoring one later should not
  // bring back a stale address. Deleted ones are not; they are kept only for
  // enquiry history and must read as they did at the time.
  const { data: updated, error } = await supabase
    .from("unit_leases")
    .update(contact)
    .eq("owner_id", session.user.id)
    .in("unit_id", unitIds)
    .is("deleted_at", null)
    .select("id");
  if (error) {
    console.error("[listings/contact] update failed:", error.message);
    return NextResponse.json({ error: "Could not save that contact." }, { status: 500 });
  }
  if (!updated?.length) {
    return NextResponse.json({ error: "You don't have a listing at this property." }, { status: 404 });
  }

  return NextResponse.json({ message: "Contact saved", updated: updated.length });
}
