export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { listPaidCharges } from "@/lib/billing/adjustments";
import { billingErrorResponse } from "@/lib/billing/http";

/*
 * Recent Paid charges with how much has been refunded or credited on each, for
 * the admin's Corrections screen.
 *
 * @auth admin
 */
export async function GET() {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    return NextResponse.json({ charges: await listPaidCharges(supabase) });
  } catch (err) {
    return billingErrorResponse(err, "list paid charges");
  }
}
