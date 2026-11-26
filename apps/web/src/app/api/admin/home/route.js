/*
 * GET /api/admin/home
 *
 * The admin Home page (lib/admin/home.js): counts of what needs attention, the
 * team's due follow-ups and a one-week pulse. Billing counts are left out for
 * the read-only admin role. Honours the dashboard's dev/prod switch.
 *
 * @auth admin
 */
export const dynamic = "force-dynamic";

import { requireDbRole, hasDbRole } from "@/lib/userRole";
import { adminDb } from "@/lib/admin/adminDb";
import { loadHome } from "@/lib/admin/home";

export async function GET(req) {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });
  try {
    const isSuper = await hasDbRole(session.user.id, ["super"]);
    return Response.json(await loadHome(adminDb(req).db, { isSuper }));
  } catch (err) {
    console.error("GET admin/home failed:", err);
    return Response.json({ error: "Could not load Home" }, { status: 500 });
  }
}
