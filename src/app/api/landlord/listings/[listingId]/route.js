export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { deleteAsUser } from "@/lib/supabaseWithUser";

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

  const leaseAvailabilityVal = (() => {
    const raw = Array.isArray(lease_availability) ? (lease_availability[0] ?? null) : (lease_availability ?? null);
    return typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
  })();

  // All writes in one RPC transaction so fn_action_log captures the real user ID
  const { error: rpcError } = await supabase.rpc("rpc_edit_listing", {
    p_user_id: check.session.user.id,
    p_listing_id: listingId,
    p_listing_updates: Object.keys(safeUpdates).length > 0 ? safeUpdates : null,
    p_amenities: amenities !== undefined ? boolRow(AMENITY_COLS, amenities) : null,
    p_utilities: utilities_included !== undefined ? boolRow(UTILITY_COLS, utilities_included) : null,
    p_images_keep: Array.isArray(images) ? images.filter((u) => typeof u === "string" && u) : null,
    p_units: Array.isArray(units) ? units : null,
    p_lease_availability: leaseAvailabilityVal,
  });

  if (rpcError) return NextResponse.json({ error: rpcError.message }, { status: 500 });

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

  const { error } = await deleteAsUser(supabase, {
    userId: check.session.user.id,
    table: "listings",
    rowId: listingId,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
