export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { isPropertyOwner } from "@/lib/listings/ownership";

/*
 * Edit the PROPERTY record and nothing else.
 *
 * The existing PATCH on the parent route updates the listing, replaces the unit
 * set, and — through rpc_edit_listing — rewrites the oldest active lease on each
 * unit regardless of who owns it. That was correct when a listing was one
 * landlord's apartment. Now that several landlords can offer the same unit, an
 * ordinary "save" by the property owner silently reprices a competitor's
 * offering and can flip their sublease into a standard lease.
 *
 * So this route exists to make that impossible rather than merely unlikely: it
 * touches `listings` and its amenity/utility rows, and has no code path that
 * reaches listing_units or unit_leases at all. Units are edited one at a time
 * (../units/[unitId]) and offerings by their own owner (/api/leases/[leaseId]).
 *
 * Deliberately NOT editable here:
 *   address / coordinates — an address identifies the property, and other
 *     landlords may have attached offerings to it. Changing it would move their
 *     listings too. A different address is a different listing.
 *   contact_*            — contact belongs to the offering now.
 *   move_in_date         — superseded by unit_leases.available_from.
 *
 * @auth user
 */
const AMENITY_COLS = [
  "air_conditioning", "dishwasher", "gym", "laundry", "mailroom",
  "microwave", "oven", "parking", "pets_allowed", "pool",
  "refrigerator", "rooftop", "storage", "stove", "study_room",
];
const UTILITY_COLS = [
  "electric", "gas", "heat", "water", "internet",
  "trash", "cable", "sewer", "cooling",
];

// Property fields a landlord may change from the listing editor.
const EDITABLE = {
  title: (v) => (typeof v === "string" ? v.trim() || null : null),
  description: (v) => (typeof v === "string" ? v.trim() || null : null),
  furnished: (v) => !!v,
  sublease_friendly: (v) => !!v,
  twenty_one_plus: (v) => !!v,
  lease_structure: (v) => (typeof v === "string" ? v.trim() || null : null),
  unavailable: (v) => !!v,
};
const BODY_TO_COLUMN = {
  title: "title",
  description: "description",
  furnished: "furnished",
  subleaseFriendly: "sublease_friendly",
  twentyOnePlus: "twenty_one_plus",
  leaseStructure: "lease_structure",
  unavailable: "unavailable",
};

function boolRow(cols, selected) {
  const row = Object.fromEntries(cols.map((c) => [c, false]));
  for (const name of selected ?? []) {
    if (typeof name === "string" && cols.includes(name)) row[name] = true;
  }
  return row;
}

export async function PATCH(req, { params }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { listingId } = await params;
  const isOwner =
    session.user.role === "super" ||
    (await isPropertyOwner(session.user.id, listingId));
  if (!isOwner) {
    return NextResponse.json(
      { error: "Only the property owner can edit the property's details." },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  const patch = {};
  for (const [key, column] of Object.entries(BODY_TO_COLUMN)) {
    if (key in body) patch[column] = EDITABLE[column](body[key]);
  }

  // home_type arrives as a label and is stored as an FK.
  if (typeof body.homeType === "string" && body.homeType.trim()) {
    const { data: ht } = await supabase
      .from("home_types")
      .select("id")
      .ilike("label", body.homeType.trim())
      .maybeSingle();
    if (ht?.id) patch.home_type_id = ht.id;
  }

  if (Object.keys(patch).length) {
    const { error } = await supabase.from("listings").update(patch).eq("id", listingId);
    if (error) {
      console.error("[listings/property] update failed:", error.message);
      return NextResponse.json({ error: "Could not save those details." }, { status: 500 });
    }
  }

  if (Array.isArray(body.amenities)) {
    const { error } = await supabase
      .from("listing_amenities")
      .upsert({ listing_id: listingId, ...boolRow(AMENITY_COLS, body.amenities) },
              { onConflict: "listing_id" });
    if (error) console.error("[listings/property] amenities failed:", error.message);
  }

  if (Array.isArray(body.utilitiesIncluded)) {
    const { error } = await supabase
      .from("listing_utilities")
      .upsert({ listing_id: listingId, ...boolRow(UTILITY_COLS, body.utilitiesIncluded) },
              { onConflict: "listing_id" });
    if (error) console.error("[listings/property] utilities failed:", error.message);
  }

  /*
   * Custom amenities are a replace-the-set operation: the editor sends the full
   * list it is showing, so anything absent was removed by the landlord.
   */
  if (Array.isArray(body.customAmenities)) {
    const labels = body.customAmenities
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .filter(Boolean);
    await supabase.from("listing_custom_amenities").delete().eq("listing_id", listingId);
    if (labels.length) {
      await supabase
        .from("listing_custom_amenities")
        .insert(labels.map((label) => ({ listing_id: listingId, label })));
    }
  }

  return NextResponse.json({ message: "Property updated" });
}
