export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { adminBillingDb } from "@/lib/billing/adminDb";
import { requireDbRole } from "@/lib/userRole";
import { landlordFlags } from "@/lib/billing/versionLandlords";
import { billingErrorResponse, isUuid } from "@/lib/billing/http";

/*
 * What to flag about landlords before putting them on (or taking them off) a
 * custom agreement version: a signed agreement, another custom version, a copy
 * being signed or out on paper, an authorized signer, accounts they sign for.
 *   GET ?ids=<uuid>,<uuid>   up to 50 landlords
 *
 * Read-only, so it answers for either database on the dashboard's dev/prod switch.
 *
 * @auth admin
 */
export async function GET(req) {
  const session = await requireDbRole(["super"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { db } = adminBillingDb(req);
  try {
    const ids = (new URL(req.url).searchParams.get("ids") ?? "").split(",").filter(isUuid).slice(0, 50);
    return NextResponse.json({ landlords: Object.fromEntries(await landlordFlags(db, ids)) });
  } catch (err) {
    return billingErrorResponse(err, "check landlords");
  }
}
