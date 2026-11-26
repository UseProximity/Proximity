export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { billingErrorResponse } from "@/lib/billing/http";
import { cleanDisclosure, getDisclosure, saveDisclosure } from "@/lib/users/licenseDisclosure";

/*
 * The signed-in landlord's real estate license disclosure
 * (lib/users/licenseDisclosure.js).
 *
 * GET  -> { disclosure }  null until they have answered (they answer right
 *         before signing the commission agreement).
 * PUT  body: { isLicensee: false, notLicensedConfirmed: true }
 *        or  { isLicensee: true, agentName, companyName, companyPhone, licenseNumber, ownerAgreementConfirmed: true }
 *      -> { disclosure }  Saved from the Profile tab. A licensee's name, company
 *         and phone show on their listings straight away.
 *
 * @auth landlord (own disclosure only)
 */
export async function GET() {
  const session = await requireDbRole(["landlord"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    return NextResponse.json({ disclosure: await getDisclosure(supabase, session.user.id) });
  } catch (err) {
    return billingErrorResponse(err, "load license disclosure");
  }
}

export async function PUT(req) {
  const session = await requireDbRole(["landlord"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const body = await req.json().catch(() => null);
    const clean = cleanDisclosure(body);
    const disclosure = await saveDisclosure(supabase, session.user.id, clean, { source: "profile" });
    return NextResponse.json({ disclosure });
  } catch (err) {
    return billingErrorResponse(err, "save license disclosure");
  }
}
