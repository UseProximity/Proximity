export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { findAudience, ROLES } from "@/lib/massEmail/audience";
import { errorResponse, massEmailContext } from "@/lib/massEmail/http";

/*
 * Who a mass email can go to (lib/massEmail/audience.js).
 *
 * GET  ?role=landlord|student|all&templateId=<id>
 *      { people: [{ id, name, email, company, role, canLogin, listings,
 *        leaseCount, subleaseOnly, live, lastSent }] }
 *      lastSent is when the given email last reached that person.
 *
 * @auth admin
 */
export async function GET(req) {
  const ctx = await massEmailContext(req);
  if (ctx.response) return ctx.response;
  try {
    const params = new URL(req.url).searchParams;
    const role = ROLES.includes(params.get("role")) ? params.get("role") : "landlord";
    const templateId = params.get("templateId") || null;
    return NextResponse.json({ people: await findAudience(ctx.db, { role, templateId }) });
  } catch (err) {
    return errorResponse(err, "list recipients");
  }
}
