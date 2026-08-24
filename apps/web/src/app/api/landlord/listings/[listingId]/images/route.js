import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import {
  canManagePropertyPhotos,
  canAddUnitPhotos,
} from "@/lib/listings/ownership";

/*
 * Reorder photos within ONE scope.
 *
 * Body: { urls: string[], unitId?: string }
 *   unitId absent  -> the property's own photos; the property owner reorders.
 *   unitId present -> that unit's photos; anyone offering it may reorder, as
 *                     may the property owner.
 *
 * Scoping the write matters as much as scoping the permission: the previous
 * version matched on (listing_id, url) alone, so once units have photos it
 * would renumber a unit's pictures while reordering the property's — and the
 * first property photo is the listing's cover.
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
  const { urls, unitId = null } = body;

  if (session.user.role !== "super") {
    if (unitId) {
      const check = await canAddUnitPhotos(session.user.id, unitId);
      if (!check.ok) {
        return check.reason === "not_found"
          ? NextResponse.json({ error: "That unit no longer exists." }, { status: 404 })
          : NextResponse.json({ error: "You don't have a listing on that unit." }, { status: 403 });
      }
      if (check.listingId !== listingId) {
        return NextResponse.json({ error: "That unit isn't at this property." }, { status: 400 });
      }
    } else if (!(await canManagePropertyPhotos(session.user.id, listingId))) {
      return NextResponse.json(
        { error: "Only the property owner can reorder photos of the property." },
        { status: 403 }
      );
    }
  }

  await Promise.all(
    urls.map((url, i) => {
      const q = supabase
        .from("listing_images")
        .update({ sort_order: i })
        .eq("listing_id", listingId)
        .eq("url", url);
      return unitId ? q.eq("unit_id", unitId) : q.is("unit_id", null);
    })
  );

  return NextResponse.json({ ok: true });
}
