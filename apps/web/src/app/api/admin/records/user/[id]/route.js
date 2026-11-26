/*
 * GET /api/admin/records/user/[id]
 *
 * Everything about one person for the admin record page (lib/admin/records.js):
 * profile, stage, listings, conversations, tours, reviews, emails and activity.
 * ?part=billing returns a landlord's agreement, payment and invoice summary
 * instead; it is super only and slower, so the page asks for it separately.
 *
 * Read only. Honours the dashboard's dev/prod switch (x-db-target).
 *
 * @auth admin
 */
export const dynamic = "force-dynamic";

import { requireDbRole, hasDbRole } from "@/lib/userRole";
import { adminDb } from "@/lib/admin/adminDb";
import { isUuid, loadUserBilling, loadUserRecord } from "@/lib/admin/records";

export async function GET(req, { params }) {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  if (!isUuid(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const { db, writable } = adminDb(req);

  try {
    if (new URL(req.url).searchParams.get("part") === "billing") {
      // The read-only admin role never sees billing (Wyatt, 2026-11-07).
      if (!(await hasDbRole(session.user.id, ["super"]))) return Response.json({ error: "Forbidden" }, { status: 403 });
      return Response.json({ billing: await loadUserBilling(db, id) });
    }
    const record = await loadUserRecord(db, id);
    if (!record) return Response.json({ error: "No user with that id in this database." }, { status: 404 });
    return Response.json({ ...record, ownDatabase: writable });
  } catch (err) {
    console.error("GET admin/records/user failed:", err);
    return Response.json({ error: "Could not load this person" }, { status: 500 });
  }
}
