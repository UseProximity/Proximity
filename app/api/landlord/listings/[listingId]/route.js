export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/libs/supabase";

async function requireOwnership(listingId) {
  const session = await auth();
  if (!session?.user?.id) return { err: "Unauthorized", status: 401 };
  if (!["landlord", "super", "student"].includes(session.user.role)) {
    return { err: "Forbidden", status: 403 };
  }
  // super can edit any listing
  if (session.user.role === "super") return { session };

  const { data: own } = await supabase
    .from("listing_landlords")
    .select("listing_id")
    .eq("listing_id", listingId)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (!own) return { err: "Forbidden", status: 403 };
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
        area: u.area ?? null,
      }));

      const { data: insertedUnits, error: unitsError } = await supabase
        .from("listing_units")
        .insert(unitRows)
        .select("id, bedrooms, bathrooms, area");

      if (unitsError) {
        return NextResponse.json({ error: unitsError.message }, { status: 500 });
      }

      // Write rent to unit_leases for each unit that has a rent value
      const leaseRows = (insertedUnits ?? [])
        .map((inserted, idx) => {
          const rent = units[idx]?.rent ?? null;
          if (rent == null) return null;
          return { unit_id: inserted.id, rent, is_active: true };
        })
        .filter(Boolean);

      if (leaseRows.length > 0) {
        const { error: leasesError } = await supabase
          .from("unit_leases")
          .insert(leaseRows);
        if (leasesError) {
          console.error("unit_leases insert error:", leasesError);
          // Non-fatal: unit rows were saved; don't fail the whole request
        }
      }
    }
  }

  const { data: updated } = await supabase
    .from("listings")
    .select("*, listing_units(bedrooms, bathrooms, area)")
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
