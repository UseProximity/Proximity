export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { isPropertyOwner } from "@/lib/listings/ownership";
import { deleteAsUser } from "@/lib/supabaseWithUser";
import { deriveLeaseAvailability } from "@/utils/listingFormatters";

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

  /*
   * PROPERTY-level ownership only. PATCH below replaces every unit on the
   * listing and DELETE removes it, so holding a lease at this address is
   * deliberately not enough — a landlord who attached an offering to someone
   * else's property must not be able to edit or delete it, or wipe the units
   * another landlord's leases hang off. They manage their own offering through
   * /api/leases/[leaseId] instead. See lib/listings/ownership.js.
   */
  if (await isPropertyOwner(session.user.id, listingId)) return { session };

  // Distinguish "not yours at all" from "yours, but only the lease" so the
  // caller can be pointed at the route that will actually work.
  const { data: unitRows } = await supabase
    .from("listing_units")
    .select("id")
    .eq("listing_id", listingId)
    .is("deleted_at", null);

  const unitIds = (unitRows ?? []).map((u) => u.id);
  let hasLease = false;
  if (unitIds.length) {
    const { data: mine } = await supabase
      .from("unit_leases")
      .select("id")
      .eq("owner_id", session.user.id)
      .in("unit_id", unitIds)
      .limit(1);
    hasLease = !!mine?.length;
  }

  if (hasLease) {
    return {
      err:
        "You have a lease at this property but don't own the property record, so you can't edit it. Edit your own lease instead.",
      status: 403,
    };
  }

  return { err: "Forbidden", status: 403 };
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
    custom_amenities,
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

  // listings.lease_availability (text[] of term labels, e.g. ["semester","12-month"]) is now
  // DERIVED from the per-unit lease terms (unit_leases.lease_term_months) so the two never drift.
  // When units are part of this edit, recompute it from them; otherwise fall back to an
  // explicitly-supplied array (legacy callers).
  if (Array.isArray(units)) {
    safeUpdates.lease_availability = deriveLeaseAvailability(units);
  } else if (lease_availability !== undefined) {
    safeUpdates.lease_availability = Array.isArray(lease_availability)
      ? lease_availability
          .filter((v) => typeof v === "string" && v.trim())
          .map((v) => v.trim().toLowerCase())
      : [];
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

  // rpc_edit_listing deletes + reinserts unit_leases when p_units is supplied,
  // so carry the canonical sublease flag (unit_leases.sublease) through. Derive
  // it from lease_type in the edit; if the edit omits lease_type, fall back to
  // the listing's stored value so an unrelated edit doesn't clear the flag.
  let unitsPayload = null;
  if (Array.isArray(units)) {
    let leaseType = safeUpdates.lease_type;
    if (leaseType === undefined) {
      const { data: existing } = await supabase
        .from("listings")
        .select("lease_type")
        .eq("id", listingId)
        .maybeSingle();
      leaseType = existing?.lease_type;
    }
    const isSublease = String(leaseType ?? "").toLowerCase() === "sublease";
    unitsPayload = units.map((u) => ({ ...u, sublease: isSublease }));
  }

  // All writes in one RPC transaction so fn_action_log captures the real user ID
  const { error: rpcError } = await supabase.rpc("rpc_edit_listing", {
    p_user_id: check.session.user.id,
    p_listing_id: listingId,
    p_listing_updates: Object.keys(safeUpdates).length > 0 ? safeUpdates : null,
    p_amenities: amenities !== undefined ? boolRow(AMENITY_COLS, amenities) : null,
    p_utilities: utilities_included !== undefined ? boolRow(UTILITY_COLS, utilities_included) : null,
    p_images_keep: Array.isArray(images) ? images.filter((u) => typeof u === "string" && u) : null,
    p_units: unitsPayload,
    p_lease_availability: leaseAvailabilityVal,
    p_custom_amenities: Array.isArray(custom_amenities)
      ? custom_amenities.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean)
      : null,
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
