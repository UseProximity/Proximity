export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { canTagPhoto } from "@/lib/listings/ownership";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/*
 * Set which units ONE photo shows.
 *
 * Body: { unitIds: string[] }, the full set the caller wants on the photo.
 *
 * The property owner's set replaces the photo's tags outright. Anyone else only
 * controls the units they are letting (see canTagPhoto): tags they are not
 * allowed to touch are kept exactly as they were, whatever the request says, so
 * one landlord cannot strip a unit another person put there.
 *
 * @auth user
 */
export async function PUT(req, { params }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { imageId } = await params;
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.unitIds)) {
    return NextResponse.json({ error: "unitIds array required" }, { status: 400 });
  }
  const requested = [...new Set(body.unitIds.filter((id) => UUID_RE.test(String(id))))];

  const check = await canTagPhoto(session.user.id, imageId, {
    isSuper: session.user.role === "super",
  });
  if (!check.ok) {
    if (check.reason === "not_found") {
      return NextResponse.json({ error: "That photo no longer exists." }, { status: 404 });
    }
    if (check.reason === "malformed") {
      return NextResponse.json({ error: "That isn't a valid photo id." }, { status: 400 });
    }
    if (check.reason === "no_units") {
      return NextResponse.json(
        { error: "You can only tag units you have a listing on." },
        { status: 403 }
      );
    }
    if (check.reason === "forbidden") {
      return NextResponse.json(
        { error: "You can only tag photos you added." },
        { status: 403 }
      );
    }
    return NextResponse.json({ error: "Could not load that photo." }, { status: 500 });
  }

  // The property's live units: a tag can only point at one of these.
  const { data: units, error: unitErr } = await supabase
    .from("listing_units")
    .select("id")
    .eq("listing_id", check.image.listing_id)
    .is("deleted_at", null);
  if (unitErr) {
    console.error("[photos/:id/units] unit read failed:", unitErr.message);
    return NextResponse.json({ error: "Could not save those tags." }, { status: 500 });
  }
  const liveUnitIds = new Set((units ?? []).map((u) => u.id));
  if (requested.some((id) => !liveUnitIds.has(id))) {
    return NextResponse.json({ error: "That unit isn't at this property." }, { status: 400 });
  }

  const { data: current, error: readErr } = await supabase
    .from("listing_image_units")
    .select("unit_id")
    .eq("image_id", imageId);
  if (readErr) {
    console.error("[photos/:id/units] tag read failed:", readErr.message);
    return NextResponse.json({ error: "Could not save those tags." }, { status: 500 });
  }

  const allowed = check.allowedUnitIds ? new Set(check.allowedUnitIds) : null;
  const mayTouch = (id) => !allowed || allowed.has(id);
  const have = new Set((current ?? []).map((r) => r.unit_id));
  const want = new Set(requested);

  if (requested.some((id) => !mayTouch(id) && !have.has(id))) {
    return NextResponse.json(
      { error: "You can only tag units you have a listing on." },
      { status: 403 }
    );
  }

  const toAdd = [...want].filter((id) => !have.has(id) && mayTouch(id));
  const toRemove = [...have].filter((id) => !want.has(id) && mayTouch(id));

  if (toRemove.length) {
    const { error } = await supabase
      .from("listing_image_units")
      .delete()
      .eq("image_id", imageId)
      .in("unit_id", toRemove);
    if (error) {
      console.error("[photos/:id/units] untag failed:", error.message);
      return NextResponse.json({ error: "Could not save those tags." }, { status: 500 });
    }
  }

  if (toAdd.length) {
    const { error } = await supabase.from("listing_image_units").insert(
      toAdd.map((unitId) => ({
        image_id: imageId,
        unit_id: unitId,
        created_by: session.user.id,
      }))
    );
    if (error) {
      console.error("[photos/:id/units] tag failed:", error.message);
      return NextResponse.json({ error: "Could not save those tags." }, { status: 500 });
    }
  }

  const unitIds = [...have].filter((id) => !toRemove.includes(id)).concat(toAdd);
  return NextResponse.json({ message: "Tags saved", unitIds });
}
