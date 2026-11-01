/*
 * GET /api/landlord/listings/[listingId]/agent: the Agent tab's data. Facts
 * by section with sources, held changes, history, sources, sync status and
 * the open question count. Any owner of the listing (other owners' lease
 * details are left out) or a super, who may view as a landlord.
 *
 * @auth landlord
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { hasStakeInListing } from "@/lib/listings/ownership";
import { resolveDashboardUserId } from "@/lib/users/viewAs";
import { knowledgeView } from "@/lib/agents/landlordAgent";

export async function GET(req, { params }) {
  const { listingId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const isAdmin = ["super", "admin"].includes(session.user.role);
  const userId = isAdmin ? resolveDashboardUserId(session, new URL(req.url).searchParams) : session.user.id;
  if (!isAdmin && !(await hasStakeInListing(session.user.id, listingId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    return NextResponse.json(await knowledgeView({ listingId, userId, isAdmin: isAdmin && userId === session.user.id }));
  } catch (err) {
    console.error("GET agent failed:", err);
    return NextResponse.json({ error: "Could not load the agent" }, { status: 500 });
  }
}
