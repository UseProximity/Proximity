/*
 * GET /api/admin/search?q=
 *
 * The admin header's "find a person or listing" box: people by name, email or
 * company, listings by title or address, or either by a pasted id. Up to eight
 * of each. Honours the dashboard's dev/prod switch (x-db-target).
 *
 * @auth admin
 */
export const dynamic = "force-dynamic";

import { requireDbRole } from "@/lib/userRole";
import { adminDb } from "@/lib/admin/adminDb";
import { searchRecords } from "@/lib/admin/records";

export async function GET(req) {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });
  try {
    return Response.json(await searchRecords(adminDb(req).db, new URL(req.url).searchParams.get("q")));
  } catch (err) {
    console.error("GET admin/search failed:", err);
    return Response.json({ error: "Search failed" }, { status: 500 });
  }
}
