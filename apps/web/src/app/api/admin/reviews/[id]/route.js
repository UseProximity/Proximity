/*
 * PATCH /api/admin/reviews/[id]: take a listing review down, or put it back.
 *
 *   { action: "remove" }    soft delete: hidden from the listing and its rating,
 *                           still in the admin list, can be restored
 *   { action: "restore" }   undo a removal made from the dashboard. A review
 *                           the author withdrew, or a landlord dismissed while
 *                           it awaited approval, is not restored from here
 *                           (removed_by), so a withdrawn review never goes
 *                           back up by accident.
 *
 * The Reviews page could only delete a review for good; the reversible path
 * existed in the database but had no button (Wyatt, 2026-11-14). Follows the
 * dashboard's dev/prod switch.
 *
 * @auth super
 */
export const dynamic = "force-dynamic";

import { requireDbRole } from "@/lib/userRole";
import { adminDb } from "@/lib/admin/adminDb";
import { isUuid } from "@/lib/admin/records";

export async function PATCH(req, { params }) {
  const session = await requireDbRole(["super"]);
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  if (!isUuid(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  if (body.action !== "remove" && body.action !== "restore") return Response.json({ error: "Unknown action" }, { status: 400 });

  const { db } = adminDb(req);
  const { data: review, error: readError } = await db.from("listing_reviews").select("id, deleted_at, removed_by").eq("id", id).maybeSingle();
  if (readError) {
    console.error("PATCH admin/reviews read failed:", readError);
    return Response.json({ error: "Could not change the review" }, { status: 500 });
  }
  if (!review) return Response.json({ error: "No such review" }, { status: 404 });
  if (body.action === "restore" && review.deleted_at && review.removed_by !== "admin") {
    return Response.json({ error: "Only a review the team removed can be restored here." }, { status: 409 });
  }
  // Already down: removing again would overwrite who took it down ("author"
  // becoming "admin"), which would then let a withdrawn review be restored
  // (PR 447 review).
  if (body.action === "remove" && review.deleted_at) {
    return Response.json({ error: "This review is already removed." }, { status: 409 });
  }

  const patch = body.action === "remove" ? { deleted_at: new Date().toISOString(), removed_by: "admin" } : { deleted_at: null, removed_by: null };
  // The same guard in the update itself, for a removal made by someone else
  // between the read and this write.
  let update = db.from("listing_reviews").update(patch).eq("id", id);
  if (body.action === "remove") update = update.is("deleted_at", null);
  const { data, error } = await update.select("id");
  if (error) {
    console.error("PATCH admin/reviews failed:", error);
    return Response.json({ error: "Could not change the review" }, { status: 500 });
  }
  if (!data?.length) return Response.json({ error: "No such review" }, { status: 404 });
  return Response.json({ ok: true });
}
