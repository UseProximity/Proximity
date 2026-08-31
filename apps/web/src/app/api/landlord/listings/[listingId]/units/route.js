export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";

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
 * Bedrooms and bathrooms are required — they are NOT NULL on the table, and
 * more to the point a unit with unknown specs would appear in browse and match
 * bed/bath filters it has no business matching. The caller asks for them before
 * getting here rather than having a placeholder invented for it.
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

  // "Whole" covers the entire property and carries no number, which
  // listing_units_number_check enforces at the column level too.
  const designator =
    typeof body.designator === "string" ? body.designator.trim() || null : null;
  const number =
    !designator || designator === "Whole"
      ? null
      : (typeof body.number === "string" ? body.number.trim() : "") || null;

  /*
   * One apartment, one row. Two units at the same address both called "Unit 2E"
   * are not two apartments, and a landlord who clicks Add twice because the
   * first one didn't appear should get their unit back — not a duplicate of it.
   * Only identified units can be checked: a unit with no designator has nothing
   * to be the same as.
   */
  if (designator) {
    const { data: clash } = await supabase
      .from("listing_units")
      .select("id")
      .eq("listing_id", listingId)
      .eq("unit_designator", designator)
      .is("deleted_at", null)
      [number === null ? "is" : "eq"]("unit_number", number)
      // limit(1) rather than maybeSingle(): duplicates already exist from before
      // this guard, and erroring on "more than one row" would be the guard
      // failing precisely where it is most needed.
      .limit(1);

    if (clash?.length) {
      return NextResponse.json(
        {
          error: "That unit already exists at this property.",
          unit: { id: clash[0].id },
        },
        { status: 409 }
      );
    }
  }

  const { data: unit, error } = await supabase
    .from("listing_units")
    .insert({
      listing_id: listingId,
      bedrooms,
      bathrooms,
      area: num(body.area),
      title: typeof body.title === "string" ? body.title.trim() || null : null,
      unit_designator: designator,
      unit_number: number,
      available: body.available !== false,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23514") {
      return NextResponse.json(
        { error: "A numbered unit needs a number, and “Whole property” can't have one." },
        { status: 400 }
      );
    }
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

  return NextResponse.json({ message: "Unit added", unit: { id: unit.id } }, { status: 201 });
}
