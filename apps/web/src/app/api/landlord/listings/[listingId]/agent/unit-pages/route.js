/*
 * POST   /api/landlord/listings/[listingId]/agent/unit-pages  { unitId, url }
 * DELETE /api/landlord/listings/[listingId]/agent/unit-pages  { unitId }
 *
 * A unit's own page (lib/sourceSync/unitPages.js). The daily sync reads it
 * alone and trusts it for that unit; when it is gone the unit's leases are
 * withdrawn. The property's primary owner or the team sets these, the same
 * people who can set the building's website.
 *
 * @auth landlord
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isPropertyOwner } from "@/lib/listings/ownership";
import { setUnitPage, removeUnitPage } from "@/lib/sourceSync/unitPages";

async function guard(params) {
  const session = await auth();
  if (!session?.user?.id) return { res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const { listingId } = await params;
  const isAdmin = ["super", "admin"].includes(session.user.role);
  if (!isAdmin && !(await isPropertyOwner(session.user.id, listingId))) {
    return { res: NextResponse.json({ error: "Only the property's primary owner can change its pages." }, { status: 403 }) };
  }
  return { listingId, userId: session.user.id };
}

async function bodyOf(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

export async function POST(req, { params }) {
  const g = await guard(params);
  if (g.res) return g.res;
  const body = await bodyOf(req);
  const unitId = String(body?.unitId ?? "");
  const url = String(body?.url ?? "").trim();
  if (!unitId) return NextResponse.json({ error: "Pick a unit." }, { status: 400 });
  if (!/^https?:\/\//i.test(url)) return NextResponse.json({ error: "Enter a full web address starting with http." }, { status: 400 });
  try {
    const r = await setUnitPage({ listingId: g.listingId, unitId, rawUrl: url, userId: g.userId });
    if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 400 });
    return NextResponse.json({ ok: true, page: r.page });
  } catch (err) {
    console.error("POST agent/unit-pages failed:", err);
    return NextResponse.json({ error: "Could not save that page" }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  const g = await guard(params);
  if (g.res) return g.res;
  const body = await bodyOf(req);
  const unitId = String(body?.unitId ?? "");
  if (!unitId) return NextResponse.json({ error: "Pick a unit." }, { status: 400 });
  try {
    const r = await removeUnitPage({ listingId: g.listingId, unitId });
    if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE agent/unit-pages failed:", err);
    return NextResponse.json({ error: "Could not remove that page" }, { status: 500 });
  }
}
