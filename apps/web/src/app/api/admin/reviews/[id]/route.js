/*
 * PATCH /api/admin/reviews/[id]: take a listing review down, or put it back.
 *
 *   { action: "remove" }    soft delete: hidden from the listing and its rating,
 *                           still in the admin list, can be restored
 *   { action: "restore" }   undo a removal
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

  const { data, error } = await adminDb(req).db.from("listing_reviews")
    .update({ deleted_at: body.action === "remove" ? new Date().toISOString() : null }).eq("id", id).select("id");
  if (error) {
    console.error("PATCH admin/reviews failed:", error);
    return Response.json({ error: "Could not change the review" }, { status: 500 });
  }
  if (!data?.length) return Response.json({ error: "No such review" }, { status: 404 });
  return Response.json({ ok: true });
}
