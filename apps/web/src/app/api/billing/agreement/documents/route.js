export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { listAgreementDocuments } from "@/lib/billing/agreements";
import { billingErrorResponse } from "@/lib/billing/http";

/*
 * Every agreement document the signed-in landlord has: their master agreements
 * and Exhibit A amendments, newest first, with the properties each covered and
 * which signed files can be downloaded (through /api/billing/agreement/file).
 *
 * @auth landlord (own documents only)
 */
export async function GET() {
  const session = await requireDbRole(["landlord"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    return NextResponse.json({ documents: await listAgreementDocuments(supabase, session.user.id) });
  } catch (err) {
    return billingErrorResponse(err, "list agreement documents");
  }
}
