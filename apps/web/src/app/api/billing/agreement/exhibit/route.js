export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { exhibitPreview } from "@/lib/billing/exhibitUnits";
import { billingErrorResponse } from "@/lib/billing/http";

/*
 * The signing popup's Exhibit A step: each property that can go on the document
 * the landlord is about to sign, with its units, what is covered already and the
 * default whole-building or units choice. Query: listingIds (comma separated, the
 * properties being published; empty from the Payments tab).
 * Answers { kind: "master" | "amendment" | "none", properties: [...] }.
 *
 * @auth landlord (own properties only)
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req) {
  const session = await requireDbRole(["landlord"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const raw = new URL(req.url).searchParams.get("listingIds") ?? "";
    const listingIds = raw.split(",").filter((id) => UUID.test(id)).slice(0, 200);
    return NextResponse.json(await exhibitPreview(supabase, session.user.id, { listingIds }));
  } catch (err) {
    return billingErrorResponse(err, "load Exhibit A");
  }
}
