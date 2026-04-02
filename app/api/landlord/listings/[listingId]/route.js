export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/libs/supabase";

async function requireOwnership(listingId) {
  const session = await auth();
  if (!session?.user?.id) return { err: "Unauthorized", status: 401 };
  if (!["landlord", "super"].includes(session.user.role)) {
    return { err: "Forbidden", status: 403 };
  }
  // super can edit any listing
  if (session.user.role === "super") return { session };

  const { data: listing, error } = await supabase
    .from("listings")
    .select("id, landlord_id")
    .eq("id", listingId)
    .single();

  if (error || !listing) return { err: "Listing not found", status: 404 };
  if (listing.landlord_id !== session.user.id) return { err: "Forbidden", status: 403 };
  return { session };
}

// PATCH /api/landlord/listings/[listingId] — full update + replace units
export async function PATCH(req, { params }) {
  const { listingId } = await params;
  const check = await requireOwnership(listingId);
  if (check.err) return NextResponse.json({ error: check.err }, { status: check.status });

  const body = await req.json();
  const { units, ...listingFields } = body;

  // Strip immutable fields
  const { id: _id, created_at: _ca, landlord_id: _lid, ...safeUpdates } = listingFields;

  if (Object.keys(safeUpdates).length > 0) {
    const { error: updateError } = await supabase
      .from("listings")
      .update(safeUpdates)
      .eq("id", listingId);
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
  }

  // Replace units wholesale if provided
  if (Array.isArray(units)) {
    await supabase.from("listing_units").delete().eq("listing_id", listingId);
    if (units.length > 0) {
      const unitRows = units.map((u) => ({
        listing_id: listingId,
        bedrooms: u.bedrooms ?? null,
        bathrooms: u.bathrooms ?? null,
        rent: u.rent ?? null,
        area: u.area ?? null,
        lease_availability: u.lease_availability ?? null,
      }));
      const { error: unitsError } = await supabase.from("listing_units").insert(unitRows);
      if (unitsError) {
        return NextResponse.json({ error: unitsError.message }, { status: 500 });
      }
    }
  }

  const { data: updated } = await supabase
    .from("listings")
    .select("*, listing_units(*)")
    .eq("id", listingId)
    .single();

  return NextResponse.json(updated);
}

// DELETE /api/landlord/listings/[listingId]
export async function DELETE(_req, { params }) {
  const { listingId } = await params;
  const check = await requireOwnership(listingId);
  if (check.err) return NextResponse.json({ error: check.err }, { status: check.status });

  const { error } = await supabase.from("listings").delete().eq("id", listingId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
