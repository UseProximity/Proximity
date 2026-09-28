export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { isPropertyOwner, canAddUnitPhotos } from "@/lib/listings/ownership";

/*
 * Edit ONE unit's physical facts.
 *
 * A unit is part of the property record — its bedroom count is true of the
 * apartment whoever happens to be letting it — so this is the property owner's
 * to change, with one exception noted below for the floor plan. The offerings ON
 * the unit belong to their own owners and are edited through
 * /api/leases/[leaseId]; nothing here touches
 * unit_leases, which is the whole reason this route exists separately from the
 * parent PATCH that rewrites them.
 *
 * @auth user
 */
const EDITABLE = {
  bedrooms: (v) => (v === "" || v == null ? null : Number(v)),
  bathrooms: (v) => (v === "" || v == null ? null : Number(v)),
  area: (v) => (v === "" || v == null ? null : Number(v)),
  title: (v) => (typeof v === "string" ? v.trim() || null : null),
  floor_plan_image_url: (v) => (typeof v === "string" ? v.trim() || null : null),
};
const BODY_TO_COLUMN = {
  bedrooms: "bedrooms",
  bathrooms: "bathrooms",
  area: "area",
  title: "title",
  floorPlanImageUrl: "floor_plan_image_url",
};

export async function PATCH(req, { params }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { listingId, unitId } = await params;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  const isOwner =
    session.user.role === "super" ||
    (await isPropertyOwner(session.user.id, listingId));

  /*
   * One narrow exception to owner-only editing: CONTRIBUTING a floor plan.
   *
   * A landlord letting an apartment in someone else's building is the person
   * most likely to have its floor plan, and refusing them the one slot left the
   * section permanently empty and unclickable on every property they don't own.
   *
   * But contributing is not the same as controlling, and this column is the last
   * place the difference could be blurred: everything else a non-owner may add
   * at a property — photos, their terms, their price — lands on a row that is
   * theirs, while floor_plan_image_url is a single shared value on the property's
   * own record. Letting a lease holder write it unconditionally meant one of
   * them could replace the owner's diagram, or clear it, and the owner would
   * have no way to tell who did.
   *
   * So a non-owner may FILL the slot and never change one that is already
   * filled. An empty field is missing information anyone at the property can
   * supply; a filled one is the owner's, and asking them to replace it is the
   * right amount of friction. Clearing it is owner-only for the same reason.
   *
   * The request must also touch NOTHING else, so this cannot be used as a door
   * into the rest of the unit.
   */
  if (!isOwner) {
    const keys = Object.keys(body);
    const floorPlanOnly =
      keys.length > 0 && keys.every((k) => k === "floorPlanImageUrl");
    const plan =
      typeof body.floorPlanImageUrl === "string" ? body.floorPlanImageUrl.trim() : "";

    if (!floorPlanOnly) {
      return NextResponse.json(
        { error: "Only the property owner can edit a unit's details." },
        { status: 403 }
      );
    }
    if (!plan) {
      return NextResponse.json(
        { error: "Only the property owner can remove a unit's floor plan." },
        { status: 403 }
      );
    }

    const check = await canAddUnitPhotos(session.user.id, unitId);
    if (!check.ok) {
      return NextResponse.json(
        { error: "You don't have a listing on that unit." },
        { status: 403 }
      );
    }

    const { data: current } = await supabase
      .from("listing_units")
      .select("floor_plan_image_url")
      .eq("id", unitId)
      .maybeSingle();

    if (current?.floor_plan_image_url) {
      return NextResponse.json(
        {
          error:
            "This unit already has a floor plan. Only the property owner can replace it.",
        },
        { status: 403 }
      );
    }
  }

  const { data: unit, error: readErr } = await supabase
    .from("listing_units")
    .select("id, listing_id, deleted_at")
    .eq("id", unitId)
    .maybeSingle();

  if (readErr) {
    return NextResponse.json({ error: "That isn't a valid unit id." }, { status: 400 });
  }
  if (!unit || unit.deleted_at) {
    return NextResponse.json({ error: "That unit no longer exists." }, { status: 404 });
  }
  // The unit must belong to the listing in the path, so a valid unit id from
  // another property cannot be edited through an owner's own listing.
  if (unit.listing_id !== listingId) {
    return NextResponse.json({ error: "That unit isn't at this property." }, { status: 400 });
  }

  const patch = {};
  for (const [key, column] of Object.entries(BODY_TO_COLUMN)) {
    if (key in body) patch[column] = EDITABLE[column](body[key]);
  }

  // Unit identity: "Whole" means the whole property and carries no number, which
  // the listing_units_number_check constraint enforces.
  if ("designator" in body) {
    const d = typeof body.designator === "string" ? body.designator.trim() : "";
    patch.unit_designator = d || null;
    patch.unit_number =
      !d || d === "Whole"
        ? null
        : (typeof body.number === "string" ? body.number.trim() : "") || null;
  }

  // Room counts are physical facts, so a negative is a slipped spinner click
  // rather than an answer. listing_units carries a CHECK for the same reason;
  // this is here so the landlord gets a sentence instead of a 500.
  for (const column of ["bedrooms", "bathrooms", "area"]) {
    if (patch[column] != null && patch[column] < 0) {
      return NextResponse.json(
        { error: "Bedrooms, bathrooms, and square footage can't be negative." },
        { status: 400 }
      );
    }
  }

  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const { error } = await supabase
    .from("listing_units")
    .update(patch)
    .eq("id", unitId)
    .eq("listing_id", listingId);

  if (error) {
    if (error.code === "23514") {
      // 23514 is any CHECK on the table, so say which one actually failed.
      const msg = /counts_nonneg/.test(error.message ?? "")
        ? "Bedrooms, bathrooms, and square footage can't be negative."
        : "A numbered unit needs a number, and “Whole property” can't have one.";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    console.error("[units/:id] update failed:", error.message);
    return NextResponse.json({ error: "Could not save that unit." }, { status: 500 });
  }

  return NextResponse.json({ message: "Unit updated" });
}

/*
 * Remove a unit from the property.
 *
 * Anyone may add a unit to a property they don't own — that is how a landlord
 * lists an apartment in someone else's building — so the property owner needs a
 * way to take one back off. This is theirs alone.
 *
 * Soft delete, and it takes the unit's offerings with it: a lease on a unit that
 * no longer exists is not something a renter could take, and leaving them live
 * would keep the unit reachable through search. Their rows survive deactivated,
 * so the removal can be reversed and nothing about who offered what is lost.
 *
 * @auth user
 */
export async function DELETE(req, { params }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { listingId, unitId } = await params;
  const isOwner =
    session.user.role === "super" ||
    (await isPropertyOwner(session.user.id, listingId));
  if (!isOwner) {
    return NextResponse.json(
      { error: "Only the property owner can remove a unit." },
      { status: 403 }
    );
  }

  const { data: unit, error: readErr } = await supabase
    .from("listing_units")
    .select("id, listing_id, deleted_at")
    .eq("id", unitId)
    .maybeSingle();

  if (readErr) {
    return NextResponse.json({ error: "That isn't a valid unit id." }, { status: 400 });
  }
  if (!unit || unit.deleted_at) {
    return NextResponse.json({ error: "That unit no longer exists." }, { status: 404 });
  }
  if (unit.listing_id !== listingId) {
    return NextResponse.json({ error: "That unit isn't at this property." }, { status: 400 });
  }

  // Offerings first, so the unit is never briefly gone while its leases are
  // still live and findable.
  const { error: leaseErr } = await supabase
    .from("unit_leases")
    .update({ is_active: false, unavailable: true })
    .eq("unit_id", unitId);
  if (leaseErr) {
    console.error("[units/:id] withdrawing offerings failed:", leaseErr.message);
    return NextResponse.json({ error: "Could not remove that unit." }, { status: 500 });
  }

  const { error } = await supabase
    .from("listing_units")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", unitId)
    .eq("listing_id", listingId);

  if (error) {
    console.error("[units/:id] delete failed:", error.message);
    return NextResponse.json({ error: "Could not remove that unit." }, { status: 500 });
  }

  return NextResponse.json({ message: "Unit removed" });
}
