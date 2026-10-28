/*
 * GET /api/landlord/proxy-chat                 the landlord's listings with
 *                                               Proxy activity, and the
 *                                               count waiting on them
 * GET /api/landlord/proxy-chat?listingId=...   one listing's chat: questions
 *                                               with their exchange, and tour
 *                                               requests, oldest first
 *
 * GET /api/landlord/proxy-chat?all=1           every listing, for the
 *                                               Questions tab
 * POST /api/landlord/proxy-chat                one box for everything:
 *   { listingId, action: "route", text }       which open question, if any,
 *                                               the message answers
 *   { listingId, action: "send", text, questionId }
 *                                               send it there, or to the
 *                                               agent when questionId is null
 *   { listingId, action: "decide", messageId, confirm }
 *                                               confirm or cancel the changes
 *                                               the agent proposed
 *
 * A super "viewing as" a landlord sees that landlord's (?viewAs=).
 *
 * @auth landlord
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { resolveDashboardUserId } from "@/lib/users/viewAs";
import { hasStakeInListing } from "@/lib/listings/ownership";
import {
  landlordProxyOverview, landlordProxyTimeline, landlordWaitingCount,
  routeLandlordMessage, sendLandlordMessage, decideAgentProposal,
} from "@/lib/agents/landlordChat";

export const maxDuration = 60;

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
    const [listings, waiting] = await Promise.all([landlordProxyOverview(userId, { all: searchParams.get("all") === "1" }), landlordWaitingCount(userId)]);
    return NextResponse.json({ listings, waiting });
  } catch (err) {
    console.error("GET /api/landlord/proxy-chat failed:", err);
    return NextResponse.json({ error: "Could not load your Proxy messages" }, { status: 500 });
  }
}

export async function POST(req) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body;
  try { body = await req.json(); } catch { body = {}; }
  const listingId = String(body?.listingId ?? "");
  if (!UUID.test(listingId)) return NextResponse.json({ error: "Bad listing" }, { status: 400 });
  const userId = resolveDashboardUserId(session, new URL(req.url).searchParams);
  const isAdmin = ["super", "admin"].includes(session.user.role);
  if (!isAdmin && !(await hasStakeInListing(userId, listingId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    if (body.action === "route") {
      return NextResponse.json(await routeLandlordMessage({ userId, listingId, text: body.text }));
    }
    if (body.action === "send") {
      const questionId = body.questionId && UUID.test(String(body.questionId)) ? String(body.questionId) : null;
      const r = await sendLandlordMessage({ userId, isAdmin, listingId, text: body.text, questionId });
      if (r.error) return NextResponse.json({ error: r.error }, { status: r.status ?? 400 });
      return NextResponse.json(r);
    }
    if (body.action === "decide") {
      if (!UUID.test(String(body.messageId ?? ""))) return NextResponse.json({ error: "Bad message" }, { status: 400 });
      const r = await decideAgentProposal({ userId, isAdmin, listingId, messageId: String(body.messageId), confirm: body.confirm === true });
      if (r.error) return NextResponse.json({ error: r.error }, { status: 409 });
      return NextResponse.json(r);
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("POST /api/landlord/proxy-chat failed:", err);
    return NextResponse.json({ error: "Could not send that just now." }, { status: 500 });
  }
}
