/*
 * GET /api/admin/records/listing/[id]
 *
 * What surrounds one listing for the admin record page (lib/admin/records.js):
 * its state, agent, website sync, conversations, tours, questions, the last 30
 * days' numbers and, for super admins, agreement coverage. The units, leases,
 * owners and photos come from /api/admin/hierarchy/listings?id=.
 *
 * Read only. Honours the dashboard's dev/prod switch (x-db-target).
 *
 * @auth admin
 */
export const dynamic = "force-dynamic";

import { requireDbRole, hasDbRole } from "@/lib/userRole";
import { adminDb } from "@/lib/admin/adminDb";
import { isUuid, loadListingRecord } from "@/lib/admin/records";

export async function GET(req, { params }) {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  if (!isUuid(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const { db } = adminDb(req);

  try {
    const isSuper = await hasDbRole(session.user.id, ["super"]);
    const record = await loadListingRecord(db, id, { isSuper });
    if (!record) return Response.json({ error: "No listing with that id in this database." }, { status: 404 });
    return Response.json(record);
  } catch (err) {
    console.error("GET admin/records/listing failed:", err);
    return Response.json({ error: "Could not load this listing" }, { status: 500 });
  }
}
