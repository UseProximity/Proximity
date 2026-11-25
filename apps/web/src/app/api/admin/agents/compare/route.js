/*
 * POST /api/admin/agents/compare  { listingId }
 *
 * Reads one listing's website twice, the way production does today and the
 * way the new sync does (code only), plans both against the listing as it
 * is, and returns the two side by side, change by change, with what each
 * version would do and why. Writes nothing. Costs one model read for the old
 * version. Super admins only.
 *
 * @auth admin
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { requireDbRole } from "@/lib/userRole";
import { compareListing } from "@/lib/sourceImport/compare";

export async function POST(req) {
  if (!(await requireDbRole(["super"]))) return NextResponse.json({ error: "Only super admins can run a comparison." }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (!body?.listingId) return NextResponse.json({ error: "Missing the listing" }, { status: 400 });
  try {
    return NextResponse.json(await compareListing(body.listingId));
  } catch (err) {
    console.error("POST admin/agents/compare failed:", err);
    return NextResponse.json({ error: String(err?.message ?? "Could not compare").slice(0, 200) }, { status: 500 });
  }
}
