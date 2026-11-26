export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { isPropertyOwner } from "@/lib/listings/ownership";

/*
 * Put a property's units in the order its owner dragged them into.
 *
 * The order is part of the property record (it decides which unit students see
 * first), so like the rest of a unit it is the property owner's to set. The
 * body must name every live unit at the property exactly once: a partial list
 * would leave the units it skipped colliding with the ones it moved.
 *
 * @auth user
 */
export async function PUT(req, { params }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { listingId } = await params;
  const isOwner =
    session.user.role === "super" || (await isPropertyOwner(session.user.id, listingId));
  if (!isOwner) {
    return NextResponse.json(
      { error: "Only the property owner can reorder its units." },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => null);
  const unitIds = Array.isArray(body?.unitIds) ? body.unitIds : null;
  if (!unitIds || unitIds.some((id) => typeof id !== "string")) {
    return NextResponse.json({ error: "Send the units in their new order." }, { status: 400 });
  }

  const { data: units, error: readErr } = await supabase
    .from("listing_units")
    .select("id, sort_order")
    .eq("listing_id", listingId)
    .is("deleted_at", null);
  if (readErr) {
    console.error("[units/order] read failed:", readErr.message);
    return NextResponse.json({ error: "Could not reorder those units." }, { status: 500 });
  }

  const live = new Set((units ?? []).map((u) => u.id));
  if (unitIds.length !== live.size || new Set(unitIds).size !== live.size || !unitIds.every((id) => live.has(id))) {
    // Usually a stale page: a unit was added or removed in another tab.
    return NextResponse.json(
      { error: "The units here changed. Reload the page and try again." },
      { status: 409 }
    );
  }

  // Only the units whose position changed, all at once: the landlord's tabs
  // stay locked until this returns, so a one-at-a-time loop was felt as lag.
  const was = new Map((units ?? []).map((u) => [u.id, u.sort_order]));
  const results = await Promise.all(
    unitIds
      .map((id, i) => [id, i])
      .filter(([id, i]) => was.get(id) !== i)
      .map(([id, i]) =>
        supabase.from("listing_units").update({ sort_order: i }).eq("id", id).eq("listing_id", listingId)
      )
  );
  const failed = results.find((r) => r.error);
  if (failed) {
    console.error("[units/order] update failed:", failed.error.message);
    return NextResponse.json({ error: "Could not save the new order." }, { status: 500 });
  }

  return NextResponse.json({ message: "Order saved" });
}
