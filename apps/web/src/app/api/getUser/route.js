export const dynamic = "force-dynamic"; //so Next knows it's dynamic and not static

import { auth } from "@/auth";
import { buildDashboardUser } from "@/lib/users/dashboardUser";

/*
 * The signed-in user's own dashboard payload.
 *
 * Everything returned here is built by lib/users/dashboardUser.js, which
 * /api/admin/viewUser also calls so that "view as" cannot show an admin a
 * different property than its owner sees. This route's only job is to say who
 * is asking.
 *
 * @auth any
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Looked up by email: reliable across auth provider ID differences.
    const user = await buildDashboardUser({ email: session.user.email });
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
