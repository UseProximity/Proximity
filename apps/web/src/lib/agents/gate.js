/*
 * Who may use a listing's agent tools on this request: any owner of the
 * listing, or a super or admin. Returns { userId, isAdmin } or { res }.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { hasStakeInListing } from "@/lib/listings/ownership";

export async function agentGate(listingId) {
  const session = await auth();
  if (!session?.user?.id) return { res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const isAdmin = ["super", "admin"].includes(session.user.role);
  if (!isAdmin && !(await hasStakeInListing(session.user.id, listingId))) {
    return { res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { userId: session.user.id, isAdmin };
}

export async function readJson(req) {
  try { return await req.json(); } catch { return {}; }
}
