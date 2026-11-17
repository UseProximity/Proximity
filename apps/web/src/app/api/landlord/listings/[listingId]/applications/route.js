/*
 * GET /api/landlord/listings/[listingId]/applications[?viewAs=]
 *
 * The landlord's Apply numbers for one property: students who went to their
 * application, how many said they submitted it, and who those are. Scoped to
 * applications made through this landlord's own link (landlord_id), so a
 * landlord sharing a building sees only their own. Admins read it as the
 * landlord through viewAs.
 *
 * @auth user
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { resolveDashboardUserId, UUID_RE } from "@/lib/users/viewAs";
import { landlordApplications } from "@/lib/listings/applications";

export async function GET(req, { params }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { listingId } = await params;
    if (!UUID_RE.test(listingId ?? "")) return NextResponse.json({ error: "That isn't a valid property id." }, { status: 400 });
    const landlordId = resolveDashboardUserId(session, new URL(req.url).searchParams);
    return NextResponse.json(await landlordApplications({ landlordId, listingId }));
  } catch (err) {
    console.error("GET landlord applications failed:", err);
    return NextResponse.json({ error: "Could not load applications" }, { status: 500 });
  }
}
