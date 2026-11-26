export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { attachListings, findUnownedListings, inviteContact, UnownedError } from "@/lib/massEmail/unowned";
import { errorResponse, massEmailContext } from "@/lib/massEmail/http";
import { stampSignup } from "@/lib/marketing/accounts";

/*
 * Live listings with no landlord account (lib/massEmail/unowned.js).
 *
 * GET   { writable, listings: [{ id, label, contactName, contactEmail, leaseCount,
 *         suggestion: { action: attach|invite|skip|manual, reason, userId? } }] }
 * POST  { action: "attach", userId, listingIds }   link them to that landlord
 *       { action: "invite", email, name, listingIds } create a landlord account
 *         for the contact email (no password yet) and link them
 *
 * @auth admin
 */
export async function GET(req) {
  const ctx = await massEmailContext(req);
  if (ctx.response) return ctx.response;
  try {
    return NextResponse.json({ listings: await findUnownedListings(ctx.db), writable: ctx.writable });
  } catch (err) {
    return errorResponse(err, "list unowned listings");
  }
}

export async function POST(req) {
  const ctx = await massEmailContext(req, { write: true });
  if (ctx.response) return ctx.response;
  try {
    const body = await req.json().catch(() => ({}));
    if (body.action === "attach") {
      return NextResponse.json({ ok: true, ...(await attachListings(ctx.db, { userId: body.userId, listingIds: body.listingIds })) });
    }
    if (body.action === "invite") {
      const invited = await inviteContact(ctx.db, { email: body.email, name: body.name, listingIds: body.listingIds });
      // The account is the contact's, made by an admin: labelled "invite". Only on
      // the site's own database (the attribution tables are there, not on the other one).
      if (ctx.target === ctx.own) await stampSignup(req, { userId: invited.userId, role: "landlord", label: "invite" });
      return NextResponse.json({ ok: true, ...invited });
    }
    throw new UnownedError("bad_action", "Choose attach or invite.");
  } catch (err) {
    return errorResponse(err, "link unowned listings");
  }
}
