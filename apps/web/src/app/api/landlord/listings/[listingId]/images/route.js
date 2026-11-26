import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import {
  canManagePropertyPhotos,
  hasStakeInListing,
} from "@/lib/listings/ownership";

/**
 * Work out which of the caller's photos land in which slots.
 *
 * `rows` is every photo in the scope, ascending. The caller's own photos keep
 * the positions they already occupy; their submitted order is dealt back into
 * exactly those slots. Photos belonging to anyone else are not returned at all,
 * so they cannot be moved and their rows are never written.
 *
 * Exported for direct testing — this is the rule that stops one landlord
 * burying a competitor's pictures of the same unit.
 */
export function planReorder(rows, callerId, urls) {
  const mine = (rows ?? []).filter((r) => r.owner_id === callerId);
  const slots = mine.map((r) => r.sort_order);
  const mineByUrl = new Map(mine.map((r) => [r.url, r]));
  const desired = (urls ?? []).map((u) => mineByUrl.get(u)).filter(Boolean);

  if (desired.length !== mine.length) return null; // list doesn't match theirs
  return desired.map((row, i) => ({ id: row.id, url: row.url, sort_order: slots[i] }));
}

/*
 * Reorder the property's gallery.
 *
 * Body: { urls: string[] }
 *
 * A property has one gallery (units are tags on its photos, see
 * 202609250001), so the order is one sequence and the first photo is the
 * listing's cover.
 *
 * The property owner reorders all of it. Anyone else with a stake here may only
 * permute the positions their OWN photos already occupy: the others stay
 * exactly where they are, and their rows are never written at all. So a
 * landlord can arrange their own pictures without being able to bury a
 * competitor's, or take the cover.
 *
 * @auth user
 */
export async function PATCH(req, { params }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { listingId } = await params;
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.urls)) {
    return NextResponse.json({ error: "urls array required" }, { status: 400 });
  }
  const { urls } = body;

  const isPropertyOwner =
    session.user.role === "super" ||
    (await canManagePropertyPhotos(session.user.id, listingId));

  if (!isPropertyOwner && !(await hasStakeInListing(session.user.id, listingId))) {
    return NextResponse.json(
      { error: "You need a listing at this property to arrange its photos." },
      { status: 403 }
    );
  }

  if (isPropertyOwner) {
    await Promise.all(
      urls.map((url, i) =>
        supabase
          .from("listing_images")
          .update({ sort_order: i })
          .eq("listing_id", listingId)
          .eq("url", url)
      )
    );
    return NextResponse.json({ ok: true, reordered: urls.length });
  }

  /*
   * Everyone else: read the scope, keep the slots the caller's photos already
   * hold, and deal their submitted order back into those same slots. Photos
   * they don't own keep their sort_order untouched, so nothing of anyone
   * else's moves and no foreign row is updated.
   */
  const { data: rows, error } = await supabase
    .from("listing_images")
    .select("id, url, sort_order, owner_id")
    .eq("listing_id", listingId)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("[listings/images] read failed:", error.message);
    return NextResponse.json({ error: "Could not reorder those photos." }, { status: 500 });
  }

  const plan = planReorder(rows, session.user.id, urls);
  if (!plan) {
    return NextResponse.json(
      { error: "That list doesn't match your photos at this property." },
      { status: 400 }
    );
  }

  await Promise.all(
    plan.map((row) =>
      supabase
        .from("listing_images")
        .update({ sort_order: row.sort_order })
        .eq("id", row.id)
        // Re-asserted on the write: the plan already excludes other people's
        // photos, and this makes it impossible for a bug above to move one.
        .eq("owner_id", session.user.id)
    )
  );

  return NextResponse.json({ ok: true, reordered: plan.length });
}
