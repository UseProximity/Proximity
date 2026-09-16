export const dynamic = "force-dynamic"; //so Next knows it's dynamic and not static

import { getRequestUser } from "@/lib/getRequestUser";
import { buildDashboardUser } from "@/lib/users/dashboardUser";

/*
 * The signed-in user's own dashboard payload — web session or mobile Bearer
 * token, resolved by getRequestUser().
 *
 * Everything returned here is built by lib/users/dashboardUser.js, which
 * /api/admin/viewUser also calls so that "view as" cannot show an admin a
 * different property than its owner sees. This route's only job is to say who
 * is asking.
 *
 * @auth any
 */
export async function GET(req) {
  try {
    const requestUser = await getRequestUser(req);
    if (!requestUser?.email) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Looked up by id when we have it (mobile's token already resolved the
    // row); falls back to email, which is reliable across auth provider ID
    // differences (web sessions from Google vs Credentials).
    const user = await buildDashboardUser(
      requestUser.id ? { id: requestUser.id } : { email: requestUser.email }
    );
    if (!user) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }

    return Response.json(user, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Error fetching user:", error);
    return Response.json({ error: "Failed to fetch user" }, { status: 500 });
  }
}
