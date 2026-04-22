export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/libs/supabase";

// listing_amenities / listing_utilities store one boolean column per option.
// The frontend sends an array of those column names; we flip the matching
// columns true and the rest false on upsert. No display-label mapping.
const AMENITY_COLS = [
  "air_conditioning", "dishwasher", "gym", "laundry", "mailroom",
  "microwave", "oven", "parking", "pets_allowed", "pool",
  "refrigerator", "rooftop", "storage", "stove", "study_room",
];
const UTILITY_COLS = [
  "electric", "gas", "heat", "water", "internet",
  "trash", "cable", "sewer", "cooling",
];

// Columns that still live on `listings` after the 0025 drop migration.
const LISTING_COLS = new Set([
  "title", "address", "longitude", "latitude", "description",
  "lease_type", "home_type_id", "lease_structure", "lease_availability",
  "sublease_friendly", "twenty_one_plus", "furnished",
  "move_in_date", "contact_email", "contact_phone", "contact_name",
  "unavailable", "deleted_at",
]);

function boolRow(cols, selected) {
  const row = Object.fromEntries(cols.map((c) => [c, false]));
  for (const name of selected ?? []) {
    if (typeof name === "string" && cols.includes(name)) row[name] = true;
  }
  return row;
}

async function requireOwnership(listingId) {
  const session = await auth();
  if (!session?.user?.id) return { err: "Unauthorized", status: 401 };
  if (!["landlord", "super", "student"].includes(session.user.role)) {
    return { err: "Forbidden", status: 403 };
  }
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
  const {
    units,
    amenities,
    utilities_included,
    images,
    home_type,
    lease_availability,
    ...rest
  } = body;

  // Only write real listings columns. Anything else (including dropped v3 columns) is ignored.
  const safeUpdates = {};
  for (const [k, v] of Object.entries(rest)) {
    if (LISTING_COLS.has(k)) safeUpdates[k] = v;
  }

  // home_type (label) → home_type_id (FK)
  if (home_type !== undefined) {
    if (home_type === null || home_type === "") {
      safeUpdates.home_type_id = null;
    } else {
      const { data: htRow } = await supabase
        .from("home_types")
        .select("id")
        .ilike("label", home_type)
        .maybeSingle();
      if (htRow?.id) safeUpdates.home_type_id = htRow.id;
    }
  }

  if (Object.keys(safeUpdates).length > 0) {
    const { error: updateError } = await supabase
      .from("listings")
      .update(safeUpdates)
      .eq("id", listingId);
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
  }

  if (amenities !== undefined) {
    const row = { listing_id: listingId, ...boolRow(AMENITY_COLS, amenities) };
    const { error: amErr } = await supabase
      .from("listing_amenities")
      .upsert(row, { onConflict: "listing_id" });
    if (amErr) {
      return NextResponse.json({ error: amErr.message }, { status: 500 });
    }
  }

  if (utilities_included !== undefined) {
    const row = { listing_id: listingId, ...boolRow(UTILITY_COLS, utilities_included) };
    const { error: utErr } = await supabase
      .from("listing_utilities")
      .upsert(row, { onConflict: "listing_id" });
    if (utErr) {
      return NextResponse.json({ error: utErr.message }, { status: 500 });
    }
  }

  // Client sends the URL set it wants kept; delete anything else. New uploads go through /api/upload.
  if (Array.isArray(images)) {
    const keepUrls = images.filter((u) => typeof u === "string" && u);
    const { data: existing } = await supabase
      .from("listing_images")
      .select("id, url")
      .eq("listing_id", listingId);
    const toDelete = (existing ?? [])
      .filter((r) => !keepUrls.includes(r.url))
      .map((r) => r.id);
    if (toDelete.length > 0) {
      await supabase.from("listing_images").delete().in("id", toDelete);
    }
  }

  if (Array.isArray(units)) {
    const { error: unitsDeleteError } = await supabase
      .from("listing_units")
      .delete()
      .eq("listing_id", listingId);
    if (unitsDeleteError) {
      return NextResponse.json({ error: unitsDeleteError.message }, { status: 500 });
    }

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

      const leaseAvailabilityVal = Array.isArray(lease_availability)
        ? (lease_availability[0] ?? null)
        : (lease_availability ?? null);

      const leaseRows = (insertedUnits ?? [])
        .map((inserted, idx) => {
          const rent = units[idx]?.rent ?? null;
          const availFrom = units[idx]?.leaseAvailability ?? leaseAvailabilityVal ?? null;
          if (rent == null && availFrom == null) return null;
          return {
            unit_id: inserted.id,
            rent,
            is_active: true,
            available_from: availFrom,
          };
        })
        .filter(Boolean);

      if (leaseRows.length > 0) {
        const { error: leasesError } = await supabase
          .from("unit_leases")
          .insert(leaseRows);
        if (leasesError) {
          console.error("unit_leases insert error:", leasesError);
        }
      }
    }
  }

  const { data: updated } = await supabase
    .from("listings")
    .select(
      "*, listing_units(bedrooms, bathrooms, area), listing_amenities(*), listing_utilities(*), listing_images(url, sort_order), home_types(label)"
    )
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
