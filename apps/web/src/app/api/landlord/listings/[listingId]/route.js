export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { isPropertyOwner } from "@/lib/listings/ownership";
import { deleteAsUser } from "@/lib/supabaseWithUser";
import {
  findPropertyNameConflict,
  propertyNameTakenResponse,
} from "@/lib/listings/propertyName";

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
   * PROPERTY-level ownership only. PATCH below rewrites the building's own
   * record and DELETE removes it, so holding a lease at this address is
   * deliberately not enough — a landlord who attached an offering to someone
   * else's property must not be able to edit or delete it. They manage their
   * own offering through /api/leases/[leaseId] instead. See
   * lib/listings/ownership.js.
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

/*
 * Payload keys this route used to accept and no longer will.
 *
 * Each of them made `rpc_edit_listing` rewrite rows that belong to OTHER people
 * at the same property — which was invisible while a listing was one landlord's
 * apartment, and is data loss now that it is a building several of them let in:
 *
 *   units   for each unit it took `the oldest active lease ORDER BY created_at
 *           LIMIT 1` regardless of owner_id and overwrote its rent, sublease
 *           flag and term — so a landlord's ordinary Save silently repriced a
 *           subletter's offering and turned their sublease into a standard
 *           lease. It then hard-deleted every unit the form did not echo back,
 *           without checking deleted_at, taking that unit's leases with it.
 *   images  `p_images_keep` deletes every listing_images row whose url is not in
 *           the list, ignoring owner_id and unit_id — so the property owner's
 *           save removed every subletter's photos of their own unit.
 *   leases  writes the retired listing_leases table.
 *
 * This is the same defect 202608230001_pms_lease_owner_scope.sql fixed for the
 * PMS path, reached through the dashboard instead of a nightly sync.
 *
 * Each one now has a scoped route that touches only the caller's own rows, so
 * nothing is lost by refusing them here — and refusing them at the API is what
 * makes the destructive path unreachable, rather than merely unused by our own
 * client.
 */
const MOVED = {
  units: "PATCH /api/landlord/listings/[listingId]/units/[unitId] (one unit at a time)",
  images: "POST/DELETE /api/landlord/listings/[listingId]/images",
  leases: "PATCH /api/leases/[leaseId] (each owner edits their own offering)",
};

// PATCH /api/landlord/listings/[listingId] — the property record, its amenities
// and its utilities. Units, offerings and photos are edited through their own
// routes; see MOVED above.
export async function PATCH(req, { params }) {
  const { listingId } = await params;
  const check = await requireOwnership(listingId);
  if (check.err) return NextResponse.json({ error: check.err }, { status: check.status });

  const body = await req.json();

  const moved = Object.keys(MOVED).filter((k) => body[k] !== undefined);
  if (moved.length) {
    return NextResponse.json(
      {
        error:
          `This route no longer changes ${moved.join(", ")} — doing so overwrote other ` +
          `landlords' offerings and photos at the same property.`,
        use: Object.fromEntries(moved.map((k) => [k, MOVED[k]])),
      },
      { status: 400 }
    );
  }

  const {
    amenities,
    custom_amenities,
    utilities_included,
    home_type,
    lease_availability,
    ...rest
  } = body;

  // Only write real listings columns. Anything else (including dropped v3 columns) is ignored.
  const safeUpdates = {};
  for (const [k, v] of Object.entries(rest)) {
    if (LISTING_COLS.has(k)) safeUpdates[k] = v;
  }

  /*
   * A renamed property must not take a name another one at this school already
   * holds. Only checked when `title` is actually in the payload — the form sends
   * the whole record on every save, so most PATCHes carry the name unchanged, and
   * excludeListingId is what stops those from colliding with themselves.
   *
   * The listing's own school_id is read rather than trusted from the body:
   * school_id is not in LISTING_COLS, so this route cannot change it, and the
   * bucket a name is checked against has to be the one it will be stored in.
   */
  if (safeUpdates.title !== undefined) {
    const { data: current, error: currentError } = await supabase
      .from("listings")
      .select("school_id")
      .eq("id", listingId)
      .maybeSingle();

    if (currentError) {
      console.error("[landlord PATCH] school lookup failed:", currentError.message);
      return NextResponse.json({ error: "Could not save that property." }, { status: 500 });
    }

    const conflict = await findPropertyNameConflict(safeUpdates.title, {
      schoolId: current?.school_id ?? null,
      excludeListingId: listingId,
    });
    if (conflict) {
      return NextResponse.json(propertyNameTakenResponse(conflict), { status: 409 });
    }
  }

  // listings.lease_availability (text[] of term labels, e.g. ["semester","12-month"]) is
  // DERIVED from the per-unit lease terms (unit_leases.lease_term_months) so the two never
  // drift. Units are no longer editable here, so the only remaining source is an
  // explicitly-supplied array; the derivation happens where the terms are actually
  // changed, in /api/leases/[leaseId].
  if (lease_availability !== undefined) {
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

  /*
   * All writes in one RPC transaction so fn_action_log captures the real user ID.
   *
   * p_units, p_images_keep and p_leases are deliberately never passed. They are
   * the three arguments that reach rows belonging to other owners at this
   * property, and the guard at the top of this handler rejects the payload keys
   * that would fill them — passing null here is the second half of the same
   * fix, so a future caller cannot reintroduce it by editing the guard alone.
   */
  const { error: rpcError } = await supabase.rpc("rpc_edit_listing", {
    p_user_id: check.session.user.id,
    p_listing_id: listingId,
    p_listing_updates: Object.keys(safeUpdates).length > 0 ? safeUpdates : null,
    p_amenities: amenities !== undefined ? boolRow(AMENITY_COLS, amenities) : null,
    p_utilities: utilities_included !== undefined ? boolRow(UTILITY_COLS, utilities_included) : null,
    p_images_keep: null,
    p_units: null,
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
