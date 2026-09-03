export const dynamic = "force-dynamic";

import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { buildDashboardUser } from "@/lib/users/dashboardUser";
import { canViewAs } from "@/lib/users/viewAs";

/*
 * "View as": an admin looking at somebody else's dashboard.
 *
 * The payload is built by the same function /api/getUser calls, and this route
 * deliberately owns no query of its own. It used to own a copy of one, and the
 * copy drifted for five months without ever erroring: it selected
 * listing_units without filtering deleted_at and without joining unit_leases at
 * all, so an admin viewing as a landlord saw every retired duplicate unit,
 * every one of them flagged hidden for want of an availability to read, and no
 * offerings under any of them. Kingsland Courtyard showed six 4-bed units and
 * no leases where its owner, and browse, both showed one unit and its lease.
 *
 * So the only thing decided here is WHO may be looked at.
 *
 * Admin-only. "admin" is the read-only half of super and the knowledge
 * scanner has no separate rank for it, so this declares the stricter of the
 * two rather than letting inference read the helper and guess "any".
 *
 * @auth super
 */
export async function GET(req) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: reqUser } = await supabase
      .from("users")
      .select("id, roles!role_id(name)")
      .eq("email", session.user.email)
      .maybeSingle();

    // Same rule the dashboard's own endpoints apply to their `viewAs` param,
    // so the door and the rooms behind it cannot admit different people.
    if (!canViewAs(reqUser?.roles?.name)) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const targetId = searchParams.get("id");
    if (!targetId) {
      return Response.json({ error: "Missing id" }, { status: 400 });
    }

    const user = await buildDashboardUser({ id: targetId });
    if (!user) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }

    return Response.json(user, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/admin/viewUser failed:", error);
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}
