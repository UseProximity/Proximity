/*
 * GET /api/landlord/proxy-chat                 the landlord's listings with
 *                                               Proxy activity, and the
 *                                               count waiting on them
 * GET /api/landlord/proxy-chat?listingId=...   one listing's chat: questions
 *                                               with their exchange, and tour
 *                                               requests, oldest first
 *
 * A super "viewing as" a landlord sees that landlord's (?viewAs=).
 *
 * @auth landlord
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { resolveDashboardUserId } from "@/lib/users/viewAs";
import { landlordProxyOverview, landlordProxyTimeline, landlordWaitingCount } from "@/lib/agents/landlordChat";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { searchParams } = new URL(req.url);
    const userId = resolveDashboardUserId(session, searchParams);
    const listingId = searchParams.get("listingId");
    if (listingId) {
      if (!UUID.test(listingId)) return NextResponse.json({ error: "Bad listing" }, { status: 400 });
      return NextResponse.json(await landlordProxyTimeline(userId, listingId));
    }
    const [listings, waiting] = await Promise.all([landlordProxyOverview(userId), landlordWaitingCount(userId)]);
    return NextResponse.json({ listings, waiting });
  } catch (err) {
    console.error("GET /api/landlord/proxy-chat failed:", err);
    return NextResponse.json({ error: "Could not load your Proxy messages" }, { status: 500 });
  }
}
