import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { auth } from "@/auth";
import { canManageLease } from "@/lib/listings/ownership";

/*
 * Manage ONE lease — the counterpart to the property-level routes under
 * /api/landlord/listings/[listingId].
 *
 * This exists because a landlord who attached an offering to someone else's
 * property owns the lease but not the listing. Without it their only options
 * would be no control at all, or property-level control they must not have (that
 * route replaces every unit on the listing and can delete it). So the editable
 * surface here is deliberately narrow: the caller's own offering, nothing that
 * belongs to the property or to another landlord.
 */

// Fields a lease owner may change. Anything not named here — unit_id above all,
// which would move the offering onto a different unit and around the sublease
// guard — is ignored rather than trusted.
const EDITABLE = {
  rent: (v) => (v === null || v === "" ? null : Number(v)),
  description: (v) => (typeof v === "string" ? v.trim() || null : null),
  furnished: (v) => (v == null ? null : !!v),
  contact_name: (v) => (typeof v === "string" ? v.trim() || null : null),
  contact_email: (v) => (typeof v === "string" ? v.trim() || null : null),
  contact_phone: (v) => (typeof v === "string" ? v.trim() || null : null),
  available_from: (v) => v || null,
  unavailable: (v) => !!v,
  is_active: (v) => !!v,
  sublease: (v) => !!v,
  lease_term_months: (v) =>
    Array.isArray(v)
      ? v.map(Number).filter((m) => Number.isFinite(m) && m > 0)
      : [],
};

const BODY_TO_COLUMN = {
  rent: "rent",
  description: "description",
  furnished: "furnished",
  contactName: "contact_name",
  contactEmail: "contact_email",
  contactPhone: "contact_phone",
  availableFrom: "available_from",
  unavailable: "unavailable",
  isActive: "is_active",
  sublease: "sublease",
  leaseTermMonths: "lease_term_months",
};

// @auth user
export async function PATCH(req, { params }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { leaseId } = await params;
  const check = await canManageLease(session.user.id, leaseId);

  if (!check.ok) {
    if (check.reason === "not_found") {
      return NextResponse.json({ error: "That lease no longer exists." }, { status: 404 });
    }
    if (check.reason === "forbidden") {
      return NextResponse.json({ error: "This isn't your lease." }, { status: 403 });
    }
    // A lease id that isn't even a uuid is a bad request, not a server fault.
    if (check.reason === "malformed") {
      return NextResponse.json({ error: "That isn't a valid lease id." }, { status: 400 });
    }
    return NextResponse.json({ error: "Could not load that lease." }, { status: 500 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  const patch = {};
  for (const [key, column] of Object.entries(BODY_TO_COLUMN)) {
    if (key in body) patch[column] = EDITABLE[column](body[key]);
  }

  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const { error } = await supabase
    .from("unit_leases")
    .update(patch)
    .eq("id", leaseId)
    // Re-asserted in the write itself so a lease that changed hands between the
    // check and the update cannot be edited by the previous owner.
    .eq("owner_id", session.user.id);

  if (error) {
    // Raised by unit_leases_sublease_guard: a sublease cannot go live on a unit
    // that already has a live lease.
    if (error.code === "23514" || /sublease/i.test(error.message)) {
      return NextResponse.json(
        {
          error:
            "This unit already has a live lease, so it can't be subleased.",
        },
        { status: 409 }
      );
    }
    console.error("[leases/:id] Update failed:", error.message);
    return NextResponse.json({ error: "Could not update that lease." }, { status: 500 });
  }

  return NextResponse.json({ message: "Lease updated", listingId: check.listingId });
}

/*
 * Withdraw an offering. This is a soft withdrawal (is_active false), not a row
 * delete: the lease is the ownership record for photos and enquiries at this
 * property, and hard-deleting it would strand them.
 *
 * @auth user
 */
export async function DELETE(_req, { params }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { leaseId } = await params;
  const check = await canManageLease(session.user.id, leaseId);

  if (!check.ok) {
    if (check.reason === "not_found") {
      return NextResponse.json({ error: "That lease no longer exists." }, { status: 404 });
    }
    if (check.reason === "forbidden") {
      return NextResponse.json({ error: "This isn't your lease." }, { status: 403 });
    }
    // A lease id that isn't even a uuid is a bad request, not a server fault.
    if (check.reason === "malformed") {
      return NextResponse.json({ error: "That isn't a valid lease id." }, { status: 400 });
    }
    return NextResponse.json({ error: "Could not load that lease." }, { status: 500 });
  }

  const { error } = await supabase
    .from("unit_leases")
    .update({ is_active: false, unavailable: true })
    .eq("id", leaseId)
    .eq("owner_id", session.user.id);

  if (error) {
    console.error("[leases/:id] Withdraw failed:", error.message);
    return NextResponse.json({ error: "Could not withdraw that lease." }, { status: 500 });
  }

  return NextResponse.json({ message: "Lease withdrawn", listingId: check.listingId });
}
