export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { isWholeCount } from "@/utils/unitCounts";
import { cleanUnitName } from "@/utils/unitName";
import { findUnitNamed, nextUnitSortOrder } from "@/lib/listings/unitNames";

/*
 * Add a unit to a property.
 *
 * Deliberately not restricted to the property owner. A landlord letting one
 * apartment in a building someone else already listed has to be able to put that
 * apartment on the record — that is the whole point of the property → unit →
 * lease split — and the owner keeps the balancing power: DELETE on
 * units/[unitId] is theirs alone, so an unwanted unit can be taken back off.
 *
 * The unit is created with no offering on it. Terms belong to whoever is letting
 * it and are added through /api/leases, which is a separate act of ownership:
 * adding a unit says the apartment exists, not that it is yours.
 *
 * That holds on a property nobody owns too (a review stub or an import with no
 * landlord row). Adding a unit there used to hand the caller the whole property
 * record, but the only guard on that was a "landlord" role anyone can give
 * themselves, so a single request per listing took over every unclaimed
 * property on the site. Claiming now needs a real offering (/api/leases or
 * /api/addListing), and verified ownership is a follow-up.
 *
 * Bedrooms and bathrooms are required — they are NOT NULL on the table, and
 * more to the point a unit with unknown specs would appear in browse and match
 * bed/bath filters it has no business matching. The caller asks for them before
 * getting here rather than having a placeholder invented for it.
 *
 * `draft: true` creates the unit unpublished (see 202610100002): it and any
 * offering added to it stay off the site until someone publishes it. That is
 * how the editor adds a unit to a building that is already live.
 *
 * @auth user
 */
export async function POST(req, { params }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { listingId } = await params;

  const { data: listing, error: readErr } = await supabase
    .from("listings")
    .select("id, deleted_at")
    .eq("id", listingId)
    .maybeSingle();

  if (readErr) {
    return NextResponse.json({ error: "That isn't a valid property id." }, { status: 400 });
  }
  if (!listing || listing.deleted_at) {
    return NextResponse.json({ error: "That property no longer exists." }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) ?? {};

  const num = (v) => (v === "" || v == null ? null : Number(v));
  const bedrooms = num(body.bedrooms);
  const bathrooms = num(body.bathrooms);
  if (!Number.isFinite(bedrooms) || !Number.isFinite(bathrooms)) {
    return NextResponse.json(
      { error: "A unit needs a bedroom and a bathroom count." },
      { status: 400 }
    );
  }
  // A room count below zero is a slipped spinner click, not an answer — four
  // listings went live at -2 bed / -1 bath before the inputs clamped.
  if (bedrooms < 0 || bathrooms < 0) {
    return NextResponse.json(
      { error: "Bedrooms and bathrooms cannot be negative." },
      { status: 400 }
    );
  }
  // listing_units.bedrooms is an integer column, so a fractional count reaches
  // Postgres as invalid integer syntax and surfaces as a generic save failure.
  // Bathrooms are numeric, so half baths stay legal.
  if (!isWholeCount(bedrooms)) {
    return NextResponse.json(
      {
        error:
          "Bedrooms must be a whole number. If you mean a half bath, put it in the bathrooms field.",
      },
      { status: 400 }
    );
  }

  const name = cleanUnitName(body.name);

  // One apartment, one row: a landlord who clicks Add twice because the first
  // one didn't appear should get their unit back, not a duplicate of it.
  const clashId = await findUnitNamed(listingId, name);
  if (clashId) {
    return NextResponse.json(
      { error: "That unit already exists at this property.", unit: { id: clashId } },
      { status: 409 }
    );
  }

  const { data: unit, error } = await supabase
    .from("listing_units")
    .insert({
      listing_id: listingId,
      bedrooms,
      bathrooms,
      area: num(body.area),
      name,
      sort_order: await nextUnitSortOrder(listingId),
      ...(body.draft === true ? { published_at: null } : {}),
    })
    .select("id")
    .single();

  if (error) {
    // A missing required column is the caller's omission, not a server fault,
    // and saying so beats the bare 500 this used to return.
    if (error.code === "23502") {
      return NextResponse.json(
        { error: "That unit is missing something we need to save it." },
        { status: 400 }
      );
    }
    console.error("[units] insert failed:", error.message);
    return NextResponse.json({ error: "Could not add that unit." }, { status: 500 });
  }

  return NextResponse.json(
    { message: "Unit added", unit: { id: unit.id }, claimedProperty: false },
    { status: 201 }
  );
}
